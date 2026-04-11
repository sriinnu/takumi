/**
 * Extension event emitters — extracted from extension-runner.ts
 *
 * Each function implements a different result-collection pattern:
 * - `emitImpl`: fire-and-forget
 * - `emitCancellableImpl`: first-cancel wins
 * - `emitContextImpl`: chained message transform
 * - `emitBeforeAgentStartImpl`: collect prompt overrides + message injections
 * - `emitToolCallImpl`: first-block wins
 * - `emitToolResultImpl`: chained output modification
 * - `emitInputImpl`: transform/handled chain
 *
 * All functions accept the runner as first arg so they can access
 * `_extensions`, `createContext()`, and `emitError()`.
 */

import type { Message } from "@takumi/core";
import type { ExtensionRunner } from "./extension-runner.js";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ContextEvent,
	ContextEventResult,
	ExtensionEvent,
	InputEvent,
	InputEventResult,
	InputSource,
	SessionBeforeCompactResult,
	SessionBeforeSwitchResult,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
} from "./extension-types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

type CancellableResult = SessionBeforeSwitchResult | SessionBeforeCompactResult;

function makeError(err: unknown): { message: string; stack: string | undefined } {
	return {
		message: err instanceof Error ? err.message : String(err),
		stack: err instanceof Error ? err.stack : undefined,
	};
}

// ── Fire-and-Forget ─────────────────────────────────────────────────────────

export async function emitImpl(runner: ExtensionRunner, event: ExtensionEvent): Promise<void> {
	for (const ext of runner._extensions) {
		const ctx = runner.createContext(ext);
		const handlers = ext.handlers.get(event.type);
		if (!handlers || handlers.length === 0) continue;
		for (const handler of handlers) {
			try {
				await handler(event, ctx);
			} catch (err) {
				const e = makeError(err);
				runner.emitError({ extensionPath: ext.path, event: event.type, error: e.message, stack: e.stack });
			}
		}
	}
}

// ── Cancellable ─────────────────────────────────────────────────────────────

export async function emitCancellableImpl(
	runner: ExtensionRunner,
	event: ExtensionEvent & { type: "session_before_switch" | "session_before_compact" },
): Promise<CancellableResult | undefined> {
	let pendingResult: CancellableResult | undefined;
	for (const ext of runner._extensions) {
		const ctx = runner.createContext(ext);
		const handlers = ext.handlers.get(event.type);
		if (!handlers || handlers.length === 0) continue;
		for (const handler of handlers) {
			try {
				const result = (await handler(event, ctx)) as CancellableResult | undefined;
				if (!result) continue;
				pendingResult = { ...(pendingResult ?? {}), ...result };
				if (result.cancel) return pendingResult;
			} catch (err) {
				const e = makeError(err);
				runner.emitError({ extensionPath: ext.path, event: event.type, error: e.message, stack: e.stack });
			}
		}
	}
	if (pendingResult && Object.keys(pendingResult).length === 1 && pendingResult.cancel === false) {
		return undefined;
	}
	return pendingResult;
}

// ── Context Transform ───────────────────────────────────────────────────────

export async function emitContextImpl(runner: ExtensionRunner, messages: Message[]): Promise<Message[]> {
	if (!runner.hasHandlers("context")) return messages;
	// Lazy clone — only pay the cost when at least one handler will actually run.
	// Object.freeze on the snapshot catches accidental in-place mutation.
	let current: Message[] | null = null;
	for (const ext of runner._extensions) {
		const ctx = runner.createContext(ext);
		const handlers = ext.handlers.get("context");
		if (!handlers || handlers.length === 0) continue;
		if (!current) current = structuredClone(messages);
		for (const handler of handlers) {
			try {
				const event: ContextEvent = { type: "context", messages: current };
				const result = (await handler(event, ctx)) as ContextEventResult | undefined;
				if (result?.messages) current = result.messages;
			} catch (err) {
				const e = makeError(err);
				runner.emitError({ extensionPath: ext.path, event: "context", error: e.message, stack: e.stack });
			}
		}
	}
	return current ?? messages;
}

// ── Before Agent Start ──────────────────────────────────────────────────────

export async function emitBeforeAgentStartImpl(
	runner: ExtensionRunner,
	prompt: string,
	systemPrompt: string,
): Promise<{ systemPrompt?: string; injectedMessages: Array<{ content: string }> } | undefined> {
	const injectedMessages: Array<{ content: string }> = [];
	let currentSystemPrompt = systemPrompt;
	let modified = false;

	for (const ext of runner._extensions) {
		const ctx = runner.createContext(ext);
		const handlers = ext.handlers.get("before_agent_start");
		if (!handlers || handlers.length === 0) continue;
		for (const handler of handlers) {
			try {
				const event: BeforeAgentStartEvent = {
					type: "before_agent_start",
					prompt,
					systemPrompt: currentSystemPrompt,
				};
				const result = (await handler(event, ctx)) as BeforeAgentStartEventResult | undefined;
				if (result) {
					if (result.systemPrompt !== undefined) {
						currentSystemPrompt = result.systemPrompt;
						modified = true;
					}
					if (result.injectMessage) {
						injectedMessages.push(result.injectMessage);
						modified = true;
					}
				}
			} catch (err) {
				const e = makeError(err);
				runner.emitError({
					extensionPath: ext.path,
					event: "before_agent_start",
					error: e.message,
					stack: e.stack,
				});
			}
		}
	}

	return modified ? { systemPrompt: currentSystemPrompt, injectedMessages } : undefined;
}

// ── Tool Call (Block) ───────────────────────────────────────────────────────

export async function emitToolCallImpl(
	runner: ExtensionRunner,
	event: ToolCallEvent,
): Promise<ToolCallEventResult | undefined> {
	// Dispatch to both generic "tool_call" handlers AND filtered "tool_call:<toolName>" handlers.
	const filteredKey = `tool_call:${event.toolName}`;
	for (const ext of runner._extensions) {
		const ctx = runner.createContext(ext);
		for (const key of ["tool_call", filteredKey]) {
			const handlers = ext.handlers.get(key);
			if (!handlers || handlers.length === 0) continue;
			for (const handler of handlers) {
				try {
					const result = (await handler(event, ctx)) as ToolCallEventResult | undefined;
					if (result?.block) return result;
				} catch (err) {
					const e = makeError(err);
					runner.emitError({ extensionPath: ext.path, event: key, error: e.message, stack: e.stack });
				}
			}
		}
	}
	return undefined;
}

// ── Tool Result (Modify) ────────────────────────────────────────────────────

export async function emitToolResultImpl(
	runner: ExtensionRunner,
	event: ToolResultEvent,
): Promise<ToolResultEventResult | undefined> {
	let modified = false;
	const current = { ...event };

	for (const ext of runner._extensions) {
		const ctx = runner.createContext(ext);
		const handlers = ext.handlers.get("tool_result");
		if (!handlers || handlers.length === 0) continue;
		for (const handler of handlers) {
			try {
				const result = (await handler(current, ctx)) as ToolResultEventResult | undefined;
				if (result) {
					if (result.output !== undefined) {
						current.result = { ...current.result, output: result.output };
						modified = true;
					}
					if (result.isError !== undefined) {
						current.isError = result.isError;
						modified = true;
					}
				}
			} catch (err) {
				const e = makeError(err);
				runner.emitError({ extensionPath: ext.path, event: "tool_result", error: e.message, stack: e.stack });
			}
		}
	}

	return modified ? { output: current.result.output, isError: current.isError } : undefined;
}

// ── Input Transform ─────────────────────────────────────────────────────────

export async function emitInputImpl(
	runner: ExtensionRunner,
	text: string,
	source: InputSource,
): Promise<InputEventResult> {
	let currentText = text;

	for (const ext of runner._extensions) {
		const ctx = runner.createContext(ext);
		const handlers = ext.handlers.get("input");
		if (!handlers || handlers.length === 0) continue;
		for (const handler of handlers) {
			try {
				const event: InputEvent = { type: "input", text: currentText, source };
				const result = (await handler(event, ctx)) as InputEventResult | undefined;
				if (result?.action === "handled") return result;
				if (result?.action === "transform") currentText = result.text;
			} catch (err) {
				const e = makeError(err);
				runner.emitError({ extensionPath: ext.path, event: "input", error: e.message, stack: e.stack });
			}
		}
	}

	return currentText !== text ? { action: "transform", text: currentText } : { action: "continue" };
}
