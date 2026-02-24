#!/usr/bin/env node

/**
 * Enforces the Takumi source-file line-count guardrail.
 *
 * Policy:
 * - No production source file may exceed MAX_SOURCE_LINES.
 * - Test/spec files are excluded.
 * - Generated declaration files are excluded.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";

const MAX_SOURCE_LINES = 450;
const ROOT = process.cwd();
const SOURCE_DIRS = ["bin", "packages"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

/**
 * Returns true when a path points to a source file that should be checked.
 */
function isTrackableSourceFile(filePath) {
	const ext = extname(filePath);
	if (!SOURCE_EXTENSIONS.has(ext)) return false;
	if (filePath.endsWith(".d.ts")) return false;
	if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath)) return false;
	if (filePath.includes("/node_modules/")) return false;
	if (filePath.includes("/dist/")) return false;
	return true;
}

/**
 * Recursively collects all files under a directory.
 */
async function walkFiles(dirPath, out = []) {
	const entries = await readdir(dirPath, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = join(dirPath, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "dist") continue;
			await walkFiles(fullPath, out);
			continue;
		}
		out.push(fullPath);
	}
	return out;
}

/**
 * Counts logical lines in a UTF-8 text file.
 */
async function countLines(filePath) {
	const content = await readFile(filePath, "utf-8");
	if (content.length === 0) return 0;
	return content.split("\n").length;
}

async function main() {
	const candidates = [];

	for (const dir of SOURCE_DIRS) {
		const full = join(ROOT, dir);
		try {
			const info = await stat(full);
			if (!info.isDirectory()) continue;
			const files = await walkFiles(full);
			candidates.push(...files.filter(isTrackableSourceFile));
		} catch {
			// Directory is optional in some workspaces.
		}
	}

	const offenders = [];
	for (const filePath of candidates) {
		const lines = await countLines(filePath);
		if (lines > MAX_SOURCE_LINES) {
			offenders.push({ filePath, lines });
		}
	}

	offenders.sort((a, b) => b.lines - a.lines || a.filePath.localeCompare(b.filePath));

	if (offenders.length === 0) {
		console.log(`LOC guard passed. All tracked source files are <= ${MAX_SOURCE_LINES} lines.`);
		return;
	}

	console.error(`LOC guard failed. ${offenders.length} source files exceed ${MAX_SOURCE_LINES} lines:`);
	for (const offender of offenders) {
		const rel = offender.filePath.startsWith(`${ROOT}/`) ? offender.filePath.slice(ROOT.length + 1) : offender.filePath;
		console.error(`  - ${rel}: ${offender.lines} lines`);
	}
	process.exit(1);
}

main().catch((error) => {
	console.error(`LOC guard crashed: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
