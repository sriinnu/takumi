/**
 * Task Graph — DAG-based dependency model for side-agent orchestration.
 *
 * Replaces the raw stdin-mailbox dispatch model with structured task nodes,
 * dependency edges, topological ordering, and cycle detection. This enables
 * the orchestrator to schedule parallel lanes and respect ordering constraints.
 *
 * @see docs/tracking/future-roadmap.md — Track 7
 * @see docs/mission-runtime-spec.md — task graph decomposition
 */

import { createLogger } from "./logger.js";

const log = createLogger("task-graph");

// ── Node & Edge Types ─────────────────────────────────────────────────────────

/** Classification of a task node within the mission decomposition. */
export type TaskNodeKind = "planning" | "implementation" | "research" | "validation" | "review" | "release" | "retro";

/** Lifecycle state of an individual task node. */
export type TaskNodeStatus =
	| "pending" /** Not yet scheduled. */
	| "ready" /** All dependencies satisfied. */
	| "running" /** Assigned to a lane/agent. */
	| "completed" /** Finished successfully. */
	| "failed" /** Finished with error. */
	| "skipped"; /** Bypassed (e.g. dependency failed with skip-on-fail). */

/** A single task node in the dependency graph. */
export interface TaskNode {
	id: string;
	/** Human-readable label. */
	label: string;
	kind: TaskNodeKind;
	status: TaskNodeStatus;
	/** Side-agent ID assigned to execute this node, if any. */
	assignee?: string;
	/** IDs of nodes that must complete before this one can run. */
	dependsOn: string[];
	/** Epoch timestamp of creation. */
	createdAt: number;
	/** Epoch timestamp of last status change. */
	updatedAt: number;
	/** Optional error message when status is `failed`. */
	error?: string;
}

/** The full task graph: nodes + validation metadata. */
export interface TaskGraph {
	/** Ordered map of nodes by ID. */
	nodes: Map<string, TaskNode>;
	/** Epoch timestamp of last structural change. */
	updatedAt: number;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/** Create an empty task graph. */
export function createTaskGraph(): TaskGraph {
	return { nodes: new Map(), updatedAt: Date.now() };
}

/** Create a task node with sensible defaults. */
export function createTaskNode(id: string, label: string, kind: TaskNodeKind, dependsOn: string[] = []): TaskNode {
	const now = Date.now();
	return { id, label, kind, status: "pending", dependsOn, createdAt: now, updatedAt: now };
}

// ── Mutation ──────────────────────────────────────────────────────────────────

/** Add a node to the graph. Returns false if the ID already exists. */
export function addNode(graph: TaskGraph, node: TaskNode): boolean {
	if (graph.nodes.has(node.id)) {
		log.warn(`Node ${node.id} already exists in the task graph`);
		return false;
	}
	graph.nodes.set(node.id, node);
	graph.updatedAt = Date.now();
	return true;
}

/** Remove a node and strip it from all dependsOn lists. */
export function removeTaskNode(graph: TaskGraph, nodeId: string): boolean {
	if (!graph.nodes.has(nodeId)) return false;
	graph.nodes.delete(nodeId);
	for (const node of graph.nodes.values()) {
		const idx = node.dependsOn.indexOf(nodeId);
		if (idx >= 0) node.dependsOn.splice(idx, 1);
	}
	graph.updatedAt = Date.now();
	return true;
}

/** Update the status of a node. Returns false if not found. */
export function updateNodeStatus(graph: TaskGraph, nodeId: string, status: TaskNodeStatus, error?: string): boolean {
	const node = graph.nodes.get(nodeId);
	if (!node) return false;
	node.status = status;
	node.updatedAt = Date.now();
	if (error !== undefined) node.error = error;
	graph.updatedAt = Date.now();
	return true;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/** Return nodes whose dependencies are all completed (ready to schedule). */
export function readyNodes(graph: TaskGraph): TaskNode[] {
	const result: TaskNode[] = [];
	for (const node of graph.nodes.values()) {
		if (node.status !== "pending") continue;
		const allDepsComplete = node.dependsOn.every((depId) => {
			const dep = graph.nodes.get(depId);
			return dep?.status === "completed" || dep?.status === "skipped";
		});
		if (allDepsComplete) result.push(node);
	}
	return result;
}

/** Return all nodes with a given status. */
export function nodesByStatus(graph: TaskGraph, status: TaskNodeStatus): TaskNode[] {
	return [...graph.nodes.values()].filter((n) => n.status === status);
}

// ── DAG Validation ────────────────────────────────────────────────────────────

export interface GraphValidation {
	valid: boolean;
	/** Node IDs with missing dependency references. */
	missingDeps: Array<{ nodeId: string; missingDepId: string }>;
	/** Cycle participants (empty if acyclic). */
	cycleNodes: string[];
}

/**
 * Validate the graph: check for missing dependency references and cycles.
 * Uses Kahn's algorithm for topological sort / cycle detection.
 */
export function validateGraph(graph: TaskGraph): GraphValidation {
	const missingDeps: GraphValidation["missingDeps"] = [];

	// Check for missing dependency references
	for (const node of graph.nodes.values()) {
		for (const depId of node.dependsOn) {
			if (!graph.nodes.has(depId)) {
				missingDeps.push({ nodeId: node.id, missingDepId: depId });
			}
		}
	}

	// Kahn's algorithm for topological sort / cycle detection
	const inDegree = new Map<string, number>();
	for (const node of graph.nodes.values()) {
		if (!inDegree.has(node.id)) inDegree.set(node.id, 0);
		for (const depId of node.dependsOn) {
			if (graph.nodes.has(depId)) {
				inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
			}
		}
	}

	const queue: string[] = [];
	for (const [id, deg] of inDegree) {
		if (deg === 0) queue.push(id);
	}

	let visited = 0;
	while (queue.length > 0) {
		const current = queue.shift()!;
		visited++;
		// Find nodes that depend on `current` and decrement their in-degree
		for (const node of graph.nodes.values()) {
			if (node.dependsOn.includes(current)) {
				const newDeg = (inDegree.get(node.id) ?? 1) - 1;
				inDegree.set(node.id, newDeg);
				if (newDeg === 0) queue.push(node.id);
			}
		}
	}

	const cycleNodes =
		visited < graph.nodes.size ? [...inDegree.entries()].filter(([, deg]) => deg > 0).map(([id]) => id) : [];

	return {
		valid: missingDeps.length === 0 && cycleNodes.length === 0,
		missingDeps,
		cycleNodes,
	};
}

/**
 * Return a topological ordering of node IDs. Returns null if the graph has cycles.
 */
export function topologicalOrder(graph: TaskGraph): string[] | null {
	const validation = validateGraph(graph);
	if (validation.cycleNodes.length > 0) return null;

	// Kahn's again for the actual ordering
	const inDegree = new Map<string, number>();
	for (const node of graph.nodes.values()) {
		if (!inDegree.has(node.id)) inDegree.set(node.id, 0);
		for (const depId of node.dependsOn) {
			if (graph.nodes.has(depId)) {
				inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
			}
		}
	}

	const queue: string[] = [];
	for (const [id, deg] of inDegree) {
		if (deg === 0) queue.push(id);
	}

	const order: string[] = [];
	while (queue.length > 0) {
		const current = queue.shift()!;
		order.push(current);
		for (const node of graph.nodes.values()) {
			if (node.dependsOn.includes(current)) {
				const newDeg = (inDegree.get(node.id) ?? 1) - 1;
				inDegree.set(node.id, newDeg);
				if (newDeg === 0) queue.push(node.id);
			}
		}
	}

	return order;
}
