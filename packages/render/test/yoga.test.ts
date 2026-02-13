/**
 * Tests for Yoga WASM layout wrapper.
 * Uses the fallback implementation since WASM may not be available in test environment.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
	initYoga,
	createNode,
	applyStyle,
	computeLayout,
	FLEX_DIRECTION_ROW,
	FLEX_DIRECTION_COLUMN,
	EDGE_ALL,
	EDGE_TOP,
	EDGE_RIGHT,
	EDGE_BOTTOM,
	EDGE_LEFT,
} from "../src/yoga.js";
import type { ComponentStyle } from "../src/component.js";

describe("yoga", () => {
	beforeAll(async () => {
		// Initialize Yoga (will use fallback in test environment)
		await initYoga();
	});

	describe("initYoga", () => {
		it("initializes without error", async () => {
			// Already initialized in beforeAll, calling again should be safe
			await expect(initYoga()).resolves.toBeUndefined();
		});
	});

	describe("createNode", () => {
		it("returns a node with layout methods", () => {
			const node = createNode();

			expect(node).toBeDefined();
			expect(typeof node.setWidth).toBe("function");
			expect(typeof node.setHeight).toBe("function");
			expect(typeof node.setFlexGrow).toBe("function");
			expect(typeof node.setFlexDirection).toBe("function");
			expect(typeof node.setPadding).toBe("function");
			expect(typeof node.setMargin).toBe("function");
			expect(typeof node.getComputedLeft).toBe("function");
			expect(typeof node.getComputedTop).toBe("function");
			expect(typeof node.getComputedWidth).toBe("function");
			expect(typeof node.getComputedHeight).toBe("function");
			expect(typeof node.insertChild).toBe("function");
			expect(typeof node.removeChild).toBe("function");
			expect(typeof node.getChildCount).toBe("function");
			expect(typeof node.calculateLayout).toBe("function");
			expect(typeof node.free).toBe("function");
		});
	});

	describe("applyStyle", () => {
		it("sets width and height", () => {
			const node = createNode();
			const style: ComponentStyle = {
				width: 100,
				height: 50,
			};

			applyStyle(node, style);
			// Must compute layout before reading computed values
			computeLayout(node, 200, 200);

			expect(node.getComputedWidth()).toBe(100);
			expect(node.getComputedHeight()).toBe(50);
		});

		it("sets flexGrow", () => {
			const node = createNode();
			const style: ComponentStyle = {
				flexGrow: 1,
			};

			// Should not throw
			expect(() => applyStyle(node, style)).not.toThrow();
		});

		it("sets flexShrink", () => {
			const node = createNode();
			const style: ComponentStyle = {
				flexShrink: 0,
			};

			// Should not throw
			expect(() => applyStyle(node, style)).not.toThrow();
		});

		it("sets flexDirection to row", () => {
			const node = createNode();
			const style: ComponentStyle = {
				flexDirection: "row",
			};

			// Should not throw
			expect(() => applyStyle(node, style)).not.toThrow();
		});

		it("sets flexDirection to column", () => {
			const node = createNode();
			const style: ComponentStyle = {
				flexDirection: "column",
			};

			// Should not throw
			expect(() => applyStyle(node, style)).not.toThrow();
		});

		it("applies padding with single number (all edges)", () => {
			const node = createNode();
			const style: ComponentStyle = {
				padding: 10,
			};

			// Should not throw
			expect(() => applyStyle(node, style)).not.toThrow();
		});

		it("applies padding with [vertical, horizontal]", () => {
			const node = createNode();
			const style: ComponentStyle = {
				padding: [5, 10],
			};

			// Should not throw
			expect(() => applyStyle(node, style)).not.toThrow();
		});

		it("applies padding with [top, right, bottom, left]", () => {
			const node = createNode();
			const style: ComponentStyle = {
				padding: [1, 2, 3, 4],
			};

			// Should not throw
			expect(() => applyStyle(node, style)).not.toThrow();
		});

		it("applies margin with single number (all edges)", () => {
			const node = createNode();
			const style: ComponentStyle = {
				margin: 8,
			};

			// Should not throw
			expect(() => applyStyle(node, style)).not.toThrow();
		});

		it("applies margin with [vertical, horizontal]", () => {
			const node = createNode();
			const style: ComponentStyle = {
				margin: [4, 8],
			};

			// Should not throw
			expect(() => applyStyle(node, style)).not.toThrow();
		});

		it("applies margin with [top, right, bottom, left]", () => {
			const node = createNode();
			const style: ComponentStyle = {
				margin: [2, 4, 6, 8],
			};

			// Should not throw
			expect(() => applyStyle(node, style)).not.toThrow();
		});

		it("applies multiple style properties", () => {
			const node = createNode();
			const style: ComponentStyle = {
				width: 200,
				height: 100,
				flexGrow: 1,
				flexDirection: "row",
				padding: 10,
				margin: [5, 10],
			};

			expect(() => applyStyle(node, style)).not.toThrow();
			computeLayout(node, 300, 300);
			expect(node.getComputedWidth()).toBe(200);
			expect(node.getComputedHeight()).toBe(100);
		});
	});

	describe("computeLayout", () => {
		it("calculates positions for single node", () => {
			const node = createNode();
			applyStyle(node, { width: 100, height: 50 });

			computeLayout(node, 200, 100);

			// Node has explicit width/height, so computed should match those (not container)
			expect(node.getComputedWidth()).toBe(100);
			expect(node.getComputedHeight()).toBe(50);
		});

		it("calculates layout with different container sizes", () => {
			const node = createNode();
			// No explicit width/height — node fills container
			computeLayout(node, 800, 600);

			expect(node.getComputedWidth()).toBe(800);
			expect(node.getComputedHeight()).toBe(600);
		});
	});

	describe("nested layout", () => {
		it("handles parent with children", () => {
			const parent = createNode();
			const child1 = createNode();
			const child2 = createNode();

			applyStyle(parent, {
				width: 200,
				height: 100,
				flexDirection: "row",
			});

			applyStyle(child1, { flexGrow: 1, height: 50 });
			applyStyle(child2, { flexGrow: 1, height: 50 });

			parent.insertChild(child1, 0);
			parent.insertChild(child2, 1);

			expect(parent.getChildCount()).toBe(2);

			computeLayout(parent, 200, 100);

			// Verify layout was computed (fallback will set dimensions)
			expect(parent.getComputedWidth()).toBe(200);
			expect(parent.getComputedHeight()).toBe(100);
		});

		it("handles child removal", () => {
			const parent = createNode();
			const child = createNode();

			parent.insertChild(child, 0);
			expect(parent.getChildCount()).toBe(1);

			parent.removeChild(child);
			expect(parent.getChildCount()).toBe(0);
		});

		it("handles multiple levels of nesting", () => {
			const root = createNode();
			const container = createNode();
			const child = createNode();

			applyStyle(root, { width: 300, height: 200, flexDirection: "column" });
			applyStyle(container, { flexGrow: 1, flexDirection: "row" });
			applyStyle(child, { flexGrow: 1 });

			root.insertChild(container, 0);
			container.insertChild(child, 0);

			expect(root.getChildCount()).toBe(1);
			expect(container.getChildCount()).toBe(1);

			computeLayout(root, 300, 200);

			// Verify root dimensions
			expect(root.getComputedWidth()).toBe(300);
			expect(root.getComputedHeight()).toBe(200);
		});
	});

	describe("edge values", () => {
		it("applies padding with number (all edges)", () => {
			const node = createNode();
			const style: ComponentStyle = { padding: 10 };

			expect(() => applyStyle(node, style)).not.toThrow();
		});

		it("applies padding with [vertical, horizontal]", () => {
			const node = createNode();
			const style: ComponentStyle = { padding: [5, 10] };

			expect(() => applyStyle(node, style)).not.toThrow();
		});

		it("applies padding with [top, right, bottom, left]", () => {
			const node = createNode();
			const style: ComponentStyle = { padding: [1, 2, 3, 4] };

			expect(() => applyStyle(node, style)).not.toThrow();
		});

		it("applies margin with number (all edges)", () => {
			const node = createNode();
			const style: ComponentStyle = { margin: 8 };

			expect(() => applyStyle(node, style)).not.toThrow();
		});

		it("applies margin with [vertical, horizontal]", () => {
			const node = createNode();
			const style: ComponentStyle = { margin: [4, 8] };

			expect(() => applyStyle(node, style)).not.toThrow();
		});

		it("applies margin with [top, right, bottom, left]", () => {
			const node = createNode();
			const style: ComponentStyle = { margin: [2, 4, 6, 8] };

			expect(() => applyStyle(node, style)).not.toThrow();
		});
	});

	describe("node lifecycle", () => {
		it("frees a node without error", () => {
			const node = createNode();
			expect(() => node.free()).not.toThrow();
		});

		it("can create and free multiple nodes", () => {
			const nodes = [createNode(), createNode(), createNode()];

			for (const node of nodes) {
				expect(() => node.free()).not.toThrow();
			}
		});
	});
});
