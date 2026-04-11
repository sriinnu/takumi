/**
 * Session persistence — save and restore conversations to disk.
 *
 * Sessions are stored as JSON files in `~/.config/takumi/sessions/`.
 * Each file contains the full conversation state: messages, model,
 * token usage, and metadata.
 */

import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionContinuityState } from "./session-continuity.js";
import type { Message } from "./types.js";
// ── Types ─────────────────────────────────────────────────────────────────────

export interface SessionData {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messages: Message[];
	model: string;
	tokenUsage: {
		inputTokens: number;
		outputTokens: number;
		totalCost: number;
	};
	controlPlane?: SessionControlPlaneState;
}

export interface SessionControlPlaneSyncState {
	lastSyncedMessageId?: string;
	lastSyncedMessageTimestamp?: number;
	lastSyncedAt?: number;
	status?: "idle" | "pending" | "syncing" | "ready" | "failed";
	lastError?: string;
	lastAttemptedMessageId?: string;
	lastAttemptedMessageTimestamp?: number;
	lastFailedMessageId?: string;
	lastFailedMessageTimestamp?: number;
}

export type SessionControlPlaneDegradedSourceKind = "route_degraded" | "sync_failure";

export interface SessionControlPlaneDegradedSourceState {
	kind: SessionControlPlaneDegradedSourceKind;
	reason: string;
	firstDetectedAt: number;
	lastDetectedAt: number;
	capability?: string | null;
	authority?: "engine" | "takumi-fallback" | null;
	fallbackChain?: string[];
	status?: SessionControlPlaneSyncState["status"] | null;
	lastFailedMessageId?: string | null;
	pendingLocalTurns?: number | null;
}

export interface SessionControlPlaneDegradedContext {
	firstDetectedAt: number;
	lastUpdatedAt: number;
	sources: SessionControlPlaneDegradedSourceState[];
}

export interface SessionControlPlaneLanePolicyState {
	contractVersion?: number | null;
	role: string;
	preferLocal?: boolean | null;
	allowCloud?: boolean | null;
	maxCostClass?: "free" | "low" | "medium" | "high" | null;
	requireStreaming?: boolean | null;
	hardProviderFamily?: string | null;
	preferredProviderFamilies?: string[];
	toolAccess?: "inherit" | "allow" | "deny";
	privacyBoundary?: "inherit" | "local-preferred" | "cloud-ok" | "strict-local";
	fallbackStrategy?: "same-provider" | "capability-only" | "none";
	tags?: string[];
}

export interface SessionControlPlaneLaneState {
	key: string;
	role: string;
	laneId: string;
	durableKey: string;
	snapshotAt: number;
	routeClass?: string | null;
	capability?: string | null;
	selectedCapabilityId?: string | null;
	provider?: string | null;
	model?: string | null;
	degraded: boolean;
	reason?: string | null;
	fallbackChain?: string[];
	policyTrace?: string[];
	policy: SessionControlPlaneLanePolicyState;
	requestedPolicy?: SessionControlPlaneLanePolicyState;
	effectivePolicy?: SessionControlPlaneLanePolicyState;
	constraintsApplied?: Record<string, unknown> | null;
	policyHash?: string | null;
	policyWarnings?: string[];
	authoritySource?: "bootstrap" | "route.lanes.get" | "route.lanes.refresh" | "session-cache";
	verifiedAt?: number;
}

export interface SessionArtifactPromotionState {
	status?: "idle" | "pending" | "syncing" | "ready" | "failed";
	pendingArtifactIds?: string[];
	importedArtifactIds?: string[];
	lastPromotionAt?: number;
	lastError?: string;
}

export interface SessionControlPlaneState {
	canonicalSessionId?: string;
	sync?: SessionControlPlaneSyncState;
	lanes?: SessionControlPlaneLaneState[];
	degradedContext?: SessionControlPlaneDegradedContext;
	artifactPromotion?: SessionArtifactPromotionState;
	/**
	 * Mirrored device-continuity summary for UI/recovery.
	 *
	 * I expect future daemon-side continuity work to remain canonical; this
	 * snapshot is just the persisted local view.
	 */
	continuity?: SessionContinuityState;
}

export interface SessionSummary {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	model: string;
}

export interface SessionJsonlMetaRecord {
	type: "session_meta";
	version: 1;
	session: Omit<SessionData, "messages">;
}

export interface SessionJsonlMessageRecord {
	type: "message";
	message: Message;
}

export type SessionJsonlRecord = SessionJsonlMetaRecord | SessionJsonlMessageRecord;

// ── Paths ─────────────────────────────────────────────────────────────────────

/** Default sessions directory: ~/.config/takumi/sessions/ */
function defaultSessionsDir(): string {
	return join(homedir(), ".config", "takumi", "sessions");
}

/** Resolve the sessions directory, ensuring it exists. */
async function ensureSessionsDir(sessionsDir?: string): Promise<string> {
	const dir = sessionsDir ?? defaultSessionsDir();
	await mkdir(dir, { recursive: true });
	return dir;
}

/** Build the file path for a session. */
function sessionPath(dir: string, id: string): string {
	// Sanitize the id to prevent directory traversal
	const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
	return join(dir, `${safe}.json`);
}

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Generate a unique session ID.
 * Format: `session-YYYY-MM-DD-XXXX` where XXXX is a random 4-char hex string.
 */
export function generateSessionId(): string {
	const date = new Date().toISOString().slice(0, 10);
	const rand = Math.random().toString(16).slice(2, 6).padEnd(4, "0");
	return `session-${date}-${rand}`;
}

/**
 * Save a session to disk.
 * Creates or overwrites the JSON file for the given session.
 */
export async function saveSession(session: SessionData, sessionsDir?: string): Promise<void> {
	const dir = await ensureSessionsDir(sessionsDir);
	const filePath = sessionPath(dir, session.id);
	const json = JSON.stringify(session, null, 2);
	await writeFile(filePath, json, "utf-8");
}

/**
 * Export a session as JSONL using an explicit metadata envelope followed by one
 * message record per line.
 */
export function exportSessionAsJsonl(session: SessionData): string {
	const meta: SessionJsonlMetaRecord = {
		type: "session_meta",
		version: 1,
		session: {
			id: session.id,
			title: session.title,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			model: session.model,
			tokenUsage: session.tokenUsage,
		},
	};

	const lines = [JSON.stringify(meta)];
	for (const message of session.messages) {
		const record: SessionJsonlMessageRecord = { type: "message", message };
		lines.push(JSON.stringify(record));
	}
	return lines.join("\n");
}

/**
 * Import a session from Takumi JSONL export format.
 */
export function importSessionFromJsonl(jsonl: string, sessionIdOverride?: string): SessionData {
	const lines = jsonl
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	if (lines.length === 0) {
		throw new Error("JSONL input is empty");
	}

	let meta: SessionJsonlMetaRecord | null = null;
	const messages: Message[] = [];

	for (const line of lines) {
		const record = JSON.parse(line) as SessionJsonlRecord;
		if (record.type === "session_meta") {
			meta = record;
			continue;
		}
		if (record.type === "message") {
			messages.push(record.message);
			continue;
		}
		throw new Error(`Unsupported JSONL record type: ${(record as { type?: string }).type ?? "unknown"}`);
	}

	if (!meta) {
		throw new Error("JSONL import is missing the session_meta record");
	}

	const imported: SessionData = {
		...meta.session,
		id: sessionIdOverride ?? meta.session.id ?? generateSessionId(),
		messages,
	};

	if (!isSessionData(imported)) {
		throw new Error("Imported JSONL does not contain a valid Takumi session");
	}

	return imported;
}

/**
 * Load a session from disk by ID.
 * Returns null if the session file does not exist or is corrupt.
 */
export async function loadSession(id: string, sessionsDir?: string): Promise<SessionData | null> {
	const dir = await ensureSessionsDir(sessionsDir);
	const filePath = sessionPath(dir, id);
	try {
		const raw = await readFile(filePath, "utf-8");
		const data = JSON.parse(raw) as SessionData;
		// Basic validation
		if (!isSessionData(data)) {
			return null;
		}
		return data;
	} catch {
		return null;
	}
}

/**
 * List available sessions, sorted by updatedAt descending (most recent first).
 * Optionally limit the number of results.
 */
export async function listSessions(limit?: number, sessionsDir?: string): Promise<SessionSummary[]> {
	const dir = await ensureSessionsDir(sessionsDir);
	let files: string[];
	try {
		files = await readdir(dir);
	} catch {
		return [];
	}

	const jsonFiles = files.filter((f) => f.endsWith(".json"));
	const summaries: SessionSummary[] = [];

	for (const file of jsonFiles) {
		try {
			const raw = await readFile(join(dir, file), "utf-8");
			const data = JSON.parse(raw) as SessionData;
			if (!isSessionData(data)) continue;
			summaries.push({
				id: data.id,
				title: data.title,
				createdAt: data.createdAt,
				updatedAt: data.updatedAt,
				messageCount: data.messages.length,
				model: data.model,
			});
		} catch {}
	}

	// Sort by updatedAt descending
	summaries.sort((a, b) => b.updatedAt - a.updatedAt);

	if (limit !== undefined && limit > 0) {
		return summaries.slice(0, limit);
	}
	return summaries;
}

/**
 * Fork an existing session into a new session with a fresh ID.
 *
 * The new session inherits all messages, model, and token usage from the
 * source, but gets a new ID and `createdAt` timestamp. Both sessions are
 * saved to disk — the source is unchanged.
 *
 * @returns The new forked SessionData, or null if the source is not found.
 */
export async function forkSession(sourceId: string, newId?: string, sessionsDir?: string): Promise<SessionData | null> {
	const source = await loadSession(sourceId, sessionsDir);
	if (!source) return null;
	const now = Date.now();
	const forked: SessionData = {
		...source,
		id: newId ?? generateSessionId(),
		title: `Fork of ${source.title || source.id}`,
		createdAt: now,
		updatedAt: now,
		// deep-copy messages so mutations on one session don't affect the other
		messages: source.messages.map((m) => ({ ...m, content: [...m.content] })),
	};
	await saveSession(forked, sessionsDir);
	return forked;
}

/**
 * Delete a session from disk.
 * Silently succeeds if the file does not exist.
 */
export async function deleteSession(id: string, sessionsDir?: string): Promise<void> {
	const dir = await ensureSessionsDir(sessionsDir);
	const filePath = sessionPath(dir, id);
	try {
		await unlink(filePath);
	} catch {
		// File doesn't exist — nothing to do
	}
}

function isSessionData(data: unknown): data is SessionData {
	if (!data || typeof data !== "object") return false;
	const candidate = data as Partial<SessionData>;
	return typeof candidate.id === "string" && Array.isArray(candidate.messages);
}
// ── Auto-saver ────────────────────────────────────────────────────────────────

export interface AutoSaver {
	/** Force an immediate save. */
	save(): Promise<void>;
	/** Stop the periodic auto-save timer. */
	stop(): void;
}

/**
 * Create an auto-saver that periodically persists the current session.
 *
 * @param sessionId  - The session ID to save under
 * @param getState   - Callback that returns the current session data to persist
 * @param interval   - Save interval in ms (default: 30_000 = 30 seconds)
 * @param sessionsDir - Override the sessions directory
 */
export function createAutoSaver(
	_sessionId: string,
	getState: () => SessionData,
	interval = 30_000,
	sessionsDir?: string,
): AutoSaver {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let inFlight: Promise<void> | null = null;
	let stopped = false;

	const save = async (): Promise<void> => {
		if (inFlight) {
			return inFlight;
		}

		inFlight = (async () => {
			try {
				const data = getState();
				// Update the timestamp on every save
				data.updatedAt = Date.now();
				await saveSession(data, sessionsDir);
			} catch {
				// Auto-save failures are non-fatal; silently continue
			} finally {
				inFlight = null;
			}
		})();

		return inFlight;
	};

	const unrefTimer = () => {
		if (timer && typeof timer === "object" && "unref" in timer) {
			timer.unref();
		}
	};

	const scheduleNext = () => {
		if (stopped) {
			return;
		}

		timer = setTimeout(async () => {
			await save();
			scheduleNext();
		}, interval);
		unrefTimer();
	};

	scheduleNext();

	return {
		save,
		stop() {
			stopped = true;
			if (timer !== null) {
				clearTimeout(timer);
				timer = null;
			}
		},
	};
}
