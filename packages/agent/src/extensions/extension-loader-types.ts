/**
 * Extension loader/runner meta-types.
 *
 * Separated from extension-types.ts to keep that file under the 450-line
 * LOC guardrail while leaving room for new event definitions.
 */

import type { AnnotatedFactory, ExtensionManifest } from "./define-extension.js";
import type { ExtensionBridgeRegistry } from "./extension-bridge.js";
import type { ExtensionToolDefinition, RegisteredCommand, RegisteredShortcut } from "./extension-types.js";

// ── Extension Factory ─────────────────────────────────────────────────────────

/**
 * Extension factory — the default export of an extension module.
 * May optionally carry a manifest (when created via defineExtension()).
 */
export type ExtensionFactory = AnnotatedFactory;

// ── Action Slots ──────────────────────────────────────────────────────────────

/**
 * Mutable action slots on each LoadedExtension.
 * Filled in by runner.bindActions() so closures captured by `sho` during
 * setup work correctly once the host environment is fully ready.
 */
export interface ExtensionActionSlots {
	sendUserMessage: (content: string) => void;
	getActiveTools: () => string[];
	setActiveTools: (names: string[]) => void;
	exec: (command: string, args?: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
	getSessionName: () => string | undefined;
	setSessionName: (name: string) => void;
}

// ── Loaded State ──────────────────────────────────────────────────────────────

/** Loaded extension with all registered items. */
export interface LoadedExtension {
	path: string;
	resolvedPath: string;
	handlers: Map<string, Array<(...args: unknown[]) => unknown>>;
	tools: Map<string, ExtensionToolDefinition>;
	commands: Map<string, RegisteredCommand>;
	shortcuts: Map<string, RegisteredShortcut>;
	/** Manifest attached by defineExtension(), or undefined for raw factories. */
	manifest: ExtensionManifest | undefined;
	/**
	 * Mutable action slots. Stubs initially; bindActions() replaces them with
	 * real implementations so `sho.exec()` etc. work inside handlers.
	 * @internal
	 */
	_actions: ExtensionActionSlots;
}

/** Result of loading a set of extensions. */
export interface LoadExtensionsResult {
	extensions: LoadedExtension[];
	errors: Array<{ path: string; error: string }>;
	/** Shared bridge registry — all loaded extensions can publish/subscribe. */
	bridge: ExtensionBridgeRegistry;
}

// ── Runtime Error ─────────────────────────────────────────────────────────────

/** Error emitted by the extension runner when a handler throws. */
export interface ExtensionError {
	extensionPath: string;
	event: string;
	error: string;
	stack?: string;
}
