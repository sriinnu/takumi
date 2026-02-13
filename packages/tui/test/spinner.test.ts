/**
 * Tests for ToolSpinner — animated progress spinners for tool execution.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolSpinner, TOOL_SPINNER_FRAMES } from "../src/spinner.js";

describe("ToolSpinner", () => {
	let spinner: ToolSpinner;

	beforeEach(() => {
		spinner = new ToolSpinner();
	});

	// ── Lifecycle ──────────────────────────────────────────────────────────

	it("starts with no active tools", () => {
		expect(spinner.isRunning).toBe(false);
		expect(spinner.activeTools).toEqual([]);
		expect(spinner.activeCount).toBe(0);
	});

	it("starts a tool and tracks it as active", () => {
		spinner.start("tool-1", "bash", "pnpm test");
		expect(spinner.isRunning).toBe(true);
		expect(spinner.activeTools).toEqual(["tool-1"]);
		expect(spinner.activeCount).toBe(1);
	});

	it("completes a tool and removes it from active", () => {
		spinner.start("tool-1", "bash", "pnpm test");
		spinner.complete("tool-1", true, 2100);
		expect(spinner.isRunning).toBe(false);
		expect(spinner.activeTools).toEqual([]);
		expect(spinner.activeCount).toBe(0);
	});

	it("stores completed tool with success state", () => {
		spinner.start("tool-1", "bash", "pnpm test");
		spinner.complete("tool-1", true, 2100);
		const entry = spinner.getCompleted("tool-1");
		expect(entry).toBeDefined();
		expect(entry!.success).toBe(true);
		expect(entry!.durationMs).toBe(2100);
	});

	it("stores completed tool with error state", () => {
		spinner.start("tool-1", "bash", "pnpm test");
		spinner.complete("tool-1", false, 500);
		const entry = spinner.getCompleted("tool-1");
		expect(entry).toBeDefined();
		expect(entry!.success).toBe(false);
		expect(entry!.durationMs).toBe(500);
	});

	it("handles completing a non-existent tool gracefully", () => {
		spinner.complete("nonexistent", true, 100);
		expect(spinner.completedCount).toBe(0);
	});

	// ── Multiple concurrent tools ─────────────────────────────────────────

	it("tracks multiple concurrent tools", () => {
		spinner.start("tool-1", "bash", "pnpm test");
		spinner.start("tool-2", "read", "src/app.ts");
		spinner.start("tool-3", "grep", "pattern");

		expect(spinner.activeCount).toBe(3);
		expect(spinner.activeTools).toContain("tool-1");
		expect(spinner.activeTools).toContain("tool-2");
		expect(spinner.activeTools).toContain("tool-3");
	});

	it("completes tools independently", () => {
		spinner.start("tool-1", "bash", "pnpm test");
		spinner.start("tool-2", "read", "src/app.ts");

		spinner.complete("tool-1", true, 1000);
		expect(spinner.activeCount).toBe(1);
		expect(spinner.activeTools).toEqual(["tool-2"]);
		expect(spinner.isRunning).toBe(true);

		spinner.complete("tool-2", true, 500);
		expect(spinner.isRunning).toBe(false);
		expect(spinner.completedCount).toBe(2);
	});

	// ── Animation ─────────────────────────────────────────────────────────

	it("starts at frame 0", () => {
		expect(spinner.currentFrame).toBe(0);
	});

	it("advances frame on tick", () => {
		spinner.tick();
		expect(spinner.currentFrame).toBe(1);
		spinner.tick();
		expect(spinner.currentFrame).toBe(2);
	});

	it("wraps frame around after all frames", () => {
		const frameCount = TOOL_SPINNER_FRAMES.length;
		for (let i = 0; i < frameCount; i++) {
			spinner.tick();
		}
		expect(spinner.currentFrame).toBe(0);
	});

	it("has correct number of Braille frames", () => {
		expect(TOOL_SPINNER_FRAMES.length).toBe(10);
	});

	// ── Display lines ─────────────────────────────────────────────────────

	it("returns running line with spinner frame for active tool", () => {
		spinner.start("tool-1", "bash", "pnpm test");
		const line = spinner.getLine("tool-1");
		expect(line.fg).toBe(3); // yellow
		expect(line.text).toContain("bash");
		expect(line.text).toContain("pnpm test");
		// Should start with a Braille frame character
		expect(TOOL_SPINNER_FRAMES).toContain(line.text[0]);
	});

	it("returns success line with check mark for completed tool", () => {
		spinner.start("tool-1", "bash", "pnpm test");
		spinner.complete("tool-1", true, 2100);
		const line = spinner.getLine("tool-1");
		expect(line.fg).toBe(2); // green
		expect(line.text).toContain("\u2713"); // check mark
		expect(line.text).toContain("bash");
		expect(line.text).toContain("2.1s");
	});

	it("returns error line with X mark for failed tool", () => {
		spinner.start("tool-1", "bash", "pnpm test");
		spinner.complete("tool-1", false, 500);
		const line = spinner.getLine("tool-1");
		expect(line.fg).toBe(1); // red
		expect(line.text).toContain("\u2717"); // X mark
		expect(line.text).toContain("bash");
		expect(line.text).toContain("500ms");
	});

	it("returns empty line for unknown tool", () => {
		const line = spinner.getLine("nonexistent");
		expect(line.text).toBe("");
		expect(line.dim).toBe(true);
	});

	it("shows animated spinner frame that changes with tick", () => {
		spinner.start("tool-1", "bash", "pnpm test");
		const line1 = spinner.getLine("tool-1");
		spinner.tick();
		const line2 = spinner.getLine("tool-1");
		// Frame should change
		expect(line1.text[0]).not.toBe(line2.text[0]);
	});

	it("formats duration as milliseconds for short durations", () => {
		spinner.start("tool-1", "bash", "cmd");
		spinner.complete("tool-1", true, 42);
		const line = spinner.getLine("tool-1");
		expect(line.text).toContain("42ms");
	});

	it("formats duration as seconds for longer durations", () => {
		spinner.start("tool-1", "bash", "cmd");
		spinner.complete("tool-1", true, 3500);
		const line = spinner.getLine("tool-1");
		expect(line.text).toContain("3.5s");
	});

	it("truncates long argument strings", () => {
		const longArgs = "a".repeat(100);
		spinner.start("tool-1", "bash", longArgs);
		const line = spinner.getLine("tool-1");
		expect(line.text.length).toBeLessThan(100);
		expect(line.text).toContain("...");
	});

	// ── Reset and cleanup ─────────────────────────────────────────────────

	it("clears completed tools", () => {
		spinner.start("tool-1", "bash", "cmd");
		spinner.complete("tool-1", true, 100);
		expect(spinner.completedCount).toBe(1);

		spinner.clearCompleted();
		expect(spinner.completedCount).toBe(0);
		expect(spinner.getCompleted("tool-1")).toBeUndefined();
	});

	it("resets all state", () => {
		spinner.start("tool-1", "bash", "cmd");
		spinner.start("tool-2", "read", "file");
		spinner.complete("tool-1", true, 100);
		spinner.tick();
		spinner.tick();

		spinner.reset();

		expect(spinner.isRunning).toBe(false);
		expect(spinner.activeCount).toBe(0);
		expect(spinner.completedCount).toBe(0);
		expect(spinner.currentFrame).toBe(0);
	});

	// ── getActive ──────────────────────────────────────────────────────────

	it("returns active tool entry", () => {
		spinner.start("tool-1", "bash", "pnpm test");
		const entry = spinner.getActive("tool-1");
		expect(entry).toBeDefined();
		expect(entry!.toolName).toBe("bash");
		expect(entry!.args).toBe("pnpm test");
		expect(entry!.startTime).toBeGreaterThan(0);
	});

	it("returns undefined for non-active tool", () => {
		expect(spinner.getActive("nonexistent")).toBeUndefined();
	});

	// ── Edge cases ─────────────────────────────────────────────────────────

	it("handles starting same tool ID twice (overwrites)", () => {
		spinner.start("tool-1", "bash", "first");
		spinner.start("tool-1", "read", "second");
		expect(spinner.activeCount).toBe(1);
		const entry = spinner.getActive("tool-1");
		expect(entry!.toolName).toBe("read");
	});

	it("handles empty args", () => {
		spinner.start("tool-1", "bash", "");
		const line = spinner.getLine("tool-1");
		expect(line.text).toContain("bash");
	});

	it("handles args with newlines", () => {
		spinner.start("tool-1", "bash", "line1\nline2\nline3");
		const line = spinner.getLine("tool-1");
		// Newlines should be replaced with spaces
		expect(line.text).not.toContain("\n");
	});
});
