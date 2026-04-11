/**
 * Durable extension storage.
 *
 * Extensions need a tiny, explicit persistence seam for preferences,
 * lightweight counters, and session-scoped coordination state.
 * I keep it workspace-local under `.takumi/state/extensions/` so data stays
 * close to the repo and avoids surprising cross-project bleed.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export type ExtensionStorageValue =
	| null
	| boolean
	| number
	| string
	| ExtensionStorageValue[]
	| { [key: string]: ExtensionStorageValue };

type ExtensionStorageRecord = Record<string, ExtensionStorageValue>;

interface StoredDocument {
	version: 1;
	values: ExtensionStorageRecord;
}

export interface ExtensionStorage {
	/** Read a durable workspace-scoped value for this extension. */
	get<T extends ExtensionStorageValue = ExtensionStorageValue>(key: string): Promise<T | undefined>;
	/** Persist a durable workspace-scoped value for this extension. */
	set<T extends ExtensionStorageValue>(key: string, value: T): Promise<void>;
	/** Delete a durable workspace-scoped value for this extension. */
	delete(key: string): Promise<void>;
	/** List all durable workspace-scoped keys for this extension. */
	keys(): Promise<string[]>;
	/** Read a session-scoped value for this extension. */
	getSession<T extends ExtensionStorageValue = ExtensionStorageValue>(
		key: string,
		sessionId?: string,
	): Promise<T | undefined>;
	/** Persist a session-scoped value for this extension. */
	setSession<T extends ExtensionStorageValue>(key: string, value: T, sessionId?: string): Promise<void>;
	/** Delete a session-scoped value for this extension. */
	deleteSession(key: string, sessionId?: string): Promise<void>;
	/** List session-scoped keys for this extension. */
	sessionKeys(sessionId?: string): Promise<string[]>;
}

export interface ExtensionStorageConfig {
	cwd: string;
	extensionPath: string;
	resolvedPath: string;
	manifestName?: string;
	getSessionId: () => string | undefined;
}

const STORAGE_ROOT = [".takumi", "state", "extensions"];

function createEmptyDocument(): StoredDocument {
	return { version: 1, values: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneValue<T extends ExtensionStorageValue | undefined>(value: T): T {
	return value === undefined ? value : structuredClone(value);
}

function normalizeSlug(value: string | undefined): string | null {
	if (!value) return null;
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized || null;
}

function sanitizeSessionId(sessionId: string): string {
	const sanitized = sessionId.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return sanitized || "session";
}

function buildExtensionStorageId(
	config: Pick<ExtensionStorageConfig, "manifestName" | "extensionPath" | "resolvedPath">,
): string {
	const manifestId = normalizeSlug(config.manifestName);
	if (manifestId) return manifestId;
	const baseName = basename(config.resolvedPath || config.extensionPath).replace(/\.[^.]+$/, "");
	const label = normalizeSlug(baseName) ?? "extension";
	const hash = createHash("sha1")
		.update(config.resolvedPath || config.extensionPath)
		.digest("hex")
		.slice(0, 8);
	return `${label}-${hash}`;
}

function parseStoredDocument(raw: string): StoredDocument {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.values)) {
			return createEmptyDocument();
		}
		return { version: 1, values: parsed.values as ExtensionStorageRecord };
	} catch {
		return createEmptyDocument();
	}
}

async function readStoredDocument(filePath: string): Promise<StoredDocument> {
	try {
		const raw = await readFile(filePath, "utf-8");
		return parseStoredDocument(raw);
	} catch {
		return createEmptyDocument();
	}
}

function createSessionResolutionError(): Error {
	return new Error("Extension session storage requires an active session id.");
}

abstract class BaseExtensionStorage implements ExtensionStorage {
	protected readonly getSessionId: () => string | undefined;

	constructor(getSessionId: () => string | undefined) {
		this.getSessionId = getSessionId;
	}

	abstract get<T extends ExtensionStorageValue = ExtensionStorageValue>(key: string): Promise<T | undefined>;
	abstract set<T extends ExtensionStorageValue>(key: string, value: T): Promise<void>;
	abstract delete(key: string): Promise<void>;
	abstract keys(): Promise<string[]>;
	abstract getSession<T extends ExtensionStorageValue = ExtensionStorageValue>(
		key: string,
		sessionId?: string,
	): Promise<T | undefined>;
	abstract setSession<T extends ExtensionStorageValue>(key: string, value: T, sessionId?: string): Promise<void>;
	abstract deleteSession(key: string, sessionId?: string): Promise<void>;
	abstract sessionKeys(sessionId?: string): Promise<string[]>;

	protected resolveSessionId(sessionId?: string): string | undefined {
		return sessionId ?? this.getSessionId();
	}

	protected requireSessionId(sessionId?: string): string {
		const resolved = this.resolveSessionId(sessionId);
		if (!resolved) throw createSessionResolutionError();
		return resolved;
	}

	protected clone<T extends ExtensionStorageValue = ExtensionStorageValue>(value: T | undefined): T | undefined {
		return cloneValue(value) as T | undefined;
	}

	protected sortKeys(record: ExtensionStorageRecord): string[] {
		return Object.keys(record).sort((left, right) => left.localeCompare(right));
	}
}

class DiskExtensionStorage extends BaseExtensionStorage {
	private readonly globalFilePath: string;
	private readonly sessionsDirPath: string;
	private globalCache: StoredDocument | null = null;
	private readonly sessionCache = new Map<string, StoredDocument>();
	private persistChain: Promise<void> = Promise.resolve();

	constructor(config: ExtensionStorageConfig) {
		super(config.getSessionId);
		const storageId = buildExtensionStorageId(config);
		const rootDir = join(config.cwd, ...STORAGE_ROOT, storageId);
		this.globalFilePath = join(rootDir, "global.json");
		this.sessionsDirPath = join(rootDir, "sessions");
	}

	async get<T extends ExtensionStorageValue = ExtensionStorageValue>(key: string): Promise<T | undefined> {
		const document = await this.getGlobalDocument();
		return this.clone(document.values[key] as T | undefined);
	}

	async set<T extends ExtensionStorageValue>(key: string, value: T): Promise<void> {
		const document = await this.getGlobalDocument();
		document.values[key] = cloneValue(value);
		await this.persist(this.globalFilePath, document);
	}

	async delete(key: string): Promise<void> {
		const document = await this.getGlobalDocument();
		if (!(key in document.values)) return;
		delete document.values[key];
		await this.persist(this.globalFilePath, document);
	}

	async keys(): Promise<string[]> {
		return this.sortKeys((await this.getGlobalDocument()).values);
	}

	async getSession<T extends ExtensionStorageValue = ExtensionStorageValue>(
		key: string,
		sessionId?: string,
	): Promise<T | undefined> {
		const resolvedSessionId = this.resolveSessionId(sessionId);
		if (!resolvedSessionId) return undefined;
		const document = await this.getSessionDocument(resolvedSessionId);
		return this.clone(document.values[key] as T | undefined);
	}

	async setSession<T extends ExtensionStorageValue>(key: string, value: T, sessionId?: string): Promise<void> {
		const resolvedSessionId = this.requireSessionId(sessionId);
		const document = await this.getSessionDocument(resolvedSessionId);
		document.values[key] = cloneValue(value);
		await this.persist(this.getSessionFilePath(resolvedSessionId), document);
	}

	async deleteSession(key: string, sessionId?: string): Promise<void> {
		const resolvedSessionId = this.requireSessionId(sessionId);
		const document = await this.getSessionDocument(resolvedSessionId);
		if (!(key in document.values)) return;
		delete document.values[key];
		await this.persist(this.getSessionFilePath(resolvedSessionId), document);
	}

	async sessionKeys(sessionId?: string): Promise<string[]> {
		const resolvedSessionId = this.resolveSessionId(sessionId);
		if (!resolvedSessionId) return [];
		return this.sortKeys((await this.getSessionDocument(resolvedSessionId)).values);
	}

	private async getGlobalDocument(): Promise<StoredDocument> {
		if (this.globalCache) return this.globalCache;
		this.globalCache = await readStoredDocument(this.globalFilePath);
		return this.globalCache;
	}

	private async getSessionDocument(sessionId: string): Promise<StoredDocument> {
		const cached = this.sessionCache.get(sessionId);
		if (cached) return cached;
		const document = await readStoredDocument(this.getSessionFilePath(sessionId));
		this.sessionCache.set(sessionId, document);
		return document;
	}

	private getSessionFilePath(sessionId: string): string {
		return join(this.sessionsDirPath, `${sanitizeSessionId(sessionId)}.json`);
	}

	private async persist(filePath: string, document: StoredDocument): Promise<void> {
		const payload = `${JSON.stringify(document, null, 2)}\n`;
		this.persistChain = this.persistChain.then(async () => {
			await mkdir(dirname(filePath), { recursive: true });
			await writeFile(filePath, payload, "utf-8");
		});
		await this.persistChain;
	}
}

class EphemeralExtensionStorage extends BaseExtensionStorage {
	private readonly globalDocument = createEmptyDocument();
	private readonly sessionDocuments = new Map<string, StoredDocument>();

	async get<T extends ExtensionStorageValue = ExtensionStorageValue>(key: string): Promise<T | undefined> {
		return this.clone(this.globalDocument.values[key] as T | undefined);
	}

	async set<T extends ExtensionStorageValue>(key: string, value: T): Promise<void> {
		this.globalDocument.values[key] = cloneValue(value);
	}

	async delete(key: string): Promise<void> {
		delete this.globalDocument.values[key];
	}

	async keys(): Promise<string[]> {
		return this.sortKeys(this.globalDocument.values);
	}

	async getSession<T extends ExtensionStorageValue = ExtensionStorageValue>(
		key: string,
		sessionId?: string,
	): Promise<T | undefined> {
		const resolvedSessionId = this.resolveSessionId(sessionId);
		if (!resolvedSessionId) return undefined;
		return this.clone((this.getSessionDocument(resolvedSessionId).values[key] as T | undefined) ?? undefined);
	}

	async setSession<T extends ExtensionStorageValue>(key: string, value: T, sessionId?: string): Promise<void> {
		this.getSessionDocument(this.requireSessionId(sessionId)).values[key] = cloneValue(value);
	}

	async deleteSession(key: string, sessionId?: string): Promise<void> {
		delete this.getSessionDocument(this.requireSessionId(sessionId)).values[key];
	}

	async sessionKeys(sessionId?: string): Promise<string[]> {
		const resolvedSessionId = this.resolveSessionId(sessionId);
		if (!resolvedSessionId) return [];
		return this.sortKeys(this.getSessionDocument(resolvedSessionId).values);
	}

	private getSessionDocument(sessionId: string): StoredDocument {
		let document = this.sessionDocuments.get(sessionId);
		if (!document) {
			document = createEmptyDocument();
			this.sessionDocuments.set(sessionId, document);
		}
		return document;
	}
}

/** Create workspace-local durable storage for one extension. */
export function createExtensionStorage(config: ExtensionStorageConfig): ExtensionStorage {
	return new DiskExtensionStorage(config);
}

/**
 * Create a non-persistent fallback store.
 *
 * I use this for tests and inline extension shells that do not come through the
 * regular loader path.
 */
export function createEphemeralExtensionStorage(
	getSessionId: () => string | undefined = () => undefined,
): ExtensionStorage {
	return new EphemeralExtensionStorage(getSessionId);
}
