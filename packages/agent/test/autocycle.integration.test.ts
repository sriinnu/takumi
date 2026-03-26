/**
 * Integration tests for Autocycle — run REAL subprocesses, no mocks.
 * These tests verify end-to-end behavior: command execution, metric extraction,
 * backup/revert on disk, timeout enforcement, and abort signal handling.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Autocycle, type AutocycleOptions } from "../src/autocycle.js";

const TMP_DIR = path.join(import.meta.dirname ?? __dirname, ".tmp-autocycle-integration");
const TARGET_FILE = "target.txt";
const OUTSIDE_DIRECT_DIR = path.join(TMP_DIR, "..", "outside-autocycle-direct-integration");

function makeOptions(overrides: Partial<AutocycleOptions> = {}): AutocycleOptions {
	return {
		targetFile: TARGET_FILE,
		evalCommand: 'echo "ok"',
		evalBudgetMs: 10_000,
		cwd: TMP_DIR,
		...overrides,
	};
}

describe("Autocycle (integration)", () => {
	beforeEach(async () => {
		await fs.mkdir(TMP_DIR, { recursive: true });
		await fs.writeFile(path.join(TMP_DIR, TARGET_FILE), "original content", "utf-8");
	});

	afterEach(async () => {
		await fs.rm(TMP_DIR, { recursive: true, force: true });
		await fs.rm(OUTSIDE_DIRECT_DIR, { recursive: true, force: true });
	});

	// ── Subprocess execution ──

	it("should run a real subprocess and capture exit code 0 as success", async () => {
		const ac = new Autocycle(makeOptions({ evalCommand: 'echo "all good"' }));
		const result = await ac.runCycleEvaluation();

		expect(result.iteration).toBe(1);
		expect(result.success).toBe(true);
		expect(result.status).toBe("keep");
		expect(result.durationMs).toBeGreaterThan(0);
	});

	it("should capture exit code 1 as failure", async () => {
		const ac = new Autocycle(makeOptions({ evalCommand: "exit 1" }));
		const result = await ac.runCycleEvaluation();
		expect(result.success).toBe(false);
		expect(result.status).toBe("crash");
	});

	it("should capture multiline stdout", async () => {
		const ac = new Autocycle(makeOptions({ evalCommand: 'echo "line1" && echo "line2"' }));
		const result = await ac.runCycleEvaluation();
		expect(result.success).toBe(true);
		expect(result.stdout).toContain("line1");
		expect(result.stdout).toContain("line2");
	});

	// ── Metric extraction ──

	it("should extract a real metric from subprocess stdout", async () => {
		const ac = new Autocycle(
			makeOptions({
				evalCommand: 'echo "accuracy: 0.95"',
				metricRegex: /accuracy:\s+([\d.]+)/,
			}),
		);
		const result = await ac.runCycleEvaluation();

		expect(result.success).toBe(true);
		expect(result.status).toBe("keep");
		expect(result.metric).toBe(0.95);
	});

	it("should extract a metric from TSV-style subprocess output", async () => {
		const ac = new Autocycle(
			makeOptions({
				evalCommand: 'printf "commit\tval_bpb\tmemory_gb\nabc123\t0.901234\t4.2\n"',
				metricColumn: "val_bpb",
			}),
		);
		const result = await ac.runCycleEvaluation();

		expect(result.success).toBe(true);
		expect(result.status).toBe("keep");
		expect(result.metric).toBe(0.901234);
	});

	it("should extract metric from stderr when stdout has no match", async () => {
		const ac = new Autocycle(
			makeOptions({
				evalCommand: 'echo "no metric here" && echo "loss: 0.42" >&2',
				metricRegex: /loss:\s+([\d.]+)/,
			}),
		);
		const result = await ac.runCycleEvaluation();

		expect(result.success).toBe(true);
		expect(result.status).toBe("keep");
		expect(result.metric).toBe(0.42);
	});

	it("should return null metric when regex has no match", async () => {
		const ac = new Autocycle(
			makeOptions({
				evalCommand: 'echo "no metrics at all"',
				metricRegex: /score:\s+([\d.]+)/,
			}),
		);
		const result = await ac.runCycleEvaluation();

		// Metric regex specified but no match → failure
		expect(result.success).toBe(false);
		expect(result.status).toBe("metric-missing");
		expect(result.metric).toBeNull();
	});

	// ── Timeout & abort ──

	it("should timeout and kill a long-running real subprocess", async () => {
		const ac = new Autocycle(
			makeOptions({
				evalCommand: "sleep 30",
				evalBudgetMs: 500,
			}),
		);

		const t0 = Date.now();
		const result = await ac.runCycleEvaluation();
		const elapsed = Date.now() - t0;

		expect(result.success).toBe(false);
		expect(result.status).toBe("timeout");
		expect(elapsed).toBeLessThan(10000);
	});

	it("should abort immediately when signal is pre-aborted", async () => {
		const ac = new Autocycle(makeOptions());
		const controller = new AbortController();
		controller.abort();

		const t0 = Date.now();
		const result = await ac.runCycleEvaluation(controller.signal);
		const elapsed = Date.now() - t0;

		expect(elapsed).toBeLessThan(200);
		expect(result.success).toBe(false);
		expect(result.status).toBe("aborted");
	});

	it("should abort a running subprocess via signal", async () => {
		const ac = new Autocycle(
			makeOptions({
				evalCommand: "sleep 30",
				evalBudgetMs: 60_000,
			}),
		);

		const controller = new AbortController();
		setTimeout(() => controller.abort(), 300);

		const t0 = Date.now();
		const result = await ac.runCycleEvaluation(controller.signal);
		const elapsed = Date.now() - t0;

		expect(elapsed).toBeLessThan(5000);
		expect(result.success).toBe(false);
		expect(result.status).toBe("aborted");
	});

	// ── Backup & revert on disk ──

	it("should backup file on successful eval", async () => {
		const targetPath = path.join(TMP_DIR, TARGET_FILE);
		const ac = new Autocycle(makeOptions({ evalCommand: 'echo "ok"' }));

		// Iteration 1 succeeds → backs up "original content"
		const r1 = await ac.runCycleEvaluation();
		expect(r1.success).toBe(true);
		expect(r1.status).toBe("keep");

		// Mutate the file externally
		await fs.writeFile(targetPath, "mutated by agent", "utf-8");

		// Iteration 2 also succeeds → backs up "mutated by agent"
		const r2 = await ac.runCycleEvaluation();
		expect(r2.success).toBe(true);

		// File should still be "mutated by agent" (no revert on success)
		const content = await fs.readFile(targetPath, "utf-8");
		expect(content).toBe("mutated by agent");
	});

	it("should revert file on eval failure after a previous success", async () => {
		const targetPath = path.join(TMP_DIR, TARGET_FILE);

		// Use metric-based eval: first prints score 10 (baseline), second also 10 (no improvement)
		// optimizeDirection=maximize → same score means "not better" → fail → revert
		const scriptPath = path.join(TMP_DIR, "eval.sh");
		await fs.writeFile(
			scriptPath,
			`#!/bin/sh
iter=$1
if [ "$iter" = "1" ]; then echo "score: 10"; exit 0; fi
echo "score: 5"; exit 0`,
			{ mode: 0o755 },
		);

		// Iteration counter file to route the script
		const counterPath = path.join(TMP_DIR, "counter");
		await fs.writeFile(counterPath, "1", "utf-8");

		const ac = new Autocycle(
			makeOptions({
				evalCommand: `sh "${scriptPath}" $(cat "${counterPath}")`,
				metricRegex: /score:\s+([\d.]+)/,
				optimizeDirection: "maximize",
			}),
		);

		// Iteration 1: score 10, baseline established
		const r1 = await ac.runCycleEvaluation();
		expect(r1.success).toBe(true);
		expect(r1.metric).toBe(10);

		// Simulate agent mutation
		await fs.writeFile(targetPath, "mutated by agent", "utf-8");
		// Update counter so next eval gives score 5 (worse)
		await fs.writeFile(counterPath, "2", "utf-8");

		// Iteration 2: score 5 < 10, digression → revert
		const r2 = await ac.runCycleEvaluation();
		expect(r2.success).toBe(false);
		expect(r2.status).toBe("discard");
		expect(r2.metric).toBe(5);

		// File should be reverted to "original content" (the backup from iter 1)
		const content = await fs.readFile(targetPath, "utf-8");
		expect(content).toBe("original content");
	});

	it("should resume from an existing ledger and revert failed resumed iterations to the current kept file", async () => {
		const targetPath = path.join(TMP_DIR, TARGET_FILE);
		const ledgerPath = path.join(TMP_DIR, "resume.jsonl");
		const counterPath = path.join(TMP_DIR, "counter");
		const scriptPath = path.join(TMP_DIR, "resume-eval.sh");

		await fs.writeFile(counterPath, "1", "utf-8");
		await fs.writeFile(
			scriptPath,
			`#!/bin/sh
iter=$(cat "${counterPath}")
if [ "$iter" = "1" ]; then echo "score: 10"; exit 0; fi
echo "score: 5"; exit 0`,
			{ mode: 0o755 },
		);

		const ac1 = new Autocycle(
			makeOptions({
				ledgerFile: "resume.jsonl",
				evalCommand: `sh "${scriptPath}"`,
				metricRegex: /score:\s+([\d.]+)/,
				optimizeDirection: "maximize",
			}),
		);
		await ac1.initializeRunState();
		const first = await ac1.runCycleEvaluation();
		expect(first.success).toBe(true);

		await fs.writeFile(targetPath, "kept version", "utf-8");

		const ac2 = new Autocycle(
			makeOptions({
				ledgerFile: "resume.jsonl",
				resumeFromLedger: true,
				evalCommand: `sh "${scriptPath}"`,
				metricRegex: /score:\s+([\d.]+)/,
				optimizeDirection: "maximize",
			}),
		);
		const resumedSummary = await ac2.initializeRunState();
		expect(resumedSummary.completedEvaluations).toBe(1);

		await fs.writeFile(targetPath, "bad mutation", "utf-8");
		await fs.writeFile(counterPath, "2", "utf-8");

		const second = await ac2.runCycleEvaluation();
		expect(second.iteration).toBe(2);
		expect(second.success).toBe(false);
		expect(second.status).toBe("discard");

		const content = await fs.readFile(targetPath, "utf-8");
		expect(content).toBe("kept version");

		const ledgerText = await fs.readFile(ledgerPath, "utf-8");
		expect(ledgerText.trim().split("\n")).toHaveLength(2);
	});

	// ── Target file validation ──

	it("should validate target file exists before starting", async () => {
		const ac = new Autocycle(makeOptions({ targetFile: "nonexistent.txt" }));
		await expect(ac.validateTargetFile()).rejects.toThrow();
	});

	it("should validate target file succeeds when file exists", async () => {
		const ac = new Autocycle(makeOptions());
		await expect(ac.validateTargetFile()).resolves.toBeUndefined();
	});

	// ── Constructor validation ──

	it("should reject NaN evalBudgetMs in constructor", () => {
		expect(() => new Autocycle(makeOptions({ evalBudgetMs: Number.NaN }))).toThrow("Invalid evalBudgetMs");
	});

	// ── Multi-iteration metric tracking ──

	it("should track improvement across consecutive evaluations", async () => {
		const scriptPath = path.join(TMP_DIR, "metric.sh");
		const counterPath = path.join(TMP_DIR, "counter");
		await fs.writeFile(counterPath, "1", "utf-8");
		await fs.writeFile(
			scriptPath,
			`#!/bin/sh
iter=$(cat "${counterPath}")
if [ "$iter" = "1" ]; then echo "score: 10"; fi
if [ "$iter" = "2" ]; then echo "score: 20"; fi
exit 0`,
			{ mode: 0o755 },
		);

		const ac = new Autocycle(
			makeOptions({
				evalCommand: `sh "${scriptPath}"`,
				metricRegex: /score:\s+([\d.]+)/,
				optimizeDirection: "maximize",
			}),
		);

		// Iteration 1: baseline 10
		const r1 = await ac.runCycleEvaluation();
		expect(r1.success).toBe(true);
		expect(r1.status).toBe("keep");
		expect(r1.metric).toBe(10);

		// Update counter for next eval
		await fs.writeFile(counterPath, "2", "utf-8");

		// Iteration 2: score 20 > 10 → improvement!
		const r2 = await ac.runCycleEvaluation();
		expect(r2.success).toBe(true);
		expect(r2.status).toBe("keep");
		expect(r2.metric).toBe(20);
	});

	it("should increment iteration counter across calls", async () => {
		const ac = new Autocycle(makeOptions({ evalCommand: 'echo "ok"' }));

		const r1 = await ac.runCycleEvaluation();
		const r2 = await ac.runCycleEvaluation();
		const r3 = await ac.runCycleEvaluation();

		expect(r1.iteration).toBe(1);
		expect(r2.iteration).toBe(2);
		expect(r3.iteration).toBe(3);
	});

	// ── Path containment ──

	it("should reject target file outside working directory", async () => {
		const outsideFile = path.join(OUTSIDE_DIRECT_DIR, "outside.txt");
		await fs.mkdir(OUTSIDE_DIRECT_DIR, { recursive: true });
		await fs.writeFile(outsideFile, "outside content", "utf-8");

		const ac = new Autocycle(makeOptions({ targetFile: path.relative(TMP_DIR, outsideFile) }));
		await expect(ac.validateTargetFile()).rejects.toThrow("outside the working directory");
	});

	// ── Edge cases ──

	it("should handle nonexistent command gracefully", async () => {
		const ac = new Autocycle(makeOptions({ evalCommand: "/nonexistent/binary/path" }));
		const result = await ac.runCycleEvaluation();
		expect(result.success).toBe(false);
		expect(result.status).toBe("crash");
	});

	it("should reject backup of file exceeding size limit", async () => {
		const targetPath = path.join(TMP_DIR, TARGET_FILE);
		const bigData = Buffer.alloc(10 * 1024 * 1024 + 1, 0x78);
		await fs.writeFile(targetPath, bigData);

		const ac = new Autocycle(makeOptions({ evalCommand: 'echo "ok"' }));
		await expect(ac.runCycleEvaluation()).rejects.toThrow("exceeds");
	}, 30_000);

	it("should kill subprocess when output exceeds limit", async () => {
		const ac = new Autocycle(
			makeOptions({
				evalCommand: "yes",
				evalBudgetMs: 60_000,
			}),
		);
		const result = await ac.runCycleEvaluation();
		expect(result.success).toBe(false);
		expect(["aborted", "crash"]).toContain(result.status);
	}, 30_000);

	it("writes per-run JSONL ledger entries to disk", async () => {
		const ac = new Autocycle(makeOptions({ evalCommand: 'echo "score: 3"', metricRegex: /score:\s+([\d.]+)/ }));
		await ac.runCycleEvaluation();

		const ledgerText = await fs.readFile(ac.getLedgerFilePath(), "utf-8");
		const [line] = ledgerText.trim().split("\n");
		const entry = JSON.parse(line);

		expect(entry.status).toBe("keep");
		expect(entry.metric).toBe(3);
		expect(entry.iteration).toBe(1);
		expect(entry.targetFile).toBe(TARGET_FILE);
	});
});
