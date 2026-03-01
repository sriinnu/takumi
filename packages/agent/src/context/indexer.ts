/**
 * Codebase indexer — walks source files, extracts symbols (functions, classes,
 * interfaces, types, exports), and persists an incremental index to
 * .takumi/index.json for use by the RAG context injector.
 *
 * Incremental: re-indexes only files whose mtime has changed since last run.
 * No external deps — regex-based extraction + Node fs.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface IndexedSymbol {
	kind: "function" | "class" | "interface" | "type" | "const" | "export";
	name: string;
	/** Absolute file path. */
	file: string;
	/** Relative path from project root. */
	relPath: string;
	/** Extracted snippet — up to 3 lines of context. */
	snippet: string;
	/** Line number (1-based). */
	line: number;
}

export interface FileEntry {
	path: string;
	relPath: string;
	mtime: number;
	symbols: IndexedSymbol[];
}

export interface CodebaseIndex {
	root: string;
	builtAt: number;
	files: FileEntry[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const SUPPORTED_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".rb"]);
const MAX_FILE_BYTES = 200_000;
const INDEX_FILE = ".takumi/index.json";
const IGNORE_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"out",
	".next",
	".nuxt",
	"__pycache__",
	"vendor",
	".cache",
	"coverage",
	".turbo",
]);

// ── Symbol extraction ─────────────────────────────────────────────────────────

interface Pattern {
	kind: IndexedSymbol["kind"];
	re: RegExp;
}

const PATTERNS: Pattern[] = [
	// TypeScript / JavaScript
	{ kind: "class", re: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/ },
	{ kind: "interface", re: /^(?:export\s+)?interface\s+(\w+)/ },
	{ kind: "type", re: /^(?:export\s+)?type\s+(\w+)\s*[=<]/ },
	{ kind: "function", re: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/ },
	{ kind: "const", re: /^(?:export\s+)?const\s+(\w+)\s*[=:]/ },
	// Python
	{ kind: "function", re: /^(?:async\s+)?def\s+(\w+)\s*\(/ },
	{ kind: "class", re: /^class\s+(\w+)(?:\(|:)/ },
	// Go
	{ kind: "function", re: /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/ },
	// Rust
	{ kind: "function", re: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/ },
	{ kind: "class", re: /^(?:pub\s+)?struct\s+(\w+)/ },
];

function extractSymbols(source: string, file: string, relPath: string): IndexedSymbol[] {
	const lines = source.split("\n");
	const symbols: IndexedSymbol[] = [];
	const seen = new Set<string>();

	for (let i = 0; i < lines.length; i++) {
		const chunk = lines.slice(i, Math.min(i + 3, lines.length)).join("\n");
		for (const { kind, re } of PATTERNS) {
			const m = chunk.match(re);
			if (!m?.[1]) continue;
			const key = `${kind}:${m[1]}:${i}`;
			if (seen.has(key)) continue;
			seen.add(key);
			symbols.push({
				kind,
				name: m[1],
				file,
				relPath,
				snippet: chunk.trim().slice(0, 240),
				line: i + 1,
			});
		}
	}
	return symbols;
}

// ── File collection ───────────────────────────────────────────────────────────

function loadGitignoreNames(root: string): Set<string> {
	const gi = join(root, ".gitignore");
	if (!existsSync(gi)) return new Set();
	const names = new Set<string>();
	for (const line of readFileSync(gi, "utf-8").split("\n")) {
		const t = line.trim();
		if (!t || t.startsWith("#")) continue;
		// Record basename-level patterns only (skip paths with slashes)
		const name = t.replace(/^\//, "").replace(/\/$/, "");
		if (!name.includes("/")) names.add(name);
	}
	return names;
}

async function collectFiles(dir: string, ignored: Set<string>): Promise<string[]> {
	const result: string[] = [];
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	for (const e of entries) {
		if (IGNORE_DIRS.has(e.name) || ignored.has(e.name)) continue;
		const full = join(dir, e.name);
		if (e.isDirectory()) {
			result.push(...(await collectFiles(full, ignored)));
		} else if (e.isFile() && SUPPORTED_EXT.has(extname(e.name))) {
			result.push(full);
		}
	}
	return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build (or incrementally update) the codebase index.
 *
 * @param root   Project root directory.
 * @param force  When true, ignore cached mtimes and re-index all files.
 */
export async function buildIndex(root: string, force = false): Promise<CodebaseIndex> {
	const indexPath = join(root, INDEX_FILE);
	mkdirSync(join(root, ".takumi"), { recursive: true });

	// Load existing cache for incremental updates
	let cached: Map<string, FileEntry> = new Map();
	if (!force && existsSync(indexPath)) {
		try {
			const prev = JSON.parse(readFileSync(indexPath, "utf-8")) as CodebaseIndex;
			cached = new Map(prev.files.map((f) => [f.path, f]));
		} catch {
			// corrupt cache — rebuild from scratch
		}
	}

	const ignored = loadGitignoreNames(root);
	const allFiles = await collectFiles(root, ignored);
	const newEntries: FileEntry[] = [];

	for (const file of allFiles) {
		const s = await stat(file).catch(() => null);
		if (!s || s.size > MAX_FILE_BYTES) continue;
		const mtime = s.mtimeMs;

		const hit = cached.get(file);
		if (hit && hit.mtime === mtime) {
			newEntries.push(hit);
			continue;
		}

		const source = readFileSync(file, "utf-8");
		const relPath = relative(root, file);
		newEntries.push({ path: file, relPath, mtime, symbols: extractSymbols(source, file, relPath) });
	}

	const index: CodebaseIndex = { root, builtAt: Date.now(), files: newEntries };
	writeFileSync(indexPath, JSON.stringify(index), "utf-8");
	return index;
}

/** Load an existing index from disk — returns null if not found or corrupt. */
export function loadIndex(root: string): CodebaseIndex | null {
	const p = join(root, INDEX_FILE);
	if (!existsSync(p)) return null;
	try {
		return JSON.parse(readFileSync(p, "utf-8")) as CodebaseIndex;
	} catch {
		return null;
	}
}

/** Stats summary for display. */
export interface IndexStats {
	files: number;
	symbols: number;
	builtAt: Date;
}

export function indexStats(index: CodebaseIndex): IndexStats {
	return {
		files: index.files.length,
		symbols: index.files.reduce((n, f) => n + f.symbols.length, 0),
		builtAt: new Date(index.builtAt),
	};
}
