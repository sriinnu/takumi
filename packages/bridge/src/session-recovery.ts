/**
 * Session Recovery & Replay — Phase 19.
 *
 * Reconstructs session state from the Chitragupta daemon and provides
 * fork-at-turn capability for branching conversation history.
 */

import type { Message } from "@takumi/core";
import { createLogger, generateSessionId, loadSession, type SessionData, saveSession } from "@takumi/core";
import type { ChitraguptaBridge } from "./chitragupta.js";
import { turnsToMessages } from "./turn-mapper.js";

const log = createLogger("session-recovery");

// ── Types ────────────────────────────────────────────────────────────────────

/** Result of reconstructing a session from the daemon. */
export interface RecoveredSession {
	/** The original session ID from the daemon. */
	sessionId: string;
	/** Project path (if available from daemon metadata). */
	project: string;
	/** Conversation messages reconstructed from daemon turns. */
	messages: Message[];
	/** Total number of turns recovered. */
	turnCount: number;
	/** Session creation timestamp (epoch ms). */
	createdAt: number;
	/** Session last-updated timestamp (epoch ms). */
	updatedAt: number;
}

// ── Reconstruct from daemon ──────────────────────────────────────────────────

/**
 * Reconstruct a full session from the Chitragupta daemon.
 *
 * Calls `sessionShow` for metadata and `turnList` for the raw turn data,
 * then maps turns into the @takumi/core Message format.
 *
 * @returns The recovered session, or `null` if the daemon is unreachable
 *          or the session does not exist.
 */
export async function reconstructFromDaemon(
	bridge: ChitraguptaBridge,
	sessionId: string,
): Promise<RecoveredSession | null> {
	try {
		const detail = await bridge.sessionShow(sessionId);
		if (!detail || !detail.id) {
			log.warn(`Session ${sessionId} not found on daemon`);
			return null;
		}

		const turns = await bridge.turnList(sessionId);
		const messages = turnsToMessages(turns);

		// Derive timestamps from detail turns or fall back to now
		const timestamps = detail.turns.map((t) => t.timestamp).filter((t) => t > 0);
		const createdAt = timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
		const updatedAt = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();

		return {
			sessionId: detail.id,
			project: "",
			messages,
			turnCount: turns.length,
			createdAt,
			updatedAt,
		};
	} catch (err) {
		log.error(`Failed to reconstruct session ${sessionId}: ${(err as Error).message}`);
		return null;
	}
}

// ── Fork at turn ─────────────────────────────────────────────────────────────

/**
 * Fork a locally-persisted session at a specific turn index.
 *
 * Loads the session from disk, slices messages up to (and including)
 * `turnIndex`, and saves the result as a new session with a fresh ID.
 *
 * @param sessionId   - The source session to fork.
 * @param turnIndex   - Zero-based index: messages[0..turnIndex] are kept.
 * @param sessionsDir - Override the sessions directory (for testing).
 * @returns The new session ID, or `null` if the source session was not found
 *          or the turnIndex is out of bounds.
 */
export async function forkSessionAtTurn(
	sessionId: string,
	turnIndex: number,
	sessionsDir?: string,
): Promise<string | null> {
	const source = await loadSession(sessionId, sessionsDir);
	if (!source) {
		log.warn(`Cannot fork: session ${sessionId} not found`);
		return null;
	}

	if (turnIndex < 0 || turnIndex >= source.messages.length) {
		log.warn(`Cannot fork: turnIndex ${turnIndex} out of bounds (0..${source.messages.length - 1})`);
		return null;
	}

	const slicedMessages = source.messages.slice(0, turnIndex + 1).map((m) => ({
		...m,
		content: [...m.content],
	}));

	const now = Date.now();
	const newId = generateSessionId();

	const forked: SessionData = {
		...source,
		id: newId,
		title: `Fork of ${source.title || source.id} @ turn ${turnIndex}`,
		createdAt: now,
		updatedAt: now,
		messages: slicedMessages,
	};

	await saveSession(forked, sessionsDir);
	log.info(`Forked session ${sessionId} → ${newId} at turn ${turnIndex}`);
	return newId;
}
