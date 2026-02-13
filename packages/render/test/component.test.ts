/**
 * Tests for the Component base class.
 * Tests component creation, mounting, child management, dirty tracking,
 * lifecycle hooks, and layout rect computation.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import { Component } from "../src/component.js";
import { initYoga, createNode, computeLayout } from "../src/yoga.js";
import type { Screen } from "../src/screen.js";
import type { Rect } from "@takumi/core";

// Concrete test component
class TestComponent extends Component {
	renderCalled = false;
	renderRect: Rect | null = null;

	render(screen: Screen, rect: Rect): void {
		this.renderCalled = true;
		this.renderRect = rect;
	}
}

describe("Component", () => {
	beforeAll(async () => {
		// Initialize Yoga for layout tests
		await initYoga();
	});

	describe("component creation and mounting", () => {
		it("creates a component with default state", () => {
			const component = new TestComponent();

			expect(component.parent).toBeNull();
			expect(component.children).toEqual([]);
			expect(component.style).toEqual({});
			expect(component.dirty).toBe(true);
			expect(component.key).toBeUndefined();
			expect(component.mounted).toBe(false);
		});

		it("calls onMount and sets mounted flag", () => {
			const component = new TestComponent();

			expect(component.mounted).toBe(false);

			component.onMount();

			expect(component.mounted).toBe(true);
		});

		it("initializes with a yoga node", () => {
			const component = new TestComponent();
			component.yogaNode = createNode();

			expect(component.yogaNode).toBeDefined();
			expect(typeof component.yogaNode?.setWidth).toBe("function");
		});
	});

	describe("child add/remove", () => {
		it("adds a child component", () => {
			const parent = new TestComponent();
			const child = new TestComponent();

			parent.appendChild(child);

			expect(parent.children).toContain(child);
			expect(child.parent).toBe(parent);
			expect(parent.dirty).toBe(true);
		});

		it("adds multiple children in order", () => {
			const parent = new TestComponent();
			const child1 = new TestComponent();
			const child2 = new TestComponent();
			const child3 = new TestComponent();

			parent.appendChild(child1);
			parent.appendChild(child2);
			parent.appendChild(child3);

			expect(parent.children.length).toBe(3);
			expect(parent.children[0]).toBe(child1);
			expect(parent.children[1]).toBe(child2);
			expect(parent.children[2]).toBe(child3);
		});

		it("adds child to yoga node when both have nodes", () => {
			const parent = new TestComponent();
			const child = new TestComponent();

			parent.yogaNode = createNode();
			child.yogaNode = createNode();

			expect(parent.yogaNode.getChildCount()).toBe(0);

			parent.appendChild(child);

			expect(parent.yogaNode.getChildCount()).toBe(1);
		});

		it("removes a child component", () => {
			const parent = new TestComponent();
			const child = new TestComponent();

			parent.appendChild(child);
			expect(parent.children).toContain(child);

			parent.removeChild(child);

			expect(parent.children).not.toContain(child);
			expect(child.parent).toBeNull();
			expect(parent.dirty).toBe(true);
		});

		it("removes child from yoga node", () => {
			const parent = new TestComponent();
			const child = new TestComponent();

			parent.yogaNode = createNode();
			child.yogaNode = createNode();

			parent.appendChild(child);
			expect(parent.yogaNode.getChildCount()).toBe(1);

			parent.removeChild(child);

			expect(parent.yogaNode.getChildCount()).toBe(0);
		});

		it("calls onUnmount when removing child", () => {
			const parent = new TestComponent();
			const child = new TestComponent();

			child.onMount();
			parent.appendChild(child);

			expect(child.mounted).toBe(true);

			parent.removeChild(child);

			expect(child.mounted).toBe(false);
		});

		it("handles removing non-existent child gracefully", () => {
			const parent = new TestComponent();
			const child = new TestComponent();

			expect(() => parent.removeChild(child)).not.toThrow();
			expect(parent.children.length).toBe(0);
		});
	});

	describe("dirty marking and propagation", () => {
		it("starts as dirty", () => {
			const component = new TestComponent();

			expect(component.dirty).toBe(true);
		});

		it("marks component as dirty", () => {
			const component = new TestComponent();
			component.clearDirty();

			expect(component.dirty).toBe(false);

			component.markDirty();

			expect(component.dirty).toBe(true);
		});

		it("propagates dirty flag to parent", () => {
			const parent = new TestComponent();
			const child = new TestComponent();

			parent.appendChild(child);
			parent.clearDirty();
			child.clearDirty();

			expect(parent.dirty).toBe(false);
			expect(child.dirty).toBe(false);

			child.markDirty();

			expect(child.dirty).toBe(true);
			expect(parent.dirty).toBe(true);
		});

		it("propagates dirty flag up multiple levels", () => {
			const root = new TestComponent();
			const middle = new TestComponent();
			const leaf = new TestComponent();

			root.appendChild(middle);
			middle.appendChild(leaf);

			root.clearDirty();
			middle.clearDirty();
			leaf.clearDirty();

			leaf.markDirty();

			expect(leaf.dirty).toBe(true);
			expect(middle.dirty).toBe(true);
			expect(root.dirty).toBe(true);
		});

		it("clears dirty flag", () => {
			const component = new TestComponent();

			expect(component.dirty).toBe(true);

			component.clearDirty();

			expect(component.dirty).toBe(false);
		});

		it("marks dirty when appending child", () => {
			const parent = new TestComponent();
			const child = new TestComponent();

			parent.clearDirty();
			expect(parent.dirty).toBe(false);

			parent.appendChild(child);

			expect(parent.dirty).toBe(true);
		});

		it("marks dirty when removing child", () => {
			const parent = new TestComponent();
			const child = new TestComponent();

			parent.appendChild(child);
			parent.clearDirty();

			parent.removeChild(child);

			expect(parent.dirty).toBe(true);
		});
	});

	describe("lifecycle hooks", () => {
		it("calls onMount", () => {
			const component = new TestComponent();
			const onMountSpy = vi.spyOn(component, "onMount");

			component.onMount();

			expect(onMountSpy).toHaveBeenCalled();
			expect(component.mounted).toBe(true);
		});

		it("calls onUnmount", () => {
			const component = new TestComponent();
			component.yogaNode = createNode();
			component.onMount();

			const onUnmountSpy = vi.spyOn(component, "onUnmount");

			component.onUnmount();

			expect(onUnmountSpy).toHaveBeenCalled();
			expect(component.mounted).toBe(false);
			expect(component.yogaNode).toBeNull();
		});

		it("calls onUnmount recursively for children", () => {
			const parent = new TestComponent();
			const child1 = new TestComponent();
			const child2 = new TestComponent();

			parent.appendChild(child1);
			parent.appendChild(child2);

			child1.onMount();
			child2.onMount();

			const child1Spy = vi.spyOn(child1, "onUnmount");
			const child2Spy = vi.spyOn(child2, "onUnmount");

			parent.onUnmount();

			expect(child1Spy).toHaveBeenCalled();
			expect(child2Spy).toHaveBeenCalled();
			expect(child1.mounted).toBe(false);
			expect(child2.mounted).toBe(false);
		});

		it("frees yoga node on unmount", () => {
			const component = new TestComponent();
			component.yogaNode = createNode();

			const freeSpy = vi.spyOn(component.yogaNode, "free");

			component.onUnmount();

			expect(freeSpy).toHaveBeenCalled();
			expect(component.yogaNode).toBeNull();
		});

		it("calls onUpdate and marks dirty", () => {
			const component = new TestComponent();
			component.clearDirty();

			expect(component.dirty).toBe(false);

			component.onUpdate();

			expect(component.dirty).toBe(true);
		});
	});

	describe("layout rect computation", () => {
		it("returns zero rect when no yoga node", () => {
			const component = new TestComponent();

			const rect = component.getLayoutRect();

			expect(rect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
		});

		it("returns computed layout from yoga node", () => {
			const component = new TestComponent();
			component.yogaNode = createNode();
			component.yogaNode.setWidth(100);
			component.yogaNode.setHeight(50);
			// Must compute layout before reading computed values
			computeLayout(component.yogaNode, 200, 200);

			const rect = component.getLayoutRect();

			expect(rect.width).toBe(100);
			expect(rect.height).toBe(50);
		});

		it("computes absolute rect for root component", () => {
			const component = new TestComponent();
			component.yogaNode = createNode();
			component.yogaNode.setWidth(100);
			component.yogaNode.setHeight(50);
			computeLayout(component.yogaNode, 200, 200);

			const rect = component.getAbsoluteRect();

			expect(rect.x).toBe(0);
			expect(rect.y).toBe(0);
			expect(rect.width).toBe(100);
			expect(rect.height).toBe(50);
		});

		it("computes absolute rect relative to parent", () => {
			const parent = new TestComponent();
			const child = new TestComponent();

			parent.yogaNode = createNode();
			child.yogaNode = createNode();

			parent.yogaNode.setWidth(200);
			parent.yogaNode.setHeight(100);
			child.yogaNode.setWidth(50);
			child.yogaNode.setHeight(25);

			parent.appendChild(child);
			computeLayout(parent.yogaNode, 300, 300);

			const childRect = child.getAbsoluteRect();

			expect(childRect.width).toBe(50);
			expect(childRect.height).toBe(25);
		});
	});

	describe("abstract render method", () => {
		it("calls render method when invoked", () => {
			const component = new TestComponent();
			const screen = {} as Screen;
			const rect: Rect = { x: 0, y: 0, width: 100, height: 50 };

			expect(component.renderCalled).toBe(false);

			component.render(screen, rect);

			expect(component.renderCalled).toBe(true);
			expect(component.renderRect).toEqual(rect);
		});

		it("can be called multiple times", () => {
			const component = new TestComponent();
			const screen = {} as Screen;
			const rect1: Rect = { x: 0, y: 0, width: 100, height: 50 };
			const rect2: Rect = { x: 10, y: 10, width: 80, height: 40 };

			component.render(screen, rect1);
			expect(component.renderRect).toEqual(rect1);

			component.render(screen, rect2);
			expect(component.renderRect).toEqual(rect2);
		});
	});

	describe("component style", () => {
		it("initializes with empty style", () => {
			const component = new TestComponent();

			expect(component.style).toEqual({});
		});

		it("can set style properties", () => {
			const component = new TestComponent();

			component.style = {
				width: 100,
				height: 50,
				flexGrow: 1,
				visible: true,
			};

			expect(component.style.width).toBe(100);
			expect(component.style.height).toBe(50);
			expect(component.style.flexGrow).toBe(1);
			expect(component.style.visible).toBe(true);
		});

		it("can update style properties", () => {
			const component = new TestComponent();

			component.style = { width: 100 };
			expect(component.style.width).toBe(100);

			component.style = { ...component.style, height: 50 };
			expect(component.style.width).toBe(100);
			expect(component.style.height).toBe(50);
		});
	});

	describe("component key", () => {
		it("initializes without key", () => {
			const component = new TestComponent();

			expect(component.key).toBeUndefined();
		});

		it("can set key", () => {
			const component = new TestComponent();

			component.key = "test-key";

			expect(component.key).toBe("test-key");
		});
	});
});
