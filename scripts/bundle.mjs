/**
 * Bundles the Takumi CLI into a single self-contained CJS file at dist/takumi.cjs.
 *
 * External (NOT inlined — must be installed as runtime deps):
 *   - yoga-wasm-web  (WASM binary, can't be inlined)
 *   - better-sqlite3 (native Node.js addon, optional)
 *
 * Usage:
 *   node scripts/bundle.mjs              # build dist/takumi.cjs
 *   node scripts/bundle.mjs --watch      # rebuild on changes
 */

import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const isWatch = process.argv.includes("--watch");

const require = createRequire(import.meta.url);

// Ensure dist/ exists
if (!existsSync(join(root, "dist"))) {
	mkdirSync(join(root, "dist"), { recursive: true });
}

// Copy yoga.wasm into dist/ so the bundled file can find it at runtime
const wasmSrc = join(root, "node_modules", ".pnpm", "yoga-wasm-web@0.3.3", "node_modules", "yoga-wasm-web", "dist", "yoga.wasm");
// Fallback: resolve via require
function findWasmPath() {
	try {
		// pnpm hoisted location
		if (existsSync(wasmSrc)) return wasmSrc;
		// Standard npm location
		const hoisted = join(root, "node_modules", "yoga-wasm-web", "dist", "yoga.wasm");
		if (existsSync(hoisted)) return hoisted;
	} catch {}
	return null;
}

// ── esbuild config ────────────────────────────────────────────────────────────

/** @type {import('esbuild').BuildOptions} */
const config = {
	entryPoints: [join(root, "bin", "takumi.ts")],
	bundle: true,
	platform: "node",
	target: "node22",
	format: "cjs",
	outfile: join(root, "dist", "takumi.cjs"),
	external: [
		// WASM — bundled separately (copied to dist/)
		"yoga-wasm-web",
		// Native addons
		"better-sqlite3",
		"fsevents",
	],
	banner: {
		js: "#!/usr/bin/env node",
	},
	alias: {
		// Resolve workspace packages from source (so we bundle them)
		"@takumi/core": join(root, "packages", "core", "src", "index.ts"),
		"@takumi/render": join(root, "packages", "render", "src", "index.ts"),
		"@takumi/bridge": join(root, "packages", "bridge", "src", "index.ts"),
		"@takumi/agent": join(root, "packages", "agent", "src", "index.ts"),
		"@takumi/tui": join(root, "packages", "tui", "src", "index.ts"),
	},
	// Keep dynamic import() calls intact for lazy-loaded CLI commands
	splitting: false,
	treeShaking: true,
	minify: false,
	sourcemap: false,
	logLevel: "info",
};

if (isWatch) {
	const ctx = await esbuild.context(config);
	await ctx.watch();
	console.log("Watching for changes…");
} else {
	const result = await esbuild.build(config);

	if (result.errors.length) {
		process.exit(1);
	}

	// esbuild preserves the source-file shebang (#!/usr/bin/env tsx) and then
	// appends our banner shebang on the next line, which Node.js rejects.
	// Fix: read the output, strip any leading non-node shebang, keep ours.
	const outPath = join(root, "dist", "takumi.cjs");
	const { readFileSync, writeFileSync: wfs } = await import("node:fs");
	let src = readFileSync(outPath, "utf-8");
	// Remove every shebang line except the first "#!/usr/bin/env node" one
	src = src.replace(/^(#!.*\r?\n)+/, "#!/usr/bin/env node\n");
	wfs(outPath, src, "utf-8");

	// Copy yoga.wasm next to the bundle so it can be resolved at runtime
	const wasmSrcPath = findWasmPath();
	if (wasmSrcPath) {
		const wasmDest = join(root, "dist", "yoga.wasm");
		cpSync(wasmSrcPath, wasmDest);
		console.log(`Copied yoga.wasm → dist/yoga.wasm`);
	} else {
		console.warn("Warning: yoga.wasm not found — layout may fall back to stub");
	}

	// Write a tiny ESM re-export shim for environments that expect .js
	// (npm bin entries work fine with .cjs but some tools look for .js)
	const shimPath = join(root, "dist", "takumi.js");
	writeFileSync(
		shimPath,
		[
			"#!/usr/bin/env node",
			`// Re-exports the CJS bundle`,
			`import { createRequire } from "module";`,
			`const require = createRequire(import.meta.url);`,
			`require("./takumi.cjs");`,
		].join("\n"),
		"utf-8",
	);

	// Make shim executable
	try {
		const { chmodSync } = await import("node:fs");
		chmodSync(join(root, "dist", "takumi.cjs"), 0o755);
		chmodSync(shimPath, 0o755);
	} catch {}

	console.log("\n✓ dist/takumi.cjs ready");
	console.log("  npm install -g . && takumi --help");
}
