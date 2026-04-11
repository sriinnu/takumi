/**
 * Artifact persistence — durable storage and retrieval for HubArtifacts.
 *
 * Artifacts are stored as individual JSON files under
 * `~/.config/takumi/artifacts/` indexed by an append-only manifest.
 * Supports retrieval by session, task, kind, and time range.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ArtifactImportStatus, ArtifactKind, HubArtifact } from "./artifact-types.js";

// ── Paths ─────────────────────────────────────────────────────────────────────

function defaultArtifactDir(): string {
	return join(homedir(), ".config", "takumi", "artifacts");
}

async function ensureDir(dir?: string): Promise<string> {
	const d = dir ?? defaultArtifactDir();
	await mkdir(d, { recursive: true });
	return d;
}

/** Sanitise artifact ID for safe file paths. */
function safeName(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

// ── Query ─────────────────────────────────────────────────────────────────────

export interface ArtifactQuery {
	/** Filter by session ID. */
	sessionId?: string;
	/** Filter by task ID. */
	taskId?: string;
	/** Filter by artifact kind. */
	kind?: ArtifactKind;
	/** Only artifacts created after this ISO 8601 timestamp. */
	since?: string;
	/** Only artifacts created before this ISO 8601 timestamp. */
	until?: string;
	/** Max number of results. */
	limit?: number;
}

// ── Manifest (lightweight index) ──────────────────────────────────────────────

interface ManifestEntry {
	artifactId: string;
	kind: ArtifactKind;
	producer: string;
	taskId?: string;
	sessionId?: string;
	createdAt: string;
	summary: string;
	promoted: boolean;
	importStatus?: ArtifactImportStatus;
	canonicalArtifactId?: string;
	canonicalSessionId?: string;
	localSessionId?: string;
	runId?: string;
	contentHash: string;
	lastImportAt?: number;
	lastImportError?: string;
}

export interface StoredArtifact extends HubArtifact {
	_sessionId?: string;
}

export interface ArtifactImportStatePatch {
	promoted?: boolean;
	importStatus?: ArtifactImportStatus;
	canonicalArtifactId?: string;
	canonicalSessionId?: string;
	localSessionId?: string;
	runId?: string;
	contentHash?: string;
	lastImportAt?: number;
	lastImportError?: string;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export class ArtifactStore {
	private readonly baseDir: string | undefined;

	constructor(options?: { baseDir?: string }) {
		this.baseDir = options?.baseDir;
	}

	/** Persist a HubArtifact to disk, optionally bound to a session. */
	async save(artifact: HubArtifact, sessionId?: string): Promise<void> {
		const dir = await ensureDir(this.baseDir);
		await persistArtifact(dir, { ...artifact, _sessionId: sessionId });
	}

	/** Load a single artifact by ID. */
	async load(artifactId: string): Promise<StoredArtifact | null> {
		try {
			const dir = await ensureDir(this.baseDir);
			const raw = await readFile(join(dir, `${safeName(artifactId)}.json`), "utf-8");
			return JSON.parse(raw) as StoredArtifact;
		} catch {
			return null;
		}
	}

	/** Delete an artifact by ID. */
	async remove(artifactId: string): Promise<boolean> {
		try {
			const dir = await ensureDir(this.baseDir);
			await rm(join(dir, `${safeName(artifactId)}.json`), { force: true });
			return true;
		} catch {
			return false;
		}
	}

	/** Mark an artifact as promoted/demoted. */
	async setPromoted(artifactId: string, promoted: boolean): Promise<boolean> {
		return this.updateImportState(artifactId, { promoted });
	}

	/** Persist canonical Chitragupta import state for one local artifact. */
	async updateImportState(artifactId: string, patch: ArtifactImportStatePatch): Promise<boolean> {
		const artifact = await this.load(artifactId);
		if (!artifact) return false;
		const dir = await ensureDir(this.baseDir);
		const nextArtifact: StoredArtifact = {
			...artifact,
			...patch,
		};
		for (const [key, value] of Object.entries(patch) as Array<[keyof ArtifactImportStatePatch, unknown]>) {
			if (value === undefined) {
				delete nextArtifact[key as keyof StoredArtifact];
			}
		}
		await persistArtifact(dir, nextArtifact);
		return true;
	}

	/** Query artifacts matching criteria. */
	async query(q: ArtifactQuery): Promise<StoredArtifact[]> {
		const dir = await ensureDir(this.baseDir);
		const files = await readdir(dir).catch(() => [] as string[]);
		const jsonFiles = files.filter((f) => f.endsWith(".json"));

		const results: StoredArtifact[] = [];
		for (const file of jsonFiles) {
			try {
				const raw = await readFile(join(dir, file), "utf-8");
				const art = JSON.parse(raw) as StoredArtifact;
				if (matchesQuery(art, q)) results.push(art);
			} catch {
				// Skip corrupt files.
			}
		}

		results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		return q.limit ? results.slice(0, q.limit) : results;
	}

	/** List artifact manifest (lightweight — no body). */
	async manifest(q?: ArtifactQuery): Promise<ManifestEntry[]> {
		const all = await this.query(q ?? {});
		return all.map((a) => ({
			artifactId: a.artifactId,
			kind: a.kind,
			producer: a.producer,
			taskId: a.taskId,
			sessionId: a._sessionId,
			createdAt: a.createdAt,
			summary: a.summary,
			promoted: a.promoted,
			importStatus: a.importStatus,
			canonicalArtifactId: a.canonicalArtifactId,
			canonicalSessionId: a.canonicalSessionId,
			localSessionId: a.localSessionId,
			runId: a.runId,
			contentHash: a.contentHash,
			lastImportAt: a.lastImportAt,
			lastImportError: a.lastImportError,
		}));
	}
}

// ── Matching ──────────────────────────────────────────────────────────────────

function matchesQuery(art: StoredArtifact, q: ArtifactQuery): boolean {
	if (q.sessionId && art._sessionId !== q.sessionId) return false;
	if (q.taskId && art.taskId !== q.taskId) return false;
	if (q.kind && art.kind !== q.kind) return false;
	if (q.since && art.createdAt < q.since) return false;
	if (q.until && art.createdAt > q.until) return false;
	return true;
}

/** Write one stored artifact payload to disk atomically enough for local use. */
async function persistArtifact(dir: string, artifact: StoredArtifact): Promise<void> {
	const filePath = join(dir, `${safeName(artifact.artifactId)}.json`);
	await writeFile(filePath, JSON.stringify(artifact, null, 2), "utf-8");
}
