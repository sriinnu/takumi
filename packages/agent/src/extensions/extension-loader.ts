/**
 * Extension loader — Phase 43
 *
 * Discovers and loads TypeScript extension modules from:
 * 1. Project-local: `<cwd>/.takumi/extensions/`
 * 2. Global: `~/.config/takumi/extensions/`
 * 3. Explicitly configured paths from takumi.config.json
 *
 * Extensions are loaded via dynamic `import()` and must export a default
 * factory function matching `ExtensionFactory`.
 *
 * Design:
 * - Pure functions — no global state.
 * - Each extension gets its own `ExtensionAPI` that writes to its `LoadedExtension`.
 * - Factory is awaited (supports async init).
 * - Errors are collected, never thrown — partial success is fine.
 */

import { existsSync, readFileSync as fsReadFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLogger } from "@takumi/core";
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
	ExtensionToolDefinition,
	LoadExtensionsResult,
	LoadedExtension,
	RegisteredCommand,
} from "./extension-types.js";

const log = createLogger("extension-loader");

// ═══════════════════════════════════════════════════════════════════════════════
// Path Resolution
// ═══════════════════════════════════════════════════════════════════════════════

/** Default global extensions directory. */
function globalExtensionsDir(): string {
	return join(homedir(), ".config", "takumi", "extensions");
}

/** Project-local extensions directory. */
function localExtensionsDir(cwd: string): string {
	return join(cwd, ".takumi", "extensions");
}

/** Expand ~ to home and resolve relative paths against cwd. */
function resolvePath(extPath: string, cwd: string): string {
	const expanded = extPath.startsWith("~/") ? join(homedir(), extPath.slice(2)) : extPath;
	return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

/** Check if a filename looks like an extension entry point. */
function isExtensionFile(name: string): boolean {
	return name.endsWith(".ts") || name.endsWith(".js") || name.endsWith(".mjs");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Discovery
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve extension entry points from a directory.
 *
 * Checks for:
 * 1. `package.json` with `"takumi.extensions"` field → returns declared paths
 * 2. `index.ts` / `index.js` → returns the index file
 *
 * Returns resolved paths or null if no entry points found.
 */
function resolveEntryPoints(dir: string): string[] | null {
	const pkgPath = join(dir, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgPath));
			const entries: string[] = pkg?.takumi?.extensions ?? [];
			if (entries.length > 0) {
				const resolved = entries.map((e: string) => resolve(dir, e)).filter((p: string) => existsSync(p));
				if (resolved.length > 0) return resolved;
			}
		} catch {
			// ignore malformed package.json
		}
	}

	for (const name of ["index.ts", "index.js", "index.mjs"]) {
		const indexPath = join(dir, name);
		if (existsSync(indexPath)) return [indexPath];
	}

	return null;
}

/**
 * Discover extension entry points in a directory.
 *
 * Discovery rules (no recursion beyond one level):
 * 1. Direct files: `*.ts`, `*.js`, `*.mjs` → load
 * 2. Subdirectories → resolveEntryPoints (package.json or index.ts)
 */
function discoverInDir(dir: string): string[] {
	if (!existsSync(dir)) return [];

	const discovered: string[] = [];

	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const entryPath = join(dir, entry.name);

			if (entry.isFile() && isExtensionFile(entry.name)) {
				discovered.push(entryPath);
				continue;
			}

			if (entry.isDirectory()) {
				const points = resolveEntryPoints(entryPath);
				if (points) discovered.push(...points);
			}
		}
	} catch {
		// directory not readable
	}

	return discovered;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Loading
// ═══════════════════════════════════════════════════════════════════════════════

/** Synchronous read for package.json (only used during discovery). */
function readFileSync(filePath: string): string {
	return fsReadFileSync(filePath, "utf-8");
}

/** Create an empty LoadedExtension shell. */
function createExtension(extPath: string, resolvedPath: string): LoadedExtension {
	return {
		path: extPath,
		resolvedPath,
		handlers: new Map(),
		tools: new Map(),
		commands: new Map(),
		shortcuts: new Map(),
	};
}

/** Create the ExtensionAPI scoped to a specific extension. */
function createExtensionAPI(extension: LoadedExtension, _cwd: string): ExtensionAPI {
	return {
		on(event: string, handler: (...args: unknown[]) => unknown): void {
			const list = extension.handlers.get(event) ?? [];
			list.push(handler);
			extension.handlers.set(event, list);
		},

		registerTool(tool: ExtensionToolDefinition): void {
			extension.tools.set(tool.name, tool);
			log.info(`Extension ${extension.path} registered tool: ${tool.name}`);
		},

		registerCommand(name: string, options: Omit<RegisteredCommand, "name">): void {
			extension.commands.set(name, { name, ...options });
			log.info(`Extension ${extension.path} registered command: /${name}`);
		},

		registerShortcut(
			key: string,
			options: { description?: string; handler: (ctx: ExtensionContext) => Promise<void> | void },
		): void {
			extension.shortcuts.set(key, { key, extensionPath: extension.path, ...options });
			log.info(`Extension ${extension.path} registered shortcut: ${key}`);
		},

		// Action stubs — replaced by runner.bindActions() at runtime
		sendUserMessage: () => {
			throw new Error("sendUserMessage not available during extension loading");
		},
		getActiveTools: () => {
			throw new Error("getActiveTools not available during extension loading");
		},
		setActiveTools: () => {
			throw new Error("setActiveTools not available during extension loading");
		},
		exec: () => {
			throw new Error("exec not available during extension loading");
		},
	} as ExtensionAPI;
}

/** Import an extension module and extract the factory function. */
async function importFactory(resolvedPath: string): Promise<ExtensionFactory | undefined> {
	try {
		const url = pathToFileURL(resolvedPath).href;
		const mod = await import(url);
		const factory = mod.default ?? mod;
		return typeof factory === "function" ? (factory as ExtensionFactory) : undefined;
	} catch (err) {
		log.error(`Failed to import extension: ${resolvedPath}`, err);
		return undefined;
	}
}

/** Load a single extension from a resolved path. */
async function loadOne(
	extPath: string,
	cwd: string,
): Promise<{ extension: LoadedExtension | null; error: string | null }> {
	const resolvedPath = resolvePath(extPath, cwd);

	const factory = await importFactory(resolvedPath);
	if (!factory) {
		return { extension: null, error: `No valid factory function exported from ${extPath}` };
	}

	const extension = createExtension(extPath, resolvedPath);
	const api = createExtensionAPI(extension, cwd);

	try {
		await factory(api);
		log.info(
			`Loaded extension: ${extPath} (${extension.tools.size} tools, ${extension.commands.size} commands, ${extension.shortcuts.size} shortcuts)`,
		);
		return { extension, error: null };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { extension: null, error: `Extension factory failed: ${message}` };
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Load extensions from explicit file paths.
 */
export async function loadExtensions(paths: string[], cwd: string): Promise<LoadExtensionsResult> {
	const extensions: LoadedExtension[] = [];
	const errors: Array<{ path: string; error: string }> = [];

	for (const extPath of paths) {
		const { extension, error } = await loadOne(extPath, cwd);
		if (error) {
			errors.push({ path: extPath, error });
			log.warn(`Skipped extension ${extPath}: ${error}`);
			continue;
		}
		if (extension) extensions.push(extension);
	}

	return { extensions, errors };
}

/**
 * Discover extensions from standard locations and load them.
 *
 * Discovery order:
 * 1. `<cwd>/.takumi/extensions/` — project-local
 * 2. `~/.config/takumi/extensions/` — global
 * 3. Explicitly configured paths
 *
 * Deduplicates by resolved absolute path.
 */
export async function discoverAndLoadExtensions(configuredPaths: string[], cwd: string): Promise<LoadExtensionsResult> {
	const allPaths: string[] = [];
	const seen = new Set<string>();

	const addPaths = (paths: string[]): void => {
		for (const p of paths) {
			const resolved = resolvePath(p, cwd);
			if (!seen.has(resolved)) {
				seen.add(resolved);
				allPaths.push(p);
			}
		}
	};

	// 1. Project-local
	addPaths(discoverInDir(localExtensionsDir(cwd)));

	// 2. Global
	addPaths(discoverInDir(globalExtensionsDir()));

	// 3. Configured paths (may be files or directories)
	for (const p of configuredPaths) {
		const resolved = resolvePath(p, cwd);
		if (existsSync(resolved) && statSync(resolved).isDirectory()) {
			const entries = resolveEntryPoints(resolved);
			if (entries) {
				addPaths(entries);
			} else {
				addPaths(discoverInDir(resolved));
			}
		} else {
			addPaths([resolved]);
		}
	}

	log.info(`Discovered ${allPaths.length} extension entry points`);
	return loadExtensions(allPaths, cwd);
}

/**
 * Load an extension from an inline factory (for testing or programmatic use).
 */
export async function loadExtensionFromFactory(
	factory: ExtensionFactory,
	cwd: string,
	extensionPath = "<inline>",
): Promise<LoadedExtension> {
	const extension = createExtension(extensionPath, extensionPath);
	const api = createExtensionAPI(extension, cwd);
	await factory(api);
	return extension;
}
