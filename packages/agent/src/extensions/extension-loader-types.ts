/**
 * Extension loader/runner meta-types.
 *
 * Separated from extension-types.ts to keep that file under the 450-line
 * LOC guardrail while leaving room for new event definitions.
 */

import type {
	ExtensionAPI,
	ExtensionToolDefinition,
	RegisteredCommand,
	RegisteredShortcut,
} from "./extension-types.js";

// ── Extension Factory ─────────────────────────────────────────────────────────

/** Extension factory — the default export of an extension module. */
export type ExtensionFactory = (api: ExtensionAPI) => void | Promise<void>;

// ── Loaded State ──────────────────────────────────────────────────────────────

/** Loaded extension with all registered items. */
export interface LoadedExtension {
	path: string;
	resolvedPath: string;
	handlers: Map<string, Array<(...args: unknown[]) => unknown>>;
	tools: Map<string, ExtensionToolDefinition>;
	commands: Map<string, RegisteredCommand>;
	shortcuts: Map<string, RegisteredShortcut>;
}

/** Result of loading extensions. */
export interface LoadExtensionsResult {
	extensions: LoadedExtension[];
	errors: Array<{ path: string; error: string }>;
}

// ── Runtime Error ─────────────────────────────────────────────────────────────

/** Error emitted by the extension runner when a handler throws. */
export interface ExtensionError {
	extensionPath: string;
	event: string;
	error: string;
	stack?: string;
}
