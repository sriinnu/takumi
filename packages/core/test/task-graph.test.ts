import { describe, expect, it } from "vitest";
import {
	addNode,
	createTaskGraph,
	createTaskNode,
	nodesByStatus,
	readyNodes,
	removeTaskNode,
	topologicalOrder,
	updateNodeStatus,
	validateGraph,
} from "../src/task-graph.js";

describe("createTaskGraph / createTaskNode", () => {
	it("creates an empty graph", () => {
		const g = createTaskGraph();
		expect(g.nodes.size).toBe(0);
	});

	it("creates a node with defaults", () => {
		const n = createTaskNode("t-1", "Implement auth", "implementation");
		expect(n.id).toBe("t-1");
		expect(n.kind).toBe("implementation");
		expect(n.status).toBe("pending");
		expect(n.dependsOn).toEqual([]);
	});

	it("creates a node with dependencies", () => {
		const n = createTaskNode("t-2", "Test auth", "validation", ["t-1"]);
		expect(n.dependsOn).toEqual(["t-1"]);
	});
});

describe("addNode / removeNode", () => {
	it("adds nodes to the graph", () => {
		const g = createTaskGraph();
		const ok = addNode(g, createTaskNode("t-1", "A", "planning"));
		expect(ok).toBe(true);
		expect(g.nodes.size).toBe(1);
	});

	it("rejects duplicate node IDs", () => {
		const g = createTaskGraph();
		addNode(g, createTaskNode("t-1", "A", "planning"));
		const ok = addNode(g, createTaskNode("t-1", "B", "research"));
		expect(ok).toBe(false);
		expect(g.nodes.size).toBe(1);
	});

	it("removes a node and strips it from dependencies", () => {
		const g = createTaskGraph();
		addNode(g, createTaskNode("t-1", "Plan", "planning"));
		addNode(g, createTaskNode("t-2", "Impl", "implementation", ["t-1"]));
		addNode(g, createTaskNode("t-3", "Test", "validation", ["t-1", "t-2"]));

		const ok = removeTaskNode(g, "t-1");
		expect(ok).toBe(true);
		expect(g.nodes.size).toBe(2);
		expect(g.nodes.get("t-2")!.dependsOn).toEqual([]);
		expect(g.nodes.get("t-3")!.dependsOn).toEqual(["t-2"]);
	});

	it("returns false when removing a nonexistent node", () => {
		const g = createTaskGraph();
		expect(removeTaskNode(g, "nope")).toBe(false);
	});
});

describe("updateNodeStatus", () => {
	it("updates status of an existing node", () => {
		const g = createTaskGraph();
		addNode(g, createTaskNode("t-1", "A", "planning"));
		const ok = updateNodeStatus(g, "t-1", "running");
		expect(ok).toBe(true);
		expect(g.nodes.get("t-1")!.status).toBe("running");
	});

	it("stores error message on failure", () => {
		const g = createTaskGraph();
		addNode(g, createTaskNode("t-1", "A", "planning"));
		updateNodeStatus(g, "t-1", "failed", "compilation error");
		expect(g.nodes.get("t-1")!.error).toBe("compilation error");
	});

	it("returns false for unknown node", () => {
		const g = createTaskGraph();
		expect(updateNodeStatus(g, "nope", "running")).toBe(false);
	});
});

describe("readyNodes", () => {
	it("returns nodes with no dependencies as ready", () => {
		const g = createTaskGraph();
		addNode(g, createTaskNode("t-1", "A", "planning"));
		addNode(g, createTaskNode("t-2", "B", "research"));
		expect(readyNodes(g)).toHaveLength(2);
	});

	it("returns only nodes whose deps are completed", () => {
		const g = createTaskGraph();
		addNode(g, createTaskNode("t-1", "Plan", "planning"));
		addNode(g, createTaskNode("t-2", "Impl", "implementation", ["t-1"]));
		addNode(g, createTaskNode("t-3", "Test", "validation", ["t-2"]));

		// Only t-1 is ready initially
		expect(readyNodes(g).map((n) => n.id)).toEqual(["t-1"]);

		// Complete t-1 → t-2 becomes ready
		updateNodeStatus(g, "t-1", "completed");
		expect(readyNodes(g).map((n) => n.id)).toEqual(["t-2"]);

		// Complete t-2 → t-3 becomes ready
		updateNodeStatus(g, "t-2", "completed");
		expect(readyNodes(g).map((n) => n.id)).toEqual(["t-3"]);
	});

	it("treats skipped deps as satisfied", () => {
		const g = createTaskGraph();
		addNode(g, createTaskNode("t-1", "Optional", "research"));
		addNode(g, createTaskNode("t-2", "Next", "implementation", ["t-1"]));
		updateNodeStatus(g, "t-1", "skipped");
		expect(readyNodes(g).map((n) => n.id)).toEqual(["t-2"]);
	});
});

describe("nodesByStatus", () => {
	it("filters nodes by status", () => {
		const g = createTaskGraph();
		addNode(g, createTaskNode("t-1", "A", "planning"));
		addNode(g, createTaskNode("t-2", "B", "research"));
		updateNodeStatus(g, "t-1", "running");
		expect(nodesByStatus(g, "running").map((n) => n.id)).toEqual(["t-1"]);
		expect(nodesByStatus(g, "pending").map((n) => n.id)).toEqual(["t-2"]);
	});
});

describe("validateGraph", () => {
	it("validates a clean linear graph", () => {
		const g = createTaskGraph();
		addNode(g, createTaskNode("t-1", "Plan", "planning"));
		addNode(g, createTaskNode("t-2", "Impl", "implementation", ["t-1"]));
		addNode(g, createTaskNode("t-3", "Test", "validation", ["t-2"]));
		const result = validateGraph(g);
		expect(result.valid).toBe(true);
		expect(result.missingDeps).toEqual([]);
		expect(result.cycleNodes).toEqual([]);
	});

	it("detects missing dependency references", () => {
		const g = createTaskGraph();
		addNode(g, createTaskNode("t-2", "Impl", "implementation", ["t-ghost"]));
		const result = validateGraph(g);
		expect(result.valid).toBe(false);
		expect(result.missingDeps).toEqual([{ nodeId: "t-2", missingDepId: "t-ghost" }]);
	});

	it("detects cycles", () => {
		const g = createTaskGraph();
		addNode(g, createTaskNode("a", "A", "planning", ["c"]));
		addNode(g, createTaskNode("b", "B", "implementation", ["a"]));
		addNode(g, createTaskNode("c", "C", "validation", ["b"]));
		const result = validateGraph(g);
		expect(result.valid).toBe(false);
		expect(result.cycleNodes.length).toBeGreaterThan(0);
		expect(result.cycleNodes).toContain("a");
		expect(result.cycleNodes).toContain("b");
		expect(result.cycleNodes).toContain("c");
	});

	it("validates an empty graph as valid", () => {
		const g = createTaskGraph();
		const result = validateGraph(g);
		expect(result.valid).toBe(true);
	});
});

describe("topologicalOrder", () => {
	it("returns topological order for a diamond graph", () => {
		const g = createTaskGraph();
		addNode(g, createTaskNode("a", "Root", "planning"));
		addNode(g, createTaskNode("b", "Left", "implementation", ["a"]));
		addNode(g, createTaskNode("c", "Right", "research", ["a"]));
		addNode(g, createTaskNode("d", "Merge", "validation", ["b", "c"]));

		const order = topologicalOrder(g)!;
		expect(order).not.toBeNull();
		expect(order).toHaveLength(4);
		// a must come before b and c; b and c must come before d
		expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
		expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"));
		expect(order.indexOf("b")).toBeLessThan(order.indexOf("d"));
		expect(order.indexOf("c")).toBeLessThan(order.indexOf("d"));
	});

	it("returns null for a cyclic graph", () => {
		const g = createTaskGraph();
		addNode(g, createTaskNode("a", "A", "planning", ["b"]));
		addNode(g, createTaskNode("b", "B", "implementation", ["a"]));
		expect(topologicalOrder(g)).toBeNull();
	});

	it("handles an empty graph", () => {
		const g = createTaskGraph();
		const order = topologicalOrder(g);
		expect(order).toEqual([]);
	});
});
