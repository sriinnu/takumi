/**
 * Session Tree — Phase 46
 *
 * Adds hierarchical branching to sessions. Each session can have a parent
 * and children, forming a tree of conversation branches. This enables:
 * - Branching from any point in a conversation
 * - Navigating between branches (siblings, ancestors, descendants)
 * - Visualizing the full conversation tree
 *
 * The tree metadata is stored alongside session files in a single
 * `tree.json` manifest. Individual `SessionData` files remain unchanged —
 * the tree is an overlay structure that references session IDs.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger } from "./logger.js";
import { generateSessionId, loadSession, saveSession } from "./sessions.js";
import type { Message } from "./types.js";

const log = createLogger("session-tree");

// ── Types ────────────────────────────────────────────────────────────────────

/** Metadata for a single node in the session tree. */
export interface SessionTreeNode {
	/** Session ID (matches the SessionData.id). */
	id: string;
	/** Parent session ID, null for root sessions. */
	parentId: string | null;
	/** Child session IDs (branches from this session). */
	children: string[];
	/** Human-readable label for this branch. */
	label: string;
	/** The message index in the parent at which this branch was created. */
	branchPoint: number | null;
	/** Unix timestamp when this node was added to the tree. */
	createdAt: number;
}

/** The full tree manifest stored on disk. */
export interface SessionTreeManifest {
	/** Schema version for future-proofing. */
	version: 1;
	/** Map from session ID → tree node metadata. */
	nodes: Record<string, SessionTreeNode>;
	/** Timestamp of last modification. */
	updatedAt: number;
}

/** Flat representation of a tree for rendering. */
export interface FlatTreeEntry {
	/** Session ID. */
	id: string;
	/** Display label. */
	label: string;
	/** Nesting depth (0 = root). */
	depth: number;
	/** Whether this node has children. */
	hasChildren: boolean;
	/** Whether this is the last child at its level. */
	isLast: boolean;
	/** Prefix characters for Unicode tree drawing (computed by renderer). */
	prefix: string;
}

/** Result of a branch operation. */
export interface BranchResult {
	/** The new session that was created. */
	newSessionId: string;
	/** The parent session it branched from. */
	parentSessionId: string;
	/** The message index at which the branch was made. */
	branchPoint: number;
}

// ── Paths ────────────────────────────────────────────────────────────────────

function defaultSessionsDir(): string {
	return join(homedir(), ".config", "takumi", "sessions");
}

function treeManifestPath(sessionsDir?: string): string {
	return join(sessionsDir ?? defaultSessionsDir(), "tree.json");
}

// ── Manifest I/O ─────────────────────────────────────────────────────────────

/** Create an empty manifest. */
function emptyManifest(): SessionTreeManifest {
	return { version: 1, nodes: {}, updatedAt: Date.now() };
}

/** Load the tree manifest from disk. Returns empty manifest if not found. */
export async function loadTreeManifest(sessionsDir?: string): Promise<SessionTreeManifest> {
	try {
		const raw = await readFile(treeManifestPath(sessionsDir), "utf-8");
		const data = JSON.parse(raw) as SessionTreeManifest;
		if (data.version !== 1 || typeof data.nodes !== "object") {
			log.warn("Invalid tree manifest version, resetting");
			return emptyManifest();
		}
		return data;
	} catch {
		return emptyManifest();
	}
}

/** Save the tree manifest to disk. */
export async function saveTreeManifest(manifest: SessionTreeManifest, sessionsDir?: string): Promise<void> {
	const dir = sessionsDir ?? defaultSessionsDir();
	await mkdir(dir, { recursive: true });
	manifest.updatedAt = Date.now();
	await writeFile(treeManifestPath(sessionsDir), JSON.stringify(manifest, null, 2), "utf-8");
}

// ── Node Operations ──────────────────────────────────────────────────────────

/**
 * Ensure a session exists in the tree manifest as a root node.
 * Idempotent — does nothing if the node already exists.
 */
export function ensureNode(manifest: SessionTreeManifest, id: string, label?: string): SessionTreeNode {
	if (manifest.nodes[id]) return manifest.nodes[id];
	const node: SessionTreeNode = {
		id,
		parentId: null,
		children: [],
		label: label ?? id,
		branchPoint: null,
		createdAt: Date.now(),
	};
	manifest.nodes[id] = node;
	return node;
}

/**
 * Register a parent→child relationship in the manifest.
 * Both nodes must exist (use `ensureNode` first).
 */
export function linkChild(manifest: SessionTreeManifest, parentId: string, childId: string): void {
	const parent = manifest.nodes[parentId];
	const child = manifest.nodes[childId];
	if (!parent || !child) return;
	child.parentId = parentId;
	if (!parent.children.includes(childId)) {
		parent.children.push(childId);
	}
}

/**
 * Remove a node from the tree. Re-parents its children to its parent (or makes them roots).
 * Does NOT delete the session data file.
 */
export function removeNode(manifest: SessionTreeManifest, id: string): void {
	const node = manifest.nodes[id];
	if (!node) return;

	// Re-parent children
	for (const childId of node.children) {
		const child = manifest.nodes[childId];
		if (child) {
			child.parentId = node.parentId;
		}
	}

	// Update parent's children list
	if (node.parentId) {
		const parent = manifest.nodes[node.parentId];
		if (parent) {
			parent.children = parent.children.filter((c) => c !== id);
			parent.children.push(...node.children);
		}
	}

	delete manifest.nodes[id];
}

// ── Tree Traversal ───────────────────────────────────────────────────────────

/** Get all root nodes (sessions with no parent). */
export function getRoots(manifest: SessionTreeManifest): SessionTreeNode[] {
	return Object.values(manifest.nodes).filter((n) => n.parentId === null);
}

/** Get ancestors of a node, from immediate parent to root. */
export function getAncestors(manifest: SessionTreeManifest, id: string): SessionTreeNode[] {
	const result: SessionTreeNode[] = [];
	let current = manifest.nodes[id];
	while (current?.parentId) {
		const parent = manifest.nodes[current.parentId];
		if (!parent) break;
		result.push(parent);
		current = parent;
	}
	return result;
}

/** Get all descendants of a node (BFS). */
export function getDescendants(manifest: SessionTreeManifest, id: string): SessionTreeNode[] {
	const result: SessionTreeNode[] = [];
	const queue = [...(manifest.nodes[id]?.children ?? [])];
	while (queue.length > 0) {
		const childId = queue.shift()!;
		const child = manifest.nodes[childId];
		if (child) {
			result.push(child);
			queue.push(...child.children);
		}
	}
	return result;
}

/** Get siblings (same parent, excluding self). */
export function getSiblings(manifest: SessionTreeManifest, id: string): SessionTreeNode[] {
	const node = manifest.nodes[id];
	if (!node) return [];
	if (node.parentId === null) {
		return getRoots(manifest).filter((n) => n.id !== id);
	}
	const parent = manifest.nodes[node.parentId];
	if (!parent) return [];
	return parent.children
		.filter((c) => c !== id)
		.map((c) => manifest.nodes[c])
		.filter(Boolean) as SessionTreeNode[];
}

/** Get the depth of a node (0 = root). */
export function getDepth(manifest: SessionTreeManifest, id: string): number {
	return getAncestors(manifest, id).length;
}

// ── Flatten for Rendering ────────────────────────────────────────────────────

/**
 * Flatten the tree into a list suitable for rendering with Unicode box-drawing.
 * DFS traversal, computes depth, prefix characters, and isLast flags.
 */
export function flattenTree(manifest: SessionTreeManifest): FlatTreeEntry[] {
	const result: FlatTreeEntry[] = [];
	const roots = getRoots(manifest).sort((a, b) => a.createdAt - b.createdAt);

	function walk(nodeId: string, depth: number, parentPrefixes: string): void {
		const node = manifest.nodes[nodeId];
		if (!node) return;

		const parent = node.parentId ? manifest.nodes[node.parentId] : null;
		const siblings = parent ? parent.children : roots.map((r) => r.id);
		const idxInSiblings = siblings.indexOf(nodeId);
		const isLast = idxInSiblings === siblings.length - 1;

		let prefix = parentPrefixes;
		if (depth > 0) {
			prefix += isLast ? "└── " : "├── ";
		}

		result.push({
			id: node.id,
			label: node.label,
			depth,
			hasChildren: node.children.length > 0,
			isLast,
			prefix,
		});

		const childPrefixes = depth > 0 ? parentPrefixes + (isLast ? "    " : "│   ") : "";

		const sorted = [...node.children].sort((a, b) => {
			const na = manifest.nodes[a];
			const nb = manifest.nodes[b];
			return (na?.createdAt ?? 0) - (nb?.createdAt ?? 0);
		});
		for (const childId of sorted) {
			walk(childId, depth + 1, childPrefixes);
		}
	}

	for (const root of roots) {
		walk(root.id, 0, "");
	}
	return result;
}

// ── High-Level Operations ────────────────────────────────────────────────────

/**
 * Branch a session at a given message index.
 *
 * Creates a new session containing only messages up to `branchPoint`,
 * registers it in the tree manifest as a child of the source session,
 * and persists everything to disk.
 *
 * @param sourceId     Session to branch from
 * @param branchPoint  Message index to branch at (exclusive — messages 0..branchPoint-1 are kept)
 * @param label        Human-readable branch label
 * @param sessionsDir  Override sessions directory
 * @returns BranchResult or null if source session not found
 */
export async function branchSession(
	sourceId: string,
	branchPoint: number,
	label?: string,
	sessionsDir?: string,
): Promise<BranchResult | null> {
	const source = await loadSession(sourceId, sessionsDir);
	if (!source) return null;

	const clampedPoint = Math.min(branchPoint, source.messages.length);
	const branchedMessages: Message[] = source.messages.slice(0, clampedPoint).map((m) => ({
		...m,
		content: [...m.content],
	}));

	const newId = generateSessionId();
	const now = Date.now();
	const branchLabel = label ?? `Branch @${clampedPoint}`;

	await saveSession(
		{
			id: newId,
			title: branchLabel,
			createdAt: now,
			updatedAt: now,
			messages: branchedMessages,
			model: source.model,
			tokenUsage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
		},
		sessionsDir,
	);

	// Update tree manifest
	const manifest = await loadTreeManifest(sessionsDir);
	ensureNode(manifest, sourceId, source.title || sourceId);
	const childNode = ensureNode(manifest, newId, branchLabel);
	childNode.branchPoint = clampedPoint;
	linkChild(manifest, sourceId, newId);
	await saveTreeManifest(manifest, sessionsDir);

	log.info(`Branched session ${sourceId} → ${newId} at message ${clampedPoint}`);
	return { newSessionId: newId, parentSessionId: sourceId, branchPoint: clampedPoint };
}

/**
 * Register an existing session into the tree as a root node (migration helper).
 * Useful for adding pre-existing flat sessions into the tree.
 */
export async function registerInTree(
	sessionId: string,
	label?: string,
	sessionsDir?: string,
): Promise<SessionTreeNode> {
	const manifest = await loadTreeManifest(sessionsDir);
	const node = ensureNode(manifest, sessionId, label ?? sessionId);
	await saveTreeManifest(manifest, sessionsDir);
	return node;
}

/**
 * Get the full tree manifest with all nodes.
 * Convenience wrapper around loadTreeManifest.
 */
export async function getSessionTree(sessionsDir?: string): Promise<SessionTreeManifest> {
	return loadTreeManifest(sessionsDir);
}
