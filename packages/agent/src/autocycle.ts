import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createLogger } from "@takumi/core";
import { extractAutocycleMetric } from "./autocycle-metric.js";

const log = createLogger("autocycle");
const AUTOCYCLE_LEDGER_DIR = path.join(".takumi", "autocycle");

/** Sentinel exit codes for non-subprocess failures. */
const EXIT_SPAWN_ERROR = -1;

/** Maximum accumulated stdout/stderr size before killing subprocess (10 MB). */
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/** Maximum target file size allowed for in-memory backup (10 MB). */
const MAX_BACKUP_FILE_BYTES = 10 * 1024 * 1024;

/** Default eval budget (5 minutes). */
export const DEFAULT_EVAL_BUDGET_MS = 5 * 60 * 1000;

export const DEFAULT_MAX_ITERATIONS = 7;

/** Grace period after SIGTERM before SIGKILL (ms). */
const SIGKILL_GRACE_MS = 3000;

/** Configuration for an autonomous research/coding cycle. */
export interface AutocycleOptions {
	/** Path to the target file that the agent will iteratively modify. */
	targetFile: string;
	/** The terminal command to run to evaluate the change (e.g., "pnpm test" or "python train.py"). */
	evalCommand: string;
	/** Maximum time allowed for the evaluation command to run before it is killed (ms). */
	evalBudgetMs: number;
	/** Regular expression to extract the quantitative metric from stdout/stderr. */
	metricRegex?: RegExp;
	/** Optional TSV column name to extract from stdout/stderr before regex fallback. */
	metricColumn?: string;
	/** Should the metric be minimized or maximized? Default: minimize. */
	optimizeDirection?: "minimize" | "maximize";
	/** Working directory for the eval command. */
	cwd?: string;
	/** Optional path for the per-run JSONL ledger file. Defaults under .takumi/autocycle in cwd. */
	ledgerFile?: string;
	/** Resume metrics, iteration count, and run identity from an existing ledger file when present. */
	resumeFromLedger?: boolean;
}

export type CycleOutcome = "keep" | "discard" | "timeout" | "crash" | "metric-missing" | "aborted";

export interface CycleResult {
	iteration: number;
	success: boolean;
	status: CycleOutcome;
	metric: number | null;
	stdout: string;
	durationMs: number;
}

export interface CycleLedgerEntry {
	runId: string;
	iteration: number;
	status: CycleOutcome;
	success: boolean;
	metric: number | null;
	bestMetric: number | null;
	durationMs: number;
	evalCommand: string;
	targetFile: string;
	optimizeDirection: "minimize" | "maximize";
	timestamp: string;
}

export interface AutocycleRunSummary {
	runId: string;
	ledgerFilePath: string;
	completedEvaluations: number;
	counts: Record<CycleOutcome, number>;
	keepRate: number;
	totalDurationMs: number;
	averageDurationMs: number;
	baselineMetric: number | null;
	bestMetric: number | null;
	latestMetric: number | null;
	optimizeDirection: "minimize" | "maximize";
}

interface ParsedLedgerState {
	runId: string;
	entries: CycleLedgerEntry[];
	currentIteration: number;
	baselineMetric: number | null;
	bestMetric: number | null;
}

/**
 * Autocycle: An autonomous research execution loop inspired by karpathy/autoresearch.
 * It pipelines sub-agents to mutate a file, evaluates the mutation with a fixed wall-clock budget,
 * routes the outcome to Chitragupta for memory storage/pattern detection, and loops.
 */
export class Autocycle {
	private readonly options: AutocycleOptions;
	private runId: string;
	private readonly ledgerFilePath: string;
	private readonly ledgerEntries: CycleLedgerEntry[] = [];
	private currentIteration = 0;
	/** Initially null; first iteration establishes the baseline metric. */
	private bestMetric: number | null = null;
	private baselineMetric: number | null = null;
	private lastValidBackup: string | null = null;

	constructor(options: AutocycleOptions) {
		if (!options.targetFile.trim()) {
			throw new Error("Invalid targetFile: must be a non-empty path.");
		}
		if (!options.evalCommand.trim()) {
			throw new Error("Invalid evalCommand: must be a non-empty command.");
		}
		if (!Number.isFinite(options.evalBudgetMs) || options.evalBudgetMs <= 0) {
			throw new Error(`Invalid evalBudgetMs: ${options.evalBudgetMs}. Must be a positive finite number.`);
		}
		if (
			options.optimizeDirection &&
			options.optimizeDirection !== "minimize" &&
			options.optimizeDirection !== "maximize"
		) {
			throw new Error(`Invalid optimizeDirection: ${options.optimizeDirection}. Must be "minimize" or "maximize".`);
		}
		this.options = {
			optimizeDirection: "minimize",
			cwd: process.cwd(),
			...options,
			evalBudgetMs: Math.max(1, Math.floor(options.evalBudgetMs)),
		};
		this.runId = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
		this.ledgerFilePath = this.resolveLedgerFilePath();
	}

	getLedgerFilePath(): string {
		return this.ledgerFilePath;
	}

	async initializeRunState(): Promise<AutocycleRunSummary> {
		await this.validateTargetFile();
		if (this.options.resumeFromLedger) {
			await this.restoreStateFromLedger();
		}
		await this.backupTargetFile();
		return this.getRunSummary();
	}

	getRunSummary(): AutocycleRunSummary {
		const counts: Record<CycleOutcome, number> = {
			keep: 0,
			discard: 0,
			timeout: 0,
			crash: 0,
			"metric-missing": 0,
			aborted: 0,
		};
		let totalDurationMs = 0;
		for (const entry of this.ledgerEntries) {
			counts[entry.status]++;
			totalDurationMs += entry.durationMs;
		}

		const completedEvaluations = this.ledgerEntries.length;
		const latestMetric =
			this.ledgerEntries.length > 0 ? (this.ledgerEntries[this.ledgerEntries.length - 1]?.metric ?? null) : null;

		return {
			runId: this.runId,
			ledgerFilePath: this.ledgerFilePath,
			completedEvaluations,
			counts,
			keepRate: completedEvaluations === 0 ? 0 : counts.keep / completedEvaluations,
			totalDurationMs,
			averageDurationMs: completedEvaluations === 0 ? 0 : Math.round(totalDurationMs / completedEvaluations),
			baselineMetric: this.baselineMetric,
			bestMetric: this.bestMetric,
			latestMetric,
			optimizeDirection: this.options.optimizeDirection ?? "minimize",
		};
	}

	private resolveLedgerFilePath(): string {
		const cwd = path.resolve(this.options.cwd ?? process.cwd());
		if (this.options.ledgerFile?.trim()) {
			return path.resolve(cwd, this.options.ledgerFile);
		}

		const safeTargetStem =
			this.options.targetFile
				.replaceAll(/[\\/]+/g, "-")
				.replaceAll(/[^a-zA-Z0-9._-]/g, "-")
				.replace(/-+/g, "-")
				.replace(/^-|-$/g, "") || "target";

		return path.join(cwd, AUTOCYCLE_LEDGER_DIR, `${safeTargetStem}-${this.runId}.jsonl`);
	}

	private async appendLedgerEntry(entry: CycleLedgerEntry): Promise<void> {
		this.ledgerEntries.push(entry);
		await fs.mkdir(path.dirname(this.ledgerFilePath), { recursive: true });
		await fs.appendFile(this.ledgerFilePath, `${JSON.stringify(entry)}\n`, "utf-8");
	}

	private async restoreStateFromLedger(): Promise<void> {
		const state = await this.readLedgerState();
		if (!state) {
			return;
		}

		this.runId = state.runId;
		this.currentIteration = state.currentIteration;
		this.baselineMetric = state.baselineMetric;
		this.bestMetric = state.bestMetric;
		this.ledgerEntries.splice(0, this.ledgerEntries.length, ...state.entries);
	}

	private async readLedgerState(): Promise<ParsedLedgerState | null> {
		let ledgerText: string;
		try {
			ledgerText = await fs.readFile(this.ledgerFilePath, "utf-8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return null;
			}
			throw error;
		}

		const lines = ledgerText
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		if (lines.length === 0) {
			return null;
		}

		const entries = lines.map((line, index) => this.parseLedgerEntry(line, index + 1));
		this.validateLedgerEntries(entries);

		const runId = entries[0]!.runId;
		const currentIteration = entries.reduce((max, entry) => Math.max(max, entry.iteration), 0);
		const baselineMetric = entries.find((entry) => entry.success && entry.metric !== null)?.metric ?? null;
		const bestMetric = entries[entries.length - 1]?.bestMetric ?? null;

		return {
			runId,
			entries,
			currentIteration,
			baselineMetric,
			bestMetric,
		};
	}

	private parseLedgerEntry(line: string, lineNumber: number): CycleLedgerEntry {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			throw new Error(`Invalid Autocycle ledger JSON at line ${lineNumber}.`);
		}
		if (!isCycleLedgerEntry(parsed)) {
			throw new Error(`Invalid Autocycle ledger entry at line ${lineNumber}.`);
		}
		return parsed;
	}

	private validateLedgerEntries(entries: CycleLedgerEntry[]): void {
		const expectedDirection = this.options.optimizeDirection ?? "minimize";
		for (const entry of entries) {
			if (entry.targetFile !== this.options.targetFile) {
				throw new Error(
					`Autocycle ledger target mismatch: expected ${this.options.targetFile}, got ${entry.targetFile}.`,
				);
			}
			if (entry.evalCommand !== this.options.evalCommand) {
				throw new Error("Autocycle ledger eval command mismatch.");
			}
			if (entry.optimizeDirection !== expectedDirection) {
				throw new Error("Autocycle ledger optimize direction mismatch.");
			}
		}
		const runIds = new Set(entries.map((entry) => entry.runId));
		if (runIds.size !== 1) {
			throw new Error("Autocycle ledger contains multiple run IDs and cannot be resumed safely.");
		}
	}

	/**
	 * Run the evaluation subprocess with a strict time budget.
	 * Accepts an optional AbortSignal to kill the subprocess early on cancellation.
	 */
	private async evaluateCommand(
		signal?: AbortSignal,
	): Promise<{ stdout: string; stderr: string; timedOut: boolean; code: number | null }> {
		return new Promise((resolve) => {
			if (signal?.aborted) {
				resolve({ stdout: "", stderr: "Aborted before eval start", timedOut: false, code: null });
				return;
			}

			log.info(`[Eval] Running command: ${this.options.evalCommand}`);

			// shell: true is intentional — evalCommand comes from local user config
			// (slash-command arguments), NOT from untrusted external input.
			// Complex commands like "npm test -- --coverage" require shell interpretation.
			const child = spawn(this.options.evalCommand, {
				cwd: this.options.cwd,
				shell: true,
			});

			let stdout = "";
			let stderr = "";
			let isDone = false;
			let timedOut = false;

			const finish = (result: { stdout: string; stderr: string; timedOut: boolean; code: number | null }) => {
				if (!isDone) {
					isDone = true;
					clearTimeout(timeout);
					signal?.removeEventListener("abort", onAbort);
					resolve(result);
				}
			};

			const onAbort = () => {
				log.warn("[Eval] Aborted via signal. Killing subprocess.");
				child.kill("SIGKILL");
				finish({ stdout, stderr, timedOut: false, code: null });
			};

			if (signal) signal.addEventListener("abort", onAbort, { once: true });

			child.stdout.on("data", (data) => {
				stdout += data.toString();
				if (stdout.length + stderr.length > MAX_OUTPUT_BYTES) {
					log.warn(`[Eval] Output exceeded ${MAX_OUTPUT_BYTES} bytes. Killing subprocess.`);
					child.kill("SIGKILL");
				}
			});

			child.stderr.on("data", (data) => {
				stderr += data.toString();
				if (stdout.length + stderr.length > MAX_OUTPUT_BYTES) {
					log.warn(`[Eval] Output exceeded ${MAX_OUTPUT_BYTES} bytes. Killing subprocess.`);
					child.kill("SIGKILL");
				}
			});

			// Enforce strict time budget — SIGTERM first, then SIGKILL after grace period.
			// Promise resolves only when the subprocess actually exits (not at SIGTERM send time).
			const timeout = setTimeout(() => {
				timedOut = true;
				log.warn(`[Eval] Budget exceeded (${this.options.evalBudgetMs}ms). Sending SIGTERM.`);
				child.kill("SIGTERM");
				setTimeout(() => {
					if (!isDone) {
						log.warn("[Eval] Grace period expired — sending SIGKILL.");
						child.kill("SIGKILL");
					}
				}, SIGKILL_GRACE_MS);
			}, this.options.evalBudgetMs);

			child.on("close", (code) => {
				finish({ stdout, stderr, timedOut, code: timedOut ? null : code });
			});

			child.on("error", (err) => {
				stderr += `Spawn error: ${err.message}`;
				finish({ stdout, stderr, timedOut: false, code: EXIT_SPAWN_ERROR });
			});
		});
	}

	private async getValidatedTargetPath(checkAccess = false): Promise<string> {
		const cwd = path.resolve(this.options.cwd ?? process.cwd());
		const fullPath = path.resolve(cwd, this.options.targetFile);

		if (checkAccess) {
			await fs.access(fullPath, fsConstants.R_OK | fsConstants.W_OK);
		}

		const realCwd = await fs.realpath(cwd);
		const realTargetPath = await fs.realpath(fullPath);
		const relativePath = path.relative(realCwd, realTargetPath);
		if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
			throw new Error(`Target file "${this.options.targetFile}" resolves outside the working directory.`);
		}

		return fullPath;
	}

	/**
	 * Validate that the target file exists and is readable before starting.
	 * Throws if the file is missing.
	 */
	async validateTargetFile(): Promise<void> {
		await this.getValidatedTargetPath(true);
	}

	/**
	 * Takes a backup of the target file to allow graceful reversion if the experiment fails.
	 * Throws if the file exceeds MAX_BACKUP_FILE_BYTES to prevent OOM.
	 */
	private async backupTargetFile(): Promise<void> {
		const fullPath = await this.getValidatedTargetPath(true);
		const stat = await fs.stat(fullPath);
		if (stat.size > MAX_BACKUP_FILE_BYTES) {
			throw new Error(
				`Target file is ${stat.size} bytes — exceeds ${MAX_BACKUP_FILE_BYTES} byte limit for in-memory backup.`,
			);
		}
		this.lastValidBackup = await fs.readFile(fullPath, "utf-8");
	}

	/**
	 * Reverts the target file to the last valid backup state.
	 * Throws if the write fails so the loop can halt cleanly.
	 * No-ops if no backup exists yet (first iteration, file is still original).
	 */
	private async revertTargetFile(): Promise<void> {
		if (this.lastValidBackup === null) return;
		const fullPath = await this.getValidatedTargetPath();
		await fs.writeFile(fullPath, this.lastValidBackup, "utf-8");
		log.info(`[Eval] Changes reverted for ${this.options.targetFile}`);
	}

	/**
	 * Execute one cycle of the Autocycle.
	 * Includes evaluation and metric extraction.
	 * Note: The actual code-mutating sub-agent execution should be wired before this method is called,
	 * or injected via a callback. For now, this validates the post-mutation state.
	 */
	async runCycleEvaluation(signal?: AbortSignal): Promise<CycleResult> {
		// Don't consume an iteration for pre-aborted signals
		if (signal?.aborted) {
			return {
				iteration: this.currentIteration,
				success: false,
				status: "aborted",
				metric: null,
				stdout: "",
				durationMs: 0,
			};
		}
		this.currentIteration++;
		const iteration = this.currentIteration;
		log.info(`--- Autocycle Iteration ${iteration} ---`);

		const t0 = performance.now();
		const evalResult = await this.evaluateCommand(signal);
		const durationMs = Math.round(performance.now() - t0);

		const metric = extractAutocycleMetric({
			stdout: evalResult.stdout,
			stderr: evalResult.stderr,
			metricColumn: this.options.metricColumn,
			metricRegex: this.options.metricRegex,
		});

		let success = false;
		let status: CycleOutcome = "discard";

		if (evalResult.timedOut) {
			status = "timeout";
			log.warn(`[Eval] Iteration ${iteration} failed: Time budget exceeded.`);
		} else if (signal?.aborted || evalResult.code === null) {
			status = "aborted";
			log.warn(`[Eval] Iteration ${iteration} aborted.`);
		} else if (evalResult.code !== 0) {
			status = "crash";
			log.warn(`[Eval] Iteration ${iteration} failed: Process exited with code ${evalResult.code}.`);
		} else if (this.options.metricRegex) {
			if (metric === null) {
				status = "metric-missing";
				log.warn(`[Eval] Iteration ${iteration} failed: Could not extract metric.`);
			} else {
				if (this.bestMetric === null) {
					success = true;
					status = "keep";
					this.baselineMetric = metric;
					this.bestMetric = metric;
					log.info(`[Eval] Baseline metric established: ${metric}`);
				} else {
					const isBetter =
						this.options.optimizeDirection === "minimize" ? metric < this.bestMetric : metric > this.bestMetric;

					if (isBetter) {
						success = true;
						status = "keep";
						log.info(`[Eval] Improvement found! ${this.bestMetric} -> ${metric}`);
						this.bestMetric = metric;
					} else {
						status = "discard";
						log.info(`[Eval] Digression. ${metric} is worse than ${this.bestMetric}`);
					}
				}
			}
		} else {
			success = true;
			status = "keep";
			log.info(`[Eval] Iteration ${iteration} succeeded (no metric, exit 0).`);
		}

		if (!success) {
			await this.revertTargetFile();
		} else {
			await this.backupTargetFile(); // The new baseline
		}

		await this.appendLedgerEntry({
			runId: this.runId,
			iteration,
			status,
			success,
			metric,
			bestMetric: this.bestMetric,
			durationMs,
			evalCommand: this.options.evalCommand,
			targetFile: this.options.targetFile,
			optimizeDirection: this.options.optimizeDirection ?? "minimize",
			timestamp: new Date().toISOString(),
		});

		return {
			iteration,
			success,
			status,
			metric,
			stdout: evalResult.stdout,
			durationMs,
		};
	}
}

function isCycleOutcome(value: unknown): value is CycleOutcome {
	return (
		value === "keep" ||
		value === "discard" ||
		value === "timeout" ||
		value === "crash" ||
		value === "metric-missing" ||
		value === "aborted"
	);
}

function isCycleLedgerEntry(value: unknown): value is CycleLedgerEntry {
	if (!value || typeof value !== "object") {
		return false;
	}
	const entry = value as Record<string, unknown>;
	return (
		typeof entry.runId === "string" &&
		typeof entry.iteration === "number" &&
		isCycleOutcome(entry.status) &&
		typeof entry.success === "boolean" &&
		(entry.metric === null || typeof entry.metric === "number") &&
		(entry.bestMetric === null || typeof entry.bestMetric === "number") &&
		typeof entry.durationMs === "number" &&
		typeof entry.evalCommand === "string" &&
		typeof entry.targetFile === "string" &&
		(entry.optimizeDirection === "minimize" || entry.optimizeDirection === "maximize") &&
		typeof entry.timestamp === "string"
	);
}
