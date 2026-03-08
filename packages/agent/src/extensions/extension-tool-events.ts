/**
 * Tool lifecycle events — Phase 45
 *
 * Per-tool typed event variants for filtered subscriptions and streaming
 * tool lifecycle events. New events:
 *   tool_execution_start/update/end — streaming tool execution lifecycle
 *   message_start / message_end    — LLM message boundary events
 *   before_provider_request        — intercept raw LLM HTTP payload
 *   user_bash                      — user typed !cmd shell prefix
 *
 * Filtered subscriptions usage:
 *   sho.on("tool_call:bash", (event, ctx) => {
 *     event.args.command  // typed as string — no type guard required
 *   });
 *
 * This file has no imports from other extension files, keeping the
 * dependency graph acyclic (extension-types.ts imports this file).
 */

// ── Per-Tool Typed Call Events ─────────────────────────────────────────────────
// Narrowed variants of ToolCallEvent. Used via filtered subscriptions.

/** Narrowed tool_call event for the built-in bash tool. */
export interface BashToolCallEvent {
	type: "tool_call";
	toolCallId: string;
	toolName: "bash";
	args: { command: string; timeout?: number; workdir?: string };
}

/** Narrowed tool_call event for the built-in read tool. */
export interface ReadToolCallEvent {
	type: "tool_call";
	toolCallId: string;
	toolName: "read";
	args: { path: string; startLine?: number; endLine?: number };
}

/** Narrowed tool_call event for the built-in edit tool. */
export interface EditToolCallEvent {
	type: "tool_call";
	toolCallId: string;
	toolName: "edit";
	args: { path: string; oldString: string; newString: string };
}

/** Narrowed tool_call event for the built-in write tool. */
export interface WriteToolCallEvent {
	type: "tool_call";
	toolCallId: string;
	toolName: "write";
	args: { path: string; content: string };
}

/** Narrowed tool_call event for the built-in glob tool. */
export interface GlobToolCallEvent {
	type: "tool_call";
	toolCallId: string;
	toolName: "glob";
	args: { pattern: string; cwd?: string };
}

/** Narrowed tool_call event for the built-in grep tool. */
export interface GrepToolCallEvent {
	type: "tool_call";
	toolCallId: string;
	toolName: "grep";
	args: { pattern: string; path?: string; isRegexp?: boolean };
}

/**
 * Narrow a generic tool_call payload to a specific tool name.
 * Use this when you receive a ToolCallEvent and need typed `args` access.
 *
 * @example
 *   sho.on("tool_call", (event, ctx) => {
 *     if (isToolCallForTool("bash", event)) {
 *       event.args.command  // string — typed
 *     }
 *   });
 */
export function isToolCallForTool<N extends string>(
	toolName: N,
	event: { toolName: string },
): event is { type: "tool_call"; toolCallId: string; toolName: N; args: Record<string, unknown> } {
	return event.toolName === toolName;
}

// ── Streaming Tool Lifecycle Events ────────────────────────────────────────────

/** Fired when a tool begins executing (after tool_call approval). */
export interface ToolExecutionStartEvent {
	type: "tool_execution_start";
	toolCallId: string;
	toolName: string;
}

/** Fired for each incremental output chunk from a long-running tool. */
export interface ToolExecutionUpdateEvent {
	type: "tool_execution_update";
	toolCallId: string;
	toolName: string;
	/** Streaming output chunk — not the full output. */
	chunk: string;
}

/** Fired when a tool finishes executing, immediately before tool_result. */
export interface ToolExecutionEndEvent {
	type: "tool_execution_end";
	toolCallId: string;
	toolName: string;
	durationMs: number;
	isError: boolean;
}

export type ToolExecutionEvent = ToolExecutionStartEvent | ToolExecutionUpdateEvent | ToolExecutionEndEvent;

// ── Message Lifecycle Events ────────────────────────────────────────────────────

/** Fired when the LLM assistant begins streaming a new message in a turn. */
export interface MessageStartEvent {
	type: "message_start";
	turnIndex: number;
}

/** Fired when the LLM assistant finishes streaming a message in a turn. */
export interface MessageEndEvent {
	type: "message_end";
	turnIndex: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

// ── Provider Request Intercept ──────────────────────────────────────────────────

/**
 * Fired before the raw HTTP request is sent to an LLM provider.
 * Handlers can modify the payload to inject params, replace messages, etc.
 *
 * @example
 *   sho.on("before_provider_request", (event, ctx) => {
 *     // log every outbound request
 *     console.error(event.provider, JSON.stringify(event.payload).length, "bytes");
 *   });
 */
export interface BeforeProviderRequestEvent {
	type: "before_provider_request";
	/** Provider identifier (e.g., "anthropic", "openai"). */
	provider: string;
	/** Raw request payload — clone before mutating to avoid aliasing issues. */
	payload: Record<string, unknown>;
}

/** Result from before_provider_request handler. */
export interface BeforeProviderRequestResult {
	/** Replacement payload to send instead. If absent, original is sent unmodified. */
	payload?: Record<string, unknown>;
}

// ── User Bash Intercept ─────────────────────────────────────────────────────────

/** Fired when the user types `!command` (shell prefix) in the prompt input. */
export interface UserBashEvent {
	type: "user_bash";
	command: string;
}

/** Result from user_bash handler. */
export interface UserBashResult {
	/** Override output to return without executing the real command. */
	output?: string;
	/** Set true to skip actual shell execution entirely. */
	handled?: boolean;
}
