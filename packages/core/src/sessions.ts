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
}

export interface SessionSummary {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	model: string;
}

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
		if (!data.id || !Array.isArray(data.messages)) {
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
			if (!data.id || !Array.isArray(data.messages)) continue;
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
	let timer: ReturnType<typeof setInterval> | null = null;
	let inFlight: Promise<void> | null = null;

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

	timer = setInterval(() => {
		void save();
	}, interval);

	if (timer && typeof timer === "object" && "unref" in timer) {
		timer.unref();
	}

	return {
		save,
		stop() {
			if (timer !== null) {
				clearInterval(timer);
				timer = null;
			}
		},
	};
}
