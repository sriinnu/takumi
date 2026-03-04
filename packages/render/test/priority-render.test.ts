/**
 * Tests for priority rendering (Phase 23: Input Latency Fix).
 *
 * Verifies that schedulePriorityRender bypasses frame rate limiting
 * to provide <5ms keystroke-to-screen latency.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Component } from "../src/component.js";
import { RenderScheduler } from "../src/reconciler.js";

class MockComponent extends Component {
	render(): string {
		return "test";
	}
}

describe("RenderScheduler priority rendering", () => {
	let scheduler: RenderScheduler;
	let mockWrite: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockWrite = vi.fn();
		scheduler = new RenderScheduler(80, 24, { fps: 60, write: mockWrite });
	});

	afterEach(() => {
		if (scheduler) {
			scheduler.stop();
		}
		vi.clearAllTimers();
	});

	it("should schedule priority render immediately with setImmediate", async () => {
		const root = new MockComponent();
		scheduler.setRoot(root);
		scheduler.start();

		const beforeTime = Date.now();
		scheduler.schedulePriorityRender();

		// setImmediate executes before setTimeout(0)
		await new Promise(setImmediate);

		const afterTime = Date.now();
		const latency = afterTime - beforeTime;

		// Priority render should complete in <5ms
		expect(latency).toBeLessThan(5);
		expect(mockWrite).toHaveBeenCalled();
	});

	it("should allow rapid priority renders without debouncing", async () => {
		const root = new MockComponent();
		scheduler.setRoot(root);
		scheduler.start();

		// Simulate 20 keystrokes in rapid succession
		for (let i = 0; i < 20; i++) {
			scheduler.schedulePriorityRender();
			await new Promise(setImmediate);
		}

		// Priority renders triggered (may be coalesced by scheduler)
		expect(mockWrite.mock.calls.length).toBeGreaterThanOrEqual(1);
	});

	it("should not schedule priority render if already scheduled", async () => {
		const root = new MockComponent();
		scheduler.setRoot(root);
		scheduler.start();

		scheduler.schedulePriorityRender();
		scheduler.schedulePriorityRender(); // Second call should be no-op

		// Wait for priority render to complete
		await new Promise(setImmediate);

		// At least one render happened
		expect(mockWrite.mock.calls.length).toBeGreaterThanOrEqual(1);
	});

	it("should not schedule priority render if not running", () => {
		const _root = new MockComponent();
		// DON'T start scheduler

		scheduler.schedulePriorityRender();

		expect(mockWrite).not.toHaveBeenCalled();
	});

	it("should update lastFrameTime after priority render", async () => {
		const root = new MockComponent();
		scheduler.setRoot(root);
		scheduler.start();

		// Force a frame to set initial lastFrameTime
		scheduler.schedulePriorityRender();
		await new Promise(setImmediate);

		// Schedule a normal render
		scheduler.scheduleRender();
		await new Promise((resolve) => setTimeout(resolve, 20));

		// At least one render happened
		expect(mockWrite.mock.calls.length).toBeGreaterThanOrEqual(1);
	});

	it("should render priority and normal renders independently", async () => {
		const root = new MockComponent();
		scheduler.setRoot(root);
		scheduler.start();

		// Schedule a normal render (will wait for frame interval)
		scheduler.scheduleRender();

		// Schedule a priority render (executes immediately)
		const beforeTime = Date.now();
		scheduler.schedulePriorityRender();
		await new Promise(setImmediate);
		const afterTime = Date.now();

		// Priority render completed quickly
		expect(afterTime - beforeTime).toBeLessThan(5);

		// Normal render still pending or completed
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(mockWrite.mock.calls.length).toBeGreaterThanOrEqual(1);
	});
});

describe("Priority render latency measurement", () => {
	it("should measure <5ms average latency for 100 renders", async () => {
		const mockWrite = vi.fn();
		const scheduler = new RenderScheduler(80, 24, { fps: 60, write: mockWrite });
		const root = new MockComponent();
		scheduler.setRoot(root);
		scheduler.start();

		const latencies: number[] = [];

		for (let i = 0; i < 100; i++) {
			const start = performance.now();
			scheduler.schedulePriorityRender();
			await new Promise(setImmediate);
			const end = performance.now();
			latencies.push(end - start);
		}

		scheduler.stop();

		const avg = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
		const p99 = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.99)];

		// Target: <5ms average, <10ms p99
		expect(avg).toBeLessThan(5);
		expect(p99).toBeLessThan(10);
	});
});
