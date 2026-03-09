import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Autocycle, type AutocycleOptions } from "../src/autocycle.js";

// Mock child_process.spawn so no real subprocesses are launched
vi.mock("node:child_process", () => {
	const { EventEmitter } = require("node:events");
	const { Readable } = require("node:stream");

	let mockExit = { code: 0, stdout: "", stderr: "" };
	let mockSpawnError: string | null = null;

	function setMockExit(opts: { code?: number; stdout?: string; stderr?: string }) {
		mockExit = { code: opts.code ?? 0, stdout: opts.stdout ?? "", stderr: opts.stderr ?? "" };
	}

	function spawn() {
		const child = new EventEmitter();
		child.stdout = new Readable({ read() {} });
		child.stderr = new Readable({ read() {} });
		child.kill = vi.fn();

		setTimeout(() => {
			if (mockSpawnError) {
				child.emit("error", new Error(mockSpawnError));
				return;
			}
			if (mockExit.stdout) child.stdout.push(mockExit.stdout);
			child.stdout.push(null);
			if (mockExit.stderr) child.stderr.push(mockExit.stderr);
			child.stderr.push(null);
			child.emit("close", mockExit.code);
		}, 10);

		return child;
	}

	return {
		spawn,
		__setMockExit: setMockExit,
		__setMockSpawnError: (err: string | null) => {
			mockSpawnError = err;
		},
	};
});

const { __setMockExit, __setMockSpawnError } = (await import("node:child_process")) as any;

const TMP_DIR = path.join(import.meta.dirname ?? __dirname, ".tmp-autocycle-test");
const TARGET_FILE = "target.txt";
const OUTSIDE_DIRECT_DIR = path.join(TMP_DIR, "..", "outside-autocycle-direct-unit");
const OUTSIDE_TARGET_DIR = path.join(TMP_DIR, "..", "outside-autocycle-target-unit");

function makeOptions(overrides: Partial<AutocycleOptions> = {}): AutocycleOptions {
	return {
		targetFile: TARGET_FILE,
		evalCommand: "echo test",
		evalBudgetMs: 5000,
		cwd: TMP_DIR,
		...overrides,
	};
}

describe("Autocycle", () => {
	beforeEach(async () => {
		__setMockExit({ code: 0, stdout: "", stderr: "" });
		__setMockSpawnError(null);
		await fs.mkdir(TMP_DIR, { recursive: true });
		await fs.writeFile(path.join(TMP_DIR, TARGET_FILE), "original content", "utf-8");
	});

	afterEach(async () => {
		await fs.rm(TMP_DIR, { recursive: true, force: true });
		await fs.rm(OUTSIDE_DIRECT_DIR, { recursive: true, force: true });
		await fs.rm(OUTSIDE_TARGET_DIR, { recursive: true, force: true });
	});

	it("should create an instance with valid options", () => {
		const ac = new Autocycle(makeOptions());
		expect(ac).toBeDefined();
	});

	it("should throw if evalBudgetMs is NaN", () => {
		expect(() => new Autocycle(makeOptions({ evalBudgetMs: Number.NaN }))).toThrow("Invalid evalBudgetMs");
	});

	it("should throw if evalBudgetMs is zero", () => {
		expect(() => new Autocycle(makeOptions({ evalBudgetMs: 0 }))).toThrow("Invalid evalBudgetMs");
	});

	it("should throw if evalBudgetMs is negative", () => {
		expect(() => new Autocycle(makeOptions({ evalBudgetMs: -100 }))).toThrow("Invalid evalBudgetMs");
	});

	it("should throw if evalBudgetMs is Infinity", () => {
		expect(() => new Autocycle(makeOptions({ evalBudgetMs: Number.POSITIVE_INFINITY }))).toThrow(
			"Invalid evalBudgetMs",
		);
	});

	it("should throw if targetFile is empty", () => {
		expect(() => new Autocycle(makeOptions({ targetFile: "   " }))).toThrow("Invalid targetFile");
	});

	it("should throw if evalCommand is empty", () => {
		expect(() => new Autocycle(makeOptions({ evalCommand: "   " }))).toThrow("Invalid evalCommand");
	});

	it("should throw if optimizeDirection is invalid at runtime", () => {
		expect(
			() => new Autocycle(makeOptions({ optimizeDirection: "sideways" as AutocycleOptions["optimizeDirection"] })),
		).toThrow("Invalid optimizeDirection");
	});

	it("should report success when eval exits with code 0 and no metric regex", async () => {
		__setMockExit({ code: 0, stdout: "all good" });
		const ac = new Autocycle(makeOptions());
		const result = await ac.runCycleEvaluation();

		expect(result.iteration).toBe(1);
		expect(result.success).toBe(true);
		expect(result.status).toBe("keep");
		expect(result.metric).toBeNull();
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("should report failure when eval exits with non-zero code", async () => {
		__setMockExit({ code: 1, stderr: "error" });
		const ac = new Autocycle(makeOptions());
		const result = await ac.runCycleEvaluation();

		expect(result.success).toBe(false);
		expect(result.status).toBe("crash");
	});

	it("should extract metric from stdout using regex", async () => {
		__setMockExit({ code: 0, stdout: "accuracy: 0.95" });
		const ac = new Autocycle(makeOptions({ metricRegex: /accuracy:\s+([\d.]+)/ }));
		const result = await ac.runCycleEvaluation();

		expect(result.success).toBe(true);
		expect(result.status).toBe("keep");
		expect(result.metric).toBe(0.95);
	});

	it("should detect improvement across iterations", async () => {
		__setMockExit({ code: 0, stdout: "score: 10" });
		const ac = new Autocycle(makeOptions({ metricRegex: /score:\s+([\d.]+)/, optimizeDirection: "maximize" }));

		const r1 = await ac.runCycleEvaluation();
		expect(r1.success).toBe(true);
		expect(r1.status).toBe("keep");
		expect(r1.metric).toBe(10);

		// Better score
		__setMockExit({ code: 0, stdout: "score: 15" });
		const r2 = await ac.runCycleEvaluation();
		expect(r2.success).toBe(true);
		expect(r2.status).toBe("keep");
		expect(r2.metric).toBe(15);

		// Worse score — should revert
		__setMockExit({ code: 0, stdout: "score: 8" });
		const r3 = await ac.runCycleEvaluation();
		expect(r3.success).toBe(false);
		expect(r3.status).toBe("discard");
		expect(r3.metric).toBe(8);
	});

	it("should revert target file on failure", async () => {
		__setMockExit({ code: 0, stdout: "ok" });
		const ac = new Autocycle(makeOptions());

		// First run establishes backup
		await ac.runCycleEvaluation();

		// Simulate a code mutation
		await fs.writeFile(path.join(TMP_DIR, TARGET_FILE), "mutated content", "utf-8");

		// Fail next eval
		__setMockExit({ code: 1, stderr: "fail" });
		await ac.runCycleEvaluation();

		// File should be reverted
		const content = await fs.readFile(path.join(TMP_DIR, TARGET_FILE), "utf-8");
		expect(content).toBe("original content");
	});

	it("should increment iteration counter", async () => {
		__setMockExit({ code: 0, stdout: "ok" });
		const ac = new Autocycle(makeOptions());

		const r1 = await ac.runCycleEvaluation();
		expect(r1.iteration).toBe(1);

		const r2 = await ac.runCycleEvaluation();
		expect(r2.iteration).toBe(2);
	});

	it("should fail when metric regex doesn't match", async () => {
		__setMockExit({ code: 0, stdout: "no metric here" });
		const ac = new Autocycle(makeOptions({ metricRegex: /score:\s+([\d.]+)/ }));
		const result = await ac.runCycleEvaluation();

		expect(result.success).toBe(false);
		expect(result.status).toBe("metric-missing");
		expect(result.metric).toBeNull();
	});

	it("should accept an AbortSignal and resolve immediately when pre-aborted", async () => {
		__setMockExit({ code: 0, stdout: "ok" });
		const ac = new Autocycle(makeOptions());

		const controller = new AbortController();
		controller.abort();

		const result = await ac.runCycleEvaluation(controller.signal);
		// Subprocess shouldn't even run; iteration increments but eval is aborted
		expect(result.success).toBe(false);
		expect(result.status).toBe("aborted");
	});

	it("validateTargetFile should resolve when file exists", async () => {
		const ac = new Autocycle(makeOptions());
		await expect(ac.validateTargetFile()).resolves.toBeUndefined();
	});

	it("validateTargetFile should throw when file is missing", async () => {
		const ac = new Autocycle(makeOptions({ targetFile: "does-not-exist.txt" }));
		await expect(ac.validateTargetFile()).rejects.toThrow();
	});

	it("should throw when revert fails due to missing target path", async () => {
		// First eval succeeds, establishing a backup. Then delete the file to make write fail.
		__setMockExit({ code: 0, stdout: "ok" });
		const ac = new Autocycle(makeOptions());
		await ac.runCycleEvaluation(); // Establishes backup

		// Remove target directory so writeFile fails
		await fs.rm(TMP_DIR, { recursive: true, force: true });

		__setMockExit({ code: 1, stderr: "fail" });
		await expect(ac.runCycleEvaluation()).rejects.toThrow();
	});

	it("should handle spawn errors gracefully", async () => {
		__setMockSpawnError("ENOENT: command not found");
		const ac = new Autocycle(makeOptions());
		const result = await ac.runCycleEvaluation();
		expect(result.success).toBe(false);
		expect(result.status).toBe("crash");
	});

	it("should not increment iteration counter when pre-aborted", async () => {
		const ac = new Autocycle(makeOptions());
		const controller = new AbortController();
		controller.abort();

		const r1 = await ac.runCycleEvaluation(controller.signal);
		expect(r1.iteration).toBe(0);

		// Non-aborted call should still use iteration 1
		__setMockExit({ code: 0, stdout: "ok" });
		const r2 = await ac.runCycleEvaluation();
		expect(r2.iteration).toBe(1);
	});

	it("should reject target file outside working directory", async () => {
		const outsideFile = path.join(OUTSIDE_DIRECT_DIR, "outside.txt");
		await fs.mkdir(OUTSIDE_DIRECT_DIR, { recursive: true });
		await fs.writeFile(outsideFile, "outside content", "utf-8");

		const ac = new Autocycle(makeOptions({ targetFile: path.relative(TMP_DIR, outsideFile) }));
		await expect(ac.validateTargetFile()).rejects.toThrow("outside the working directory");
	});

	it("should reject target file symlink that resolves outside working directory", async () => {
		const outsideFile = path.join(OUTSIDE_TARGET_DIR, "outside.txt");
		const symlinkPath = path.join(TMP_DIR, "linked-outside.txt");

		await fs.mkdir(OUTSIDE_TARGET_DIR, { recursive: true });
		await fs.writeFile(outsideFile, "outside content", "utf-8");
		await fs.symlink(outsideFile, symlinkPath);

		const ac = new Autocycle(makeOptions({ targetFile: "linked-outside.txt" }));
		await expect(ac.validateTargetFile()).rejects.toThrow("outside the working directory");
	});

	it("should ignore unparseable metric values (NaN from regex)", async () => {
		__setMockExit({ code: 0, stdout: "accuracy: notanumber" });
		const ac = new Autocycle(makeOptions({ metricRegex: /accuracy:\s+(\S+)/ }));
		const result = await ac.runCycleEvaluation();
		expect(result.success).toBe(false);
		expect(result.status).toBe("metric-missing");
		expect(result.metric).toBeNull();
	});

	it("writes a JSONL ledger entry for each completed evaluation", async () => {
		__setMockExit({ code: 0, stdout: "score: 7" });
		const ac = new Autocycle(makeOptions({ metricRegex: /score:\s+([\d.]+)/ }));

		const result = await ac.runCycleEvaluation();
		const ledgerText = await fs.readFile(ac.getLedgerFilePath(), "utf-8");
		const [line] = ledgerText.trim().split("\n");
		const entry = JSON.parse(line);

		expect(result.status).toBe("keep");
		expect(entry.iteration).toBe(1);
		expect(entry.status).toBe("keep");
		expect(entry.metric).toBe(7);
		expect(entry.bestMetric).toBe(7);
		expect(entry.targetFile).toBe(TARGET_FILE);
		expect(entry.evalCommand).toBe("echo test");
	});

	it("summarizes keep/discard counts and metric progression for the current run", async () => {
		const ac = new Autocycle(makeOptions({ metricRegex: /score:\s+([\d.]+)/, optimizeDirection: "maximize" }));

		__setMockExit({ code: 0, stdout: "score: 10" });
		await ac.runCycleEvaluation();

		__setMockExit({ code: 0, stdout: "score: 15" });
		await ac.runCycleEvaluation();

		__setMockExit({ code: 0, stdout: "score: 8" });
		await ac.runCycleEvaluation();

		const summary = ac.getRunSummary();
		expect(summary.completedEvaluations).toBe(3);
		expect(summary.counts.keep).toBe(2);
		expect(summary.counts.discard).toBe(1);
		expect(summary.keepRate).toBeCloseTo(2 / 3, 5);
		expect(summary.baselineMetric).toBe(10);
		expect(summary.bestMetric).toBe(15);
		expect(summary.latestMetric).toBe(8);
		expect(summary.averageDurationMs).toBeGreaterThanOrEqual(0);
	});
});
