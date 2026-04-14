/**
 * Context Ripple DAG — import/export dependency graph for surgical updates.
 *
 * When the agent modifies a file, the DAG identifies all downstream
 * dependents so the agent can proactively check them for breakage —
 * eliminating the "blind edit → tsc → discover 12 broken files" cycle.
 *
 * Uses a lightweight regex-based parser (no full TS AST required at
 * index time) to build a directional graph:  A imports B  →  edge B→A
 * so that "ripple from B" yields all files that depend on B.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createLogger } from "@takumi/core";

const log = createLogger("ripple-dag");

// ── Types ────────────────────────────────────────────────────────────────────

export interface DagNode {
	/** Workspace-relative file path */
	file: string;
	/** Files this node imports (outgoing edges) */
	imports: Set<string>;
	/** Files that import this node (incoming / dependents) */
	dependents: Set<string>;
}

export interface RippleResult {
	/** The file that was modified (root of the ripple) */
	source: string;
	/** All files affected, ordered by depth (breadth-first) */
	affected: string[];
	/** Depth of each affected file from source */
	depths: Map<string, number>;
}

// ── Import regex ─────────────────────────────────────────────────────────────

/**
 * Matches ES import/export-from statements and extracts the module specifier.
 * Handles: import X from "./foo.js"
 *          import { X } from "../bar/baz.js"
 *          export { X } from "./qux.js"
 *          import type { X } from "./types.js"
 *          export type { X } from "./types.js"
 */
const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /import\(\s*["']([^"']+)["']\s*\)/g;

// ── DAG builder ──────────────────────────────────────────────────────────────

export class RippleDag {
	private nodes = new Map<string, DagNode>();
	private readonly root: string;

	constructor(projectRoot: string) {
		this.root = projectRoot;
	}

	/** Index a set of files to build the dependency graph. */
	index(files: string[]): void {
		// Reset
		this.nodes.clear();

		// First pass: create nodes and extract imports
		for (const file of files) {
			const rel = relative(this.root, file);
			const node = this.getOrCreate(rel);

			try {
				const content = readFileSync(file, "utf-8");
				const imports = this.extractImports(content, rel);
				for (const imp of imports) {
					node.imports.add(imp);
				}
			} catch {
				log.debug(`Could not read ${rel} for DAG indexing`);
			}
		}

		// Second pass: build reverse edges (dependents)
		for (const [file, node] of this.nodes) {
			for (const imp of node.imports) {
				const target = this.getOrCreate(imp);
				target.dependents.add(file);
			}
		}

		log.info(`DAG indexed ${this.nodes.size} files`);
	}

	/**
	 * Index from git: discover all tracked TS/JS files automatically.
	 * Much faster than walking the filesystem for large monorepos.
	 *
	 * Uses execFileSync with a hard timeout — git can hang on locked
	 * index files, NFS mounts, or corrupted repos. Without the timeout,
	 * the entire TUI event loop blocks and the terminal freezes.
	 */
	indexFromGit(): void {
		try {
			const output = execFileSync("git", ["ls-files", "*.ts", "*.tsx", "*.js", "*.jsx"], {
				cwd: this.root,
				encoding: "utf-8",
				timeout: 10_000,
				maxBuffer: 10 * 1024 * 1024,
			}) as string;

			const files = output
				.split("\n")
				.map((f) => f.trim())
				.filter((f) => f.length > 0 && !f.includes("node_modules"))
				.map((f) => resolve(this.root, f));

			this.index(files);
		} catch (_err) {
			log.warn("Failed to index from git, DAG will be empty");
		}
	}

	/**
	 * Compute the ripple effect: given a modified file,
	 * return all files that transitively depend on it.
	 * Uses BFS with configurable max depth.
	 */
	ripple(filePath: string, maxDepth = 3): RippleResult {
		const rel = relative(this.root, resolve(this.root, filePath));
		const affected: string[] = [];
		const depths = new Map<string, number>();
		const visited = new Set<string>();

		const queue: Array<{ file: string; depth: number }> = [{ file: rel, depth: 0 }];
		visited.add(rel);

		while (queue.length > 0) {
			const { file, depth } = queue.shift()!;
			if (depth > 0) {
				affected.push(file);
				depths.set(file, depth);
			}
			if (depth >= maxDepth) continue;

			const node = this.nodes.get(file);
			if (!node) continue;

			for (const dep of node.dependents) {
				if (!visited.has(dep)) {
					visited.add(dep);
					queue.push({ file: dep, depth: depth + 1 });
				}
			}
		}

		return { source: rel, affected, depths };
	}

	/** Get all direct dependents of a file (1-hop). */
	directDependents(filePath: string): string[] {
		const rel = relative(this.root, resolve(this.root, filePath));
		return [...(this.nodes.get(rel)?.dependents ?? [])];
	}

	/** Get all direct imports of a file. */
	directImports(filePath: string): string[] {
		const rel = relative(this.root, resolve(this.root, filePath));
		return [...(this.nodes.get(rel)?.imports ?? [])];
	}

	/** Total number of indexed files. */
	get size(): number {
		return this.nodes.size;
	}

	/** Get the full node data (for testing/inspection). */
	getNode(filePath: string): DagNode | undefined {
		const rel = relative(this.root, resolve(this.root, filePath));
		return this.nodes.get(rel);
	}

	// ── Internal helpers ─────────────────────────────────────────────────────

	private getOrCreate(rel: string): DagNode {
		let node = this.nodes.get(rel);
		if (!node) {
			node = { file: rel, imports: new Set(), dependents: new Set() };
			this.nodes.set(rel, node);
		}
		return node;
	}

	/**
	 * Extract resolved relative import paths from file content.
	 * Only resolves relative imports (./  ../) — bare specifiers
	 * (e.g. "react") are ignored since they're external packages.
	 */
	private extractImports(content: string, fromFile: string): string[] {
		const imports: string[] = [];
		const dir = dirname(fromFile);

		const processMatch = (specifier: string) => {
			// Only resolve relative imports
			if (!specifier.startsWith(".")) return;

			let resolved = join(dir, specifier);

			// Normalise: remove .js extension for matching (TS → .js convention)
			resolved = resolved.replace(/\.js$/, ".ts");

			// Try direct match, or add .ts
			if (!resolved.endsWith(".ts") && !resolved.endsWith(".tsx")) {
				// Could be directory with index.ts
				// We don't check the filesystem here — just add the most likely candidate
				resolved = `${resolved}.ts`;
			}

			imports.push(resolved);
		};

		// Static imports/exports
		IMPORT_RE.lastIndex = 0;
		for (let match = IMPORT_RE.exec(content); match !== null; match = IMPORT_RE.exec(content)) {
			processMatch(match[1]);
		}

		// Dynamic imports
		DYNAMIC_IMPORT_RE.lastIndex = 0;
		for (let match = DYNAMIC_IMPORT_RE.exec(content); match !== null; match = DYNAMIC_IMPORT_RE.exec(content)) {
			processMatch(match[1]);
		}

		return imports;
	}
}
