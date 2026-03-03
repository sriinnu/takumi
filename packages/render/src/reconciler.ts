/**
 * RenderScheduler — the render loop coordinator.
 *
 * Collects dirty components, runs Yoga layout, renders to the
 * back buffer, diffs against front buffer, and flushes minimal
 * ANSI output. Uses requestAnimationFrame-style batching with
 * setImmediate/setTimeout fallback.
 */

import type { Rect } from "@takumi/core";
import type { Component } from "./component.js";
import { Screen } from "./screen.js";
import { computeLayout } from "./yoga.js";

export interface RenderSchedulerOptions {
	/** Target FPS (default: 30). */
	fps?: number;
	/** Write function (default: process.stdout.write). */
	write?: (data: string) => void;
}

export class RenderScheduler {
	private screen: Screen;
	private root: Component | null = null;
	private scheduled = false;
	private priorityScheduled = false;
	private running = false;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private frameInterval: number;
	private writeFn: (data: string) => void;
	private lastFrameTime = 0;
	private frameCount = 0;

	constructor(width: number, height: number, options?: RenderSchedulerOptions) {
		this.screen = new Screen(width, height);
		this.frameInterval = 1000 / (options?.fps ?? 60);
		this.writeFn = options?.write ?? ((data: string) => process.stdout.write(data));
	}

	/** Set the root component of the render tree. */
	setRoot(component: Component): void {
		this.root = component;
		this.scheduleRender();
	}

	/** Request a render on the next frame. Debounced. */
	scheduleRender(): void {
		if (this.scheduled || !this.running) return;
		this.scheduled = true;

		const now = Date.now();
		const elapsed = now - this.lastFrameTime;
		const delay = Math.max(0, this.frameInterval - elapsed);

		if (delay === 0) {
			setImmediate(() => {
				this.scheduled = false;
				this.lastFrameTime = Date.now();
				this.renderFrame();
			});
		} else {
			this.timer = setTimeout(() => {
				this.scheduled = false;
				this.lastFrameTime = Date.now();
				this.renderFrame();
			}, delay);
		}
	}

	/**
	 * Schedule an immediate priority render (bypasses frame rate limiting).
	 * Use for interactive events like keystrokes where latency matters.
	 */
	schedulePriorityRender(): void {
		if (this.priorityScheduled || !this.running) return;
		this.priorityScheduled = true;

		setImmediate(() => {
			this.priorityScheduled = false;
			this.lastFrameTime = Date.now();
			this.renderFrame();
		});
	}

	/** Perform a single render frame. */
	private renderFrame(): void {
		if (!this.root) return;

		// 1. Layout — compute positions via Yoga
		if (this.root.yogaNode) {
			computeLayout(this.root.yogaNode, this.screen.width, this.screen.height);
		}

		// 2. Clear back buffer
		this.screen.clear();

		// 3. Render component tree into back buffer
		this.renderComponent(this.root, {
			x: 0,
			y: 0,
			width: this.screen.width,
			height: this.screen.height,
		});

		// 4. Diff and flush
		const patch = this.screen.diff();
		if (patch.changedCells > 0) {
			this.writeFn(patch.output);
		}

		this.frameCount++;
	}

	/** Recursively render a component and its children. */
	private renderComponent(component: Component, rect: Rect): void {
		if (component.style.visible === false) return;

		// Render this component
		component.render(this.screen, rect);
		component.clearDirty();

		// Render children with their computed rects
		for (const child of component.children) {
			const childRect = child.getAbsoluteRect();
			this.renderComponent(child, childRect);
		}
	}

	/** Resize the screen. Forces full redraw. */
	resize(width: number, height: number): void {
		this.screen.resize(width, height);
		this.screen.invalidate();
		this.scheduleRender();
	}

	/** Start the render loop. */
	start(): void {
		this.running = true;
		this.screen.invalidate();
		this.scheduleRender();
	}

	/** Stop the render loop. */
	stop(): void {
		this.running = false;
		this.scheduled = false;
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	/** Force an immediate render (bypasses scheduling). */
	forceRender(): void {
		this.lastFrameTime = Date.now();
		this.renderFrame();
	}

	/** Get render statistics. */
	getStats(): { frameCount: number; screenSize: { width: number; height: number } } {
		return {
			frameCount: this.frameCount,
			screenSize: { width: this.screen.width, height: this.screen.height },
		};
	}

	/** Get the underlying screen for direct manipulation. */
	getScreen(): Screen {
		return this.screen;
	}
}
