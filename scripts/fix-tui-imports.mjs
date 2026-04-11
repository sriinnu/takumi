#!/usr/bin/env node
/**
 * fix-tui-imports.mjs — Rewrites import paths in packages/tui/src after
 * file reorganisation into subdirectories.
 *
 * Usage:  node scripts/fix-tui-imports.mjs [--dry-run]
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname, basename } from "node:path";

const DRY_RUN = process.argv.includes("--dry-run");
const TUI_SRC = join(import.meta.dirname, "..", "packages", "tui", "src");

// ── File relocation map ──────────────────────────────────────────────────────
// Maps the *old* basename (without extension) → new path relative to TUI_SRC.
// Only files that moved need an entry.
const RELOCATIONS = {};

/** Recursively collect every .ts file under a directory. */
function walk(dir) {
	const result = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) result.push(...walk(full));
		else if (entry.name.endsWith(".ts")) result.push(full);
	}
	return result;
}

// Build relocation map dynamically: any .ts file that lives in a subdirectory
// that was PREVIOUSLY at root (we can infer this from the error list).
const MOVED_DIRS = [
	"commands",
	"yagna",
	"agent",
	"chitragupta",
	"autocycle",
	"workflow",
	"http-bridge",
	"editor",
	"input",
];

for (const subdir of MOVED_DIRS) {
	const dirPath = join(TUI_SRC, subdir);
	try {
		for (const f of readdirSync(dirPath)) {
			if (f.endsWith(".ts") && f !== "index.ts") {
				const stem = f.replace(/\.ts$/, "");
				RELOCATIONS[stem] = `${subdir}/${f}`;
			}
		}
	} catch {
		// dir doesn't exist yet
	}
}

console.log(`Relocation map has ${Object.keys(RELOCATIONS).length} entries`);

// ── Collect all .ts files in src/ and test/ ──────────────────────────────────
const TUI_TEST = join(import.meta.dirname, "..", "packages", "tui", "test");
const allFiles = [...walk(TUI_SRC), ...walk(TUI_TEST)];
console.log(`Scanning ${allFiles.length} .ts files`);

// ── Regex to match import/export from statements ─────────────────────────────
// Matches:  import ... from "./foo.js"  or  export ... from "./foo.js"
// Also:     import("./foo.js")
const IMPORT_RE = /(?:from\s+["'])(\.[^"']+\.js)(["'])|(?:import\(["'])(\.[^"']+\.js)(["']\))/g;

let totalChanges = 0;

for (const filePath of allFiles) {
	const fileDir = dirname(filePath);
	const relFromSrc = relative(TUI_SRC, filePath);
	let content = readFileSync(filePath, "utf-8");
	let changed = false;

	const newContent = content.replace(IMPORT_RE, (match, fromPath, q1, dynPath, q2) => {
		const importPath = fromPath || dynPath;
		const quote = q1 || q2;
		const prefix = fromPath ? match.slice(0, match.indexOf(importPath)) : match.slice(0, match.indexOf(importPath));

		// Resolve the import to an absolute stem
		// importPath is like "./foo.js" or "../foo.js" or "./subdir/foo.js"
		const importStem = basename(importPath, ".js");
		const resolvedOld = join(fileDir, importPath.replace(/\.js$/, ".ts"));

		// Check if this import points to a file that was relocated
		// ONLY rewrite if the current import path is broken (file doesn't exist at original location)
		const resolvedCurrent = join(fileDir, importPath.replace(/\.js$/, ".ts"));
		if (existsSync(resolvedCurrent)) {
			// File exists at the current import path — don't touch it
			return match;
		}

		// Case 1: File was relocated to a known subdirectory
		if (RELOCATIONS[importStem]) {
			const newTargetPath = join(TUI_SRC, RELOCATIONS[importStem]);
			const newRel = relative(fileDir, newTargetPath).replace(/\.ts$/, ".js");
			const newImport = newRel.startsWith(".") ? newRel : `./${newRel}`;

			if (newImport !== importPath) {
				changed = true;
				totalChanges++;
				if (DRY_RUN) {
					console.log(`  ${relFromSrc}: "${importPath}" → "${newImport}"`);
				}
				return match.replace(importPath, newImport);
			}
		}

		// Case 2: File is a root-level file referenced from a subdirectory with ./
		// Try to find it at TUI_SRC root
		const rootCandidate = join(TUI_SRC, importStem + ".ts");
		if (existsSync(rootCandidate)) {
			const newRel = relative(fileDir, rootCandidate).replace(/\.ts$/, ".js");
			const newImport = newRel.startsWith(".") ? newRel : `./${newRel}`;
			if (newImport !== importPath) {
				changed = true;
				totalChanges++;
				if (DRY_RUN) {
					console.log(`  ${relFromSrc}: "${importPath}" → "${newImport}"`);
				}
				return match.replace(importPath, newImport);
			}
		}

		// Case 3: Import is a relative path like ./subdir/file.js — try resolving from TUI_SRC
		const subpathCandidate = join(TUI_SRC, importPath.replace(/\.js$/, ".ts"));
		if (existsSync(subpathCandidate)) {
			const newRel = relative(fileDir, subpathCandidate).replace(/\.ts$/, ".js");
			const newImport = newRel.startsWith(".") ? newRel : `./${newRel}`;
			if (newImport !== importPath) {
				changed = true;
				totalChanges++;
				if (DRY_RUN) {
					console.log(`  ${relFromSrc}: "${importPath}" → "${newImport}"`);
				}
				return match.replace(importPath, newImport);
			}
		}

		return match;
	});

	if (changed && !DRY_RUN) {
		writeFileSync(filePath, newContent, "utf-8");
	}
}

console.log(`\n${DRY_RUN ? "[DRY RUN] Would change" : "Changed"} ${totalChanges} import paths`);
