import { afterEach, describe, expect, it } from "vitest";
import { ProcessOrchestrator } from "../src/cluster/process-orchestrator.js";

describe("ProcessOrchestrator", () => {
	let orch: ProcessOrchestrator;

	afterEach(async () => {
		if (orch) await orch.destroyAll();
	});

	it("isAvailable always returns true", async () => {
		expect(await ProcessOrchestrator.isAvailable()).toBe(true);
	});

	it("createWindow spawns a process and captures output", async () => {
		orch = new ProcessOrchestrator();
		const win = await orch.createWindow("test-echo", "echo", ["hello-takumi"]);
		expect(win.id).toMatch(/^proc-/);
		expect(win.name).toBe("test-echo");

		// Wait for process to finish
		await new Promise((r) => setTimeout(r, 500));

		const output = orch.captureOutput(win.id);
		expect(output).toContain("hello-takumi");
	});

	it("captureOutput returns empty for unknown window", () => {
		orch = new ProcessOrchestrator();
		expect(orch.captureOutput("nonexistent")).toBe("");
	});

	it("listWindows tracks created processes", async () => {
		orch = new ProcessOrchestrator();
		expect(orch.listWindows()).toHaveLength(0);
		await orch.createWindow("win-a", "echo", ["a"]);
		expect(orch.listWindows()).toHaveLength(1);
		await orch.createWindow("win-b", "echo", ["b"]);
		expect(orch.listWindows()).toHaveLength(2);
	});

	it("killWindow removes it from the list", async () => {
		orch = new ProcessOrchestrator();
		const win = await orch.createWindow("kill-me", "echo", ["bye"]);
		expect(orch.listWindows()).toHaveLength(1);
		await orch.killWindow(win.id);
		expect(orch.listWindows()).toHaveLength(0);
	});

	it("isWindowAlive returns false after the child exits", async () => {
		orch = new ProcessOrchestrator();
		const win = await orch.createWindow("short-lived", "echo", ["done"]);

		await new Promise((resolve) => setTimeout(resolve, 250));

		expect(await orch.isWindowAlive(win.id)).toBe(false);
		expect(orch.captureOutput(win.id)).toContain("done");
	});

	it("destroyAll cleans up all windows", async () => {
		orch = new ProcessOrchestrator();
		await orch.createWindow("a", "echo", ["1"]);
		await orch.createWindow("b", "echo", ["2"]);
		expect(orch.listWindows()).toHaveLength(2);
		await orch.destroyAll();
		expect(orch.listWindows()).toHaveLength(0);
	});

	it("hasRunning reflects process state", async () => {
		orch = new ProcessOrchestrator();
		expect(orch.hasRunning).toBe(false);

		// Sleep is a long-running process
		const win = await orch.createWindow("sleeper", "sleep", ["10"]);
		expect(orch.hasRunning).toBe(true);

		await orch.killWindow(win.id);
		expect(orch.hasRunning).toBe(false);
	});
});
