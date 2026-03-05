/**
 * Extension runner — Phase 44
 *
 * Executes loaded extensions and manages their lifecycle at runtime.
 * Dispatches events to registered handlers, collects results, and
 * provides the runtime context that event handlers operate in.
 *
 * Design:
 * - `bindActions()` wires real implementations into the stubs created by the loader.
 * - Each `emit*()` variant handles a different result-collection pattern:
 *   fire-and-forget, first-cancels, chained-transform, first-wins.
 * - Errors from extensions are emitted to listeners, never thrown to callers.
 * - `createContext()` builds a fresh ExtensionContext per emit, resolving values
 *   lazily so runtime changes (model swap, cwd change) are always reflected.
 *
 * Heavy emitters live in `extension-emitters.ts` to stay under the 450-LOC guardrail.
 */

import type { Message } from "@takumi/core";
import { createLogger } from "@takumi/core";
import {
	emitBeforeAgentStartImpl,
	emitCancellableImpl,
	emitContextImpl,
	emitImpl,
	emitInputImpl,
	emitToolCallImpl,
	emitToolResultImpl,
} from "./extension-emitters.js";
import type {
	ContextUsage,
	ExtensionContext,
	ExtensionError,
	ExtensionEvent,
	InputEventResult,
	InputSource,
	LoadedExtension,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
} from "./extension-types.js";

const log = createLogger("extension-runner");

// ═══════════════════════════════════════════════════════════════════════════════
// Action Bindings — injected by the host (TUI, CLI, etc.)
// ═══════════════════════════════════════════════════════════════════════════════

/** Actions the host must provide for ExtensionContext methods. */
export interface ExtensionContextActions {
	getModel: () => string | undefined;
	getSessionId: () => string | undefined;
	getCwd: () => string;
	isIdle: () => boolean;
	abort: () => void;
	getContextUsage: () => ContextUsage | undefined;
	getSystemPrompt: () => string;
	compact: () => void;
	shutdown: () => void;
}

/** Actions the host must provide for ExtensionAPI action methods. */
export interface ExtensionAPIActions {
	sendUserMessage: (content: string) => void;
	getActiveTools: () => string[];
	setActiveTools: (names: string[]) => void;
	exec: (command: string, args?: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

/** Actions for ExtensionCommandContext (user-initiated commands only). */
export interface ExtensionCommandActions {
	waitForIdle: () => Promise<void>;
	newSession: () => Promise<{ cancelled: boolean }>;
	switchSession: (sessionId: string) => Promise<{ cancelled: boolean }>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Error Listener
// ═══════════════════════════════════════════════════════════════════════════════

export type ExtensionErrorListener = (error: ExtensionError) => void;

// ═══════════════════════════════════════════════════════════════════════════════
// ExtensionRunner
// ═══════════════════════════════════════════════════════════════════════════════

export class ExtensionRunner {
	/** @internal exposed for emitters module */
	readonly _extensions: LoadedExtension[];
	/** @internal exposed for emitters module */
	_contextActions: ExtensionContextActions;
	/** @internal exposed for emitters module */
	_apiActions: ExtensionAPIActions;
	/** @internal exposed for emitters module */
	readonly _errorListeners = new Set<ExtensionErrorListener>();

	constructor(extensions: LoadedExtension[]) {
		this._extensions = extensions;

		// Initialized with throwing stubs — must call bindActions() before use.
		const notBound = (name: string) => () => {
			throw new Error(`ExtensionRunner.${name}: bindActions() not called yet`);
		};
		this._contextActions = {
			getModel: notBound("getModel"),
			getSessionId: notBound("getSessionId"),
			getCwd: notBound("getCwd") as () => string,
			isIdle: notBound("isIdle") as () => boolean,
			abort: notBound("abort"),
			getContextUsage: notBound("getContextUsage") as () => ContextUsage | undefined,
			getSystemPrompt: notBound("getSystemPrompt") as () => string,
			compact: notBound("compact"),
			shutdown: notBound("shutdown"),
		};
		this._apiActions = {
			sendUserMessage: notBound("sendUserMessage"),
			getActiveTools: notBound("getActiveTools") as () => string[],
			setActiveTools: notBound("setActiveTools"),
			exec: notBound("exec") as ExtensionAPIActions["exec"],
		};
	}

	// ── Binding ─────────────────────────────────────────────────────────────────

	/** Bind runtime action implementations. Must be called before emitting events. */
	bindActions(contextActions: ExtensionContextActions, apiActions: ExtensionAPIActions): void {
		this._contextActions = contextActions;
		this._apiActions = apiActions;
		log.info(`Bound actions for ${this._extensions.length} extensions`);
	}

	// ── Error Handling ──────────────────────────────────────────────────────────

	/** Subscribe to extension errors. Returns unsubscribe function. */
	onError(listener: ExtensionErrorListener): () => void {
		this._errorListeners.add(listener);
		return () => this._errorListeners.delete(listener);
	}

	/** @internal Emit an error to all listeners. */
	emitError(error: ExtensionError): void {
		log.warn(`Extension error [${error.extensionPath}/${error.event}]: ${error.error}`);
		for (const listener of this._errorListeners) {
			listener(error);
		}
	}

	// ── Context Factory ─────────────────────────────────────────────────────────

	/** Create an ExtensionContext with values resolved lazily from actions. */
	createContext(): ExtensionContext {
		const actions = this._contextActions;
		return {
			get cwd() {
				return actions.getCwd();
			},
			get model() {
				return actions.getModel();
			},
			get sessionId() {
				return actions.getSessionId();
			},
			isIdle: () => actions.isIdle(),
			abort: () => actions.abort(),
			getContextUsage: () => actions.getContextUsage(),
			getSystemPrompt: () => actions.getSystemPrompt(),
			compact: () => actions.compact(),
			shutdown: () => actions.shutdown(),
		};
	}

	// ── Queries ─────────────────────────────────────────────────────────────────

	/** Check if any extension has handlers for the given event type. */
	hasHandlers(eventType: string): boolean {
		for (const ext of this._extensions) {
			const handlers = ext.handlers.get(eventType);
			if (handlers && handlers.length > 0) return true;
		}
		return false;
	}

	/** Get all registered tools from all extensions (first registration wins). */
	getAllTools(): Map<string, { tool: any; extensionPath: string }> {
		const result = new Map<string, { tool: any; extensionPath: string }>();
		for (const ext of this._extensions) {
			for (const [name, tool] of ext.tools) {
				if (!result.has(name)) result.set(name, { tool, extensionPath: ext.path });
			}
		}
		return result;
	}

	/** Get all registered commands from all extensions (first registration wins). */
	getAllCommands(): Map<string, { command: any; extensionPath: string }> {
		const result = new Map<string, { command: any; extensionPath: string }>();
		for (const ext of this._extensions) {
			for (const [name, command] of ext.commands) {
				if (!result.has(name)) result.set(name, { command, extensionPath: ext.path });
			}
		}
		return result;
	}

	/** Get all registered shortcuts from all extensions. */
	getAllShortcuts(): Map<string, any> {
		const result = new Map<string, any>();
		for (const ext of this._extensions) {
			for (const [key, shortcut] of ext.shortcuts) {
				if (!result.has(key)) result.set(key, shortcut);
			}
		}
		return result;
	}

	/** Get extension paths. */
	getExtensionPaths(): string[] {
		return this._extensions.map((e) => e.path);
	}

	// ── Event Emission (delegated to extension-emitters.ts) ─────────────────────

	/** Fire-and-forget event. */
	async emit(event: ExtensionEvent): Promise<void> {
		return emitImpl(this, event);
	}

	/** Cancellable session event. Returns first cancel result or undefined. */
	async emitCancellable(event: ExtensionEvent & { type: "session_before_switch" | "session_before_compact" }) {
		return emitCancellableImpl(this, event);
	}

	/** Context transform — chains messages through handlers. */
	async emitContext(messages: Message[]): Promise<Message[]> {
		return emitContextImpl(this, messages);
	}

	/** Before agent start — collects prompt overrides and injected messages. */
	async emitBeforeAgentStart(prompt: string, systemPrompt: string) {
		return emitBeforeAgentStartImpl(this, prompt, systemPrompt);
	}

	/** Tool call — first blocker wins. */
	async emitToolCall(event: ToolCallEvent): Promise<ToolCallEventResult | undefined> {
		return emitToolCallImpl(this, event);
	}

	/** Tool result — chained modification. */
	async emitToolResult(event: ToolResultEvent): Promise<ToolResultEventResult | undefined> {
		return emitToolResultImpl(this, event);
	}

	/** Input transform — transform/handle chain. */
	async emitInput(text: string, source: InputSource): Promise<InputEventResult> {
		return emitInputImpl(this, text, source);
	}
}
