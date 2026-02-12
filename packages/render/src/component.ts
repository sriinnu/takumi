/**
 * Abstract base Component with Yoga layout node, dirty tracking,
 * and lifecycle hooks. All UI components extend this.
 */

import type { Rect } from "@takumi/core";
import type { Screen } from "./screen.js";

/** Yoga node stub — real type comes from yoga-wasm-web. */
export interface YogaNode {
	setWidth(w: number): void;
	setHeight(h: number): void;
	setFlexDirection(dir: number): void;
	setFlexGrow(grow: number): void;
	setFlexShrink(shrink: number): void;
	setPadding(edge: number, val: number): void;
	setMargin(edge: number, val: number): void;
	setPositionType(type: number): void;
	getComputedLeft(): number;
	getComputedTop(): number;
	getComputedWidth(): number;
	getComputedHeight(): number;
	insertChild(child: YogaNode, index: number): void;
	removeChild(child: YogaNode): void;
	getChildCount(): number;
	calculateLayout(width: number, height: number, direction: number): void;
	free(): void;
}

export interface ComponentStyle {
	width?: number | string;
	height?: number | string;
	flexGrow?: number;
	flexShrink?: number;
	flexDirection?: "row" | "column";
	padding?: number | [number, number] | [number, number, number, number];
	margin?: number | [number, number] | [number, number, number, number];
	visible?: boolean;
}

export abstract class Component {
	/** Yoga layout node for this component. */
	yogaNode: YogaNode | null = null;

	/** Parent component. */
	parent: Component | null = null;

	/** Child components. */
	children: Component[] = [];

	/** Style properties controlling layout. */
	style: ComponentStyle = {};

	/** Whether this component needs re-rendering. */
	private _dirty = true;

	/** Unique key for reconciliation. */
	key: string | undefined;

	/** Whether this component has been mounted. */
	private _mounted = false;

	/** Mark this component as needing re-render. */
	markDirty(): void {
		this._dirty = true;
		this.parent?.markDirty();
	}

	/** Check if this component is dirty. */
	get dirty(): boolean {
		return this._dirty;
	}

	/** Clear dirty flag after rendering. */
	clearDirty(): void {
		this._dirty = false;
	}

	/** Get the computed layout rect from Yoga. */
	getLayoutRect(): Rect {
		if (!this.yogaNode) {
			return { x: 0, y: 0, width: 0, height: 0 };
		}
		return {
			x: this.yogaNode.getComputedLeft(),
			y: this.yogaNode.getComputedTop(),
			width: this.yogaNode.getComputedWidth(),
			height: this.yogaNode.getComputedHeight(),
		};
	}

	/** Get absolute position by walking up the tree. */
	getAbsoluteRect(): Rect {
		const local = this.getLayoutRect();
		if (!this.parent) return local;
		const parentRect = this.parent.getAbsoluteRect();
		return {
			x: parentRect.x + local.x,
			y: parentRect.y + local.y,
			width: local.width,
			height: local.height,
		};
	}

	/** Add a child component. */
	appendChild(child: Component): void {
		child.parent = this;
		this.children.push(child);
		if (this.yogaNode && child.yogaNode) {
			this.yogaNode.insertChild(child.yogaNode, this.yogaNode.getChildCount());
		}
		this.markDirty();
	}

	/** Remove a child component. */
	removeChild(child: Component): void {
		const idx = this.children.indexOf(child);
		if (idx === -1) return;
		this.children.splice(idx, 1);
		child.parent = null;
		if (this.yogaNode && child.yogaNode) {
			this.yogaNode.removeChild(child.yogaNode);
		}
		child.onUnmount();
		this.markDirty();
	}

	/** Lifecycle: called after first render. */
	onMount(): void {
		this._mounted = true;
	}

	/** Lifecycle: called before removal from tree. */
	onUnmount(): void {
		this._mounted = false;
		if (this.yogaNode) {
			this.yogaNode.free();
			this.yogaNode = null;
		}
		for (const child of this.children) {
			child.onUnmount();
		}
	}

	/** Lifecycle: called when component receives new props/style. */
	onUpdate(): void {
		this.markDirty();
	}

	get mounted(): boolean {
		return this._mounted;
	}

	/**
	 * Render this component to the screen buffer.
	 * Subclasses must implement this.
	 */
	abstract render(screen: Screen, rect: Rect): void;
}
