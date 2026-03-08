/**
 * Extension session surface — Phase 45
 *
 * Read-only access to the current conversation branch and session metadata.
 * Exposed as `ctx.session` on ExtensionContext — always available.
 *
 * Snapshot is taken at handler invocation time (immutable within a handler).
 * Useful for walking tool call history, computing per-session metrics, etc.
 *
 * @example
 *   sho.on("agent_end", (event, ctx) => {
 *     const snap = ctx.session.getSnapshot();
 *     const bashCalls = snap.entries.filter(
 *       (e) => e.message.role === "assistant"
 *     ).length;
 *     ctx.notify(`${bashCalls} LLM messages this session`);
 *   });
 */

import type { Message } from "@takumi/core";

/** A single positioned entry in the session branch. */
export interface SessionEntry {
	/** Zero-based position in the branch (0 = oldest). */
	index: number;
	/** The message at this position. */
	message: Message;
}

/**
 * Immutable snapshot of the current session branch, oldest-first.
 * Walking entries lets extensions analyze tool call history, file reads, etc.
 */
export interface SessionSnapshot {
	readonly entries: readonly SessionEntry[];
	readonly length: number;
	readonly sessionId: string | undefined;
}

/**
 * Session surface on ExtensionContext (ctx.session).
 * Always present — snapshot is empty in headless or pre-session contexts.
 */
export interface ExtensionSession {
	/** Current immutable snapshot of the branch, oldest-first. */
	getSnapshot(): SessionSnapshot;

	/** Human-readable session label, or undefined if unset. */
	getName(): string | undefined;

	/**
	 * Set the human-readable session label.
	 * Convention: only set when the label is unset or matches a prior
	 * auto-generated value (e.g., URL-derived from a PR/issue prompt).
	 */
	setName(name: string): void;
}

/** Host-provided session action implementations — injected via bindActions(). */
export interface SessionContextActions {
	getSnapshot: () => SessionSnapshot;
	getName: () => string | undefined;
	setName: (name: string) => void;
}

/** Safe no-op defaults used before the session manager calls bindActions(). */
export const DEFAULT_SESSION_ACTIONS: SessionContextActions = {
	getSnapshot: () => ({ entries: [], length: 0, sessionId: undefined }),
	getName: () => undefined,
	setName: () => {},
};
