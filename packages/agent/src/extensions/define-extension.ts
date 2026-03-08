/**
 * defineExtension — Phase 45
 *
 * Named, versioned extension declarations with discoverable manifests.
 * Identical at runtime to exporting a raw factory function but attaches
 * a manifest for tooling: `/extensions list`, health monitoring, etc.
 *
 * Usage:
 *   export default defineExtension(
 *     {
 *       name: "tps-meter",
 *       version: "1.0.0",
 *       description: "Displays tokens/s after each agent turn",
 *     },
 *     (sho) => {
 *       sho.on("agent_end", (event, ctx) => {
 *         const tps = computeTps(event.messages);
 *         ctx.notify(`${tps.toFixed(1)} tok/s`, "info");
 *       });
 *     },
 *   );
 *
 * vs raw factory (still valid, no manifest attached):
 *   export default (sho: ExtensionAPI) => {
 *     sho.on("agent_end", ...);
 *   };
 */

import type { ExtensionAPI } from "./extension-api.js";

// ── Manifest ────────────────────────────────────────────────────────────────────

/** Metadata for a named extension declared with defineExtension(). */
export interface ExtensionManifest {
	/**
	 * Unique extension name. Use kebab-case (e.g., "tps-meter").
	 * Shown in `/extensions list` and health check output.
	 */
	name: string;

	/** Semver version string (e.g., "1.0.0"). */
	version?: string;

	/** One-line description shown in `/extensions list`. */
	description?: string;

	/** Author name or contact (e.g., "Alice <alice@example.com>"). */
	author?: string;

	/** URL to documentation or source repository. */
	homepage?: string;

	/**
	 * Minimum Takumi version required (semver range string, e.g., ">=0.45.0").
	 * The loader emits a warning when the running version doesn't satisfy this.
	 */
	minTakumiVersion?: string;
}

// ── Annotated factory ───────────────────────────────────────────────────────────

/** Symbol used to attach the manifest to the factory function. */
export const EXTENSION_MANIFEST_SYMBOL = Symbol.for("takumi.extension.manifest");

/**
 * Extension factory with an optional attached manifest.
 * Returned by defineExtension(); compatible everywhere ExtensionFactory is expected.
 */
export type AnnotatedFactory = ((sho: ExtensionAPI) => void | Promise<void>) & {
	readonly [EXTENSION_MANIFEST_SYMBOL]?: ExtensionManifest;
};

// ── defineExtension ─────────────────────────────────────────────────────────────

/**
 * Declare a named extension with manifest metadata.
 *
 * Equivalent to exporting a raw `(sho) => { ... }` factory but:
 * - Attaches a discoverable manifest for `/extensions list` and health checks
 * - Provides a consistent, self-documenting authoring pattern
 * - Enables future capability declarations without breaking changes
 *
 * @param manifest  Identity metadata — `name` is the only required field.
 * @param setup     Called once at load time to register handlers/commands/tools.
 */
export function defineExtension(manifest: ExtensionManifest, setup: (sho: ExtensionAPI) => void): AnnotatedFactory {
	const factory = (sho: ExtensionAPI): void => setup(sho);
	Object.defineProperty(factory, EXTENSION_MANIFEST_SYMBOL, {
		value: manifest,
		writable: false,
		enumerable: false,
		configurable: false,
	});
	return factory as AnnotatedFactory;
}

/**
 * Extract the manifest from a factory created by defineExtension().
 * Returns undefined for raw (un-annotated) factory functions.
 *
 * @example
 *   const manifest = getExtensionManifest(factory);
 *   console.log(manifest?.name ?? "<anonymous>");
 */
export function getExtensionManifest(factory: (sho: ExtensionAPI) => unknown): ExtensionManifest | undefined {
	return (factory as AnnotatedFactory)[EXTENSION_MANIFEST_SYMBOL];
}
