/**
 * Yoga WASM loading helper.
 * Wraps yoga-wasm-web initialization and provides convenience
 * functions for creating/configuring layout nodes.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { YogaNode, ComponentStyle } from "./component.js";

// ── Yoga constants (matching yoga-wasm-web enums) ─────────────────────────────

export const FLEX_DIRECTION_COLUMN = 0;
export const FLEX_DIRECTION_ROW = 2;
export const EDGE_TOP = 1;
export const EDGE_RIGHT = 2;
export const EDGE_BOTTOM = 3;
export const EDGE_LEFT = 0;
export const EDGE_ALL = 8;
export const POSITION_TYPE_RELATIVE = 0;
export const POSITION_TYPE_ABSOLUTE = 1;
export const DIRECTION_LTR = 0;

/** Yoga WASM instance — initialized lazily. */
let yogaInstance: any = null;

/** Initialize Yoga WASM. Call once before using layout. */
export async function initYoga(): Promise<void> {
	if (yogaInstance) return;
	try {
		const yoga = await import("yoga-wasm-web");
		const require = createRequire(import.meta.url);
		const wasmPath = require.resolve("yoga-wasm-web/dist/yoga.wasm");
		const wasmBuffer = readFileSync(wasmPath);
		yogaInstance = await yoga.default(wasmBuffer);
	} catch {
		// If yoga-wasm-web not available, we'll use a fallback
		yogaInstance = createFallbackYoga();
	}
}

/** Get the Yoga instance. Throws if not initialized. */
export function getYoga(): any {
	if (!yogaInstance) {
		throw new Error("Yoga not initialized. Call initYoga() first.");
	}
	return yogaInstance;
}

/** Create a new Yoga node. */
export function createNode(): YogaNode {
	const yoga = getYoga();
	return yoga.Node.create() as YogaNode;
}

/** Apply a ComponentStyle to a Yoga node. */
export function applyStyle(node: YogaNode, style: ComponentStyle): void {
	if (style.width !== undefined) {
		if (typeof style.width === "number") {
			node.setWidth(style.width);
		}
	}

	if (style.height !== undefined) {
		if (typeof style.height === "number") {
			node.setHeight(style.height);
		}
	}

	if (style.flexGrow !== undefined) {
		node.setFlexGrow(style.flexGrow);
	}

	if (style.flexShrink !== undefined) {
		node.setFlexShrink(style.flexShrink);
	}

	if (style.flexDirection !== undefined) {
		node.setFlexDirection(
			style.flexDirection === "row" ? FLEX_DIRECTION_ROW : FLEX_DIRECTION_COLUMN,
		);
	}

	if (style.padding !== undefined) {
		applyEdgeValue(node, "setPadding", style.padding);
	}

	if (style.margin !== undefined) {
		applyEdgeValue(node, "setMargin", style.margin);
	}
}

/** Compute layout for a tree starting at root. */
export function computeLayout(root: YogaNode, width: number, height: number): void {
	root.calculateLayout(width, height, DIRECTION_LTR);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function applyEdgeValue(
	node: YogaNode,
	method: "setPadding" | "setMargin",
	value: number | [number, number] | [number, number, number, number],
): void {
	if (typeof value === "number") {
		node[method](EDGE_ALL, value);
	} else if (value.length === 2) {
		node[method](EDGE_TOP, value[0]);
		node[method](EDGE_BOTTOM, value[0]);
		node[method](EDGE_LEFT, value[1]);
		node[method](EDGE_RIGHT, value[1]);
	} else {
		node[method](EDGE_TOP, value[0]);
		node[method](EDGE_RIGHT, value[1]);
		node[method](EDGE_BOTTOM, value[2]);
		node[method](EDGE_LEFT, value[3]);
	}
}

/** Fallback "Yoga" for environments where WASM isn't available. */
function createFallbackYoga(): any {
	return {
		Node: {
			create(): YogaNode {
				let _width = 0;
				let _height = 0;
				let _left = 0;
				let _top = 0;
				const _children: YogaNode[] = [];

				return {
					setWidth(w: number) { _width = w; },
					setHeight(h: number) { _height = h; },
					setFlexDirection() {},
					setFlexGrow() {},
					setFlexShrink() {},
					setPadding() {},
					setMargin() {},
					setPositionType() {},
					getComputedLeft() { return _left; },
					getComputedTop() { return _top; },
					getComputedWidth() { return _width; },
					getComputedHeight() { return _height; },
					insertChild(child: YogaNode, index: number) {
						_children.splice(index, 0, child);
					},
					removeChild(child: YogaNode) {
						const idx = _children.indexOf(child);
						if (idx >= 0) _children.splice(idx, 1);
					},
					getChildCount() { return _children.length; },
					calculateLayout(width: number, height: number) {
						_width = width;
						_height = height;
					},
					free() {},
				};
			},
		},
	};
}
