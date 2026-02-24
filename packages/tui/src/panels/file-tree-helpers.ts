import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface FileNode {
	name: string;
	/** Path relative to root. */
	path: string;
	isDirectory: boolean;
	children?: FileNode[];
	depth: number;
	modified?: boolean;
	staged?: boolean;
}

/** Flattened visible row used for rendering and navigation. */
export interface FlatRow {
	node: FileNode;
	indent: number;
	isExpanded?: boolean;
	isLastChild: boolean;
	/** Prefix characters showing tree structure. */
	treeParts: TreePart[];
}

export type TreePart = "pipe" | "tee" | "corner" | "blank";

/** Directories always skipped regardless of .gitignore. */
const ALWAYS_SKIP = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"__pycache__",
	".cache",
	".turbo",
	".parcel-cache",
	"coverage",
]);

/** Tree-drawing Unicode characters. */
const TREE_CHARS = {
	pipe: "\u2502 ",
	tee: "\u251C\u2500",
	corner: "\u2514\u2500",
	blank: "  ",
} as const;

/** Parse a .gitignore file into simple patterns. */
export function parseGitignore(content: string): string[] {
	return content
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));
}

/** Check if a filename matches a simple .gitignore pattern. */
export function matchesGitignore(name: string, isDir: boolean, patterns: string[]): boolean {
	for (const raw of patterns) {
		let pattern = raw;
		if (pattern.startsWith("!")) continue;

		const dirOnly = pattern.endsWith("/");
		if (dirOnly) {
			pattern = pattern.slice(0, -1);
			if (!isDir) continue;
		}
		if (pattern.startsWith("/")) pattern = pattern.slice(1);

		if (name === pattern) return true;
		if (pattern.startsWith("*.")) {
			const ext = pattern.slice(1);
			if (name.endsWith(ext)) return true;
		}
		if (pattern.endsWith("*")) {
			const prefix = pattern.slice(0, -1);
			if (name.startsWith(prefix)) return true;
		}
	}
	return false;
}

/** Scan a directory tree recursively, respecting .gitignore patterns. */
export async function scanDirectory(
	root: string,
	maxDepth: number,
	gitignorePatterns: string[] = [],
	currentDepth = 0,
	relativePath = "",
): Promise<FileNode[]> {
	if (currentDepth > maxDepth) return [];

	let entries: import("node:fs").Dirent[];
	try {
		entries = (await readdir(join(root, relativePath), {
			withFileTypes: true,
			encoding: "utf-8",
		})) as unknown as import("node:fs").Dirent[];
	} catch {
		return [];
	}

	const nodes: FileNode[] = [];
	for (const entry of entries) {
		const name = String(entry.name);
		const isDir = entry.isDirectory();
		const entryRelPath = relativePath ? `${relativePath}/${name}` : name;

		if (ALWAYS_SKIP.has(name)) continue;
		if (matchesGitignore(name, isDir, gitignorePatterns)) continue;

		const node: FileNode = {
			name,
			path: entryRelPath,
			isDirectory: isDir,
			depth: currentDepth,
		};

		if (isDir) {
			node.children = await scanDirectory(root, maxDepth, gitignorePatterns, currentDepth + 1, entryRelPath);
		}
		nodes.push(node);
	}

	nodes.sort((a, b) => {
		if (a.isDirectory && !b.isDirectory) return -1;
		if (!a.isDirectory && b.isDirectory) return 1;
		return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
	});

	return nodes;
}

/** Load .gitignore patterns from the project root. */
export async function loadGitignore(root: string): Promise<string[]> {
	try {
		const content = await readFile(join(root, ".gitignore"), "utf-8");
		return parseGitignore(content);
	} catch {
		return [];
	}
}

/** Flatten tree into visible rows based on expanded directories. */
export function flattenTree(nodes: FileNode[], expandedDirs: Set<string>, parentParts: TreePart[] = []): FlatRow[] {
	const rows: FlatRow[] = [];
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const isLast = i === nodes.length - 1;
		const treeParts = [...parentParts];
		const isExpanded = node.isDirectory && expandedDirs.has(node.path);

		rows.push({
			node,
			indent: node.depth,
			isExpanded: node.isDirectory ? isExpanded : undefined,
			isLastChild: isLast,
			treeParts: [...treeParts, (isLast ? "corner" : "tee") as TreePart],
		});

		if (isExpanded && node.children && node.children.length > 0) {
			const childParts: TreePart[] = [...parentParts, (isLast ? "blank" : "pipe") as TreePart];
			rows.push(...flattenTree(node.children, expandedDirs, childParts));
		}
	}
	return rows;
}

/** Apply git status markers (modified/staged) to a file tree. */
export function applyGitStatus(nodes: FileNode[], modified: string[], staged: string[]): void {
	const modifiedSet = new Set(modified);
	const stagedSet = new Set(staged);

	function walk(nodeList: FileNode[]): void {
		for (const node of nodeList) {
			if (!node.isDirectory) {
				node.modified = modifiedSet.has(node.path);
				node.staged = stagedSet.has(node.path);
			}
			if (node.children) walk(node.children);
		}
	}
	walk(nodes);
}

/** Format a flat row into a display string with tree lines. */
export function formatRow(row: FlatRow, maxWidth: number): string {
	let prefix = "";
	for (const part of row.treeParts) prefix += TREE_CHARS[part];

	const icon = row.node.isDirectory ? (row.isExpanded ? "\u25BC " : "\u25B6 ") : "  ";
	let suffix = "";
	if (row.node.modified) suffix = " \u25CF";
	else if (row.node.staged) suffix = " +";

	const text = `${prefix}${icon}${row.node.name}${suffix}`;
	if (text.length > maxWidth) return `${text.slice(0, maxWidth - 1)}\u2026`;
	return text;
}
