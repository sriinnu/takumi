import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRunner } from "../src/agent/agent-runner.js";
import type { AppCommandContext } from "../src/commands/app-command-context.js";
import { parseBasicArgs, registerAutocycleCommands } from "../src/commands/app-commands-autocycle.js";
import { AppState } from "../src/state.js";

/* ── Module-level mocks ─────────────────────────────────────────────────────── */

const {
	defaultRunSummary,
	mockInitializeRunState,
	mockRunCycleEvaluation,
	mockGetRunSummary,
	mockAutocycleConstructor,
	mockReportAutocycleIterationToChitragupta,
} = vi.hoisted(() => {
	const runSummary = {
		runId: "run-1",
		ledgerFilePath: ".takumi/autocycle/mock-ledger.jsonl",
		completedEvaluations: 1,
		counts: {
			keep: 1,
			discard: 0,
			timeout: 0,
			crash: 0,
			"metric-missing": 0,
			aborted: 0,
		},
		keepRate: 1,
		totalDurationMs: 5,
		averageDurationMs: 5,
		baselineMetric: null as number | null,
		bestMetric: null as number | null,
		latestMetric: null as number | null,
		optimizeDirection: "minimize" as const,
	};
	return {
		defaultRunSummary: runSummary,
		mockInitializeRunState: vi.fn(async () => ({ ...runSummary })),
		mockRunCycleEvaluation: vi.fn(async (_signal?: AbortSignal) => ({
			iteration: 1,
			success: true,
			status: "keep" as const,
			metric: null as number | null,
			stdout: "ok",
			durationMs: 5,
		})),
		mockGetRunSummary: vi.fn(() => ({ ...runSummary })),
		mockAutocycleConstructor: vi.fn(),
		mockReportAutocycleIterationToChitragupta: vi.fn(async () => {}),
	};
});

vi.mock("@takumi/agent", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		Autocycle: class {
			constructor(options: unknown) {
				mockAutocycleConstructor(options);
			}
			getLedgerFilePath = () => ".takumi/autocycle/mock-ledger.jsonl";
			getRunSummary = mockGetRunSummary;
			initializeRunState = mockInitializeRunState;
			runCycleEvaluation = mockRunCycleEvaluation;
		},
	};
});

// Mock batch() from @takumi/render — just execute fn synchronously
vi.mock("@takumi/render", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return { ...actual, batch: (fn: () => void) => fn() };
});

vi.mock("../src/autocycle/autocycle-chitragupta.js", () => ({
	reportAutocycleIterationToChitragupta: mockReportAutocycleIterationToChitragupta,
}));

// Content-aware crypto mock: produces deterministic hashes based on input data
vi.mock("node:crypto", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		createHash: () => ({
			update: (data: any) => ({
				digest: () => {
					const str = typeof data === "string" ? data : Buffer.from(data).toString("hex");
					return `sha256-${str.slice(0, 64)}`;
				},
			}),
		}),
	};
});

// Mock readFile to return incrementing content — simulates the agent modifying the file between hashes
let fsReadCallCount = 0;
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		default: {
			...(actual.default as object),
			readFile: vi.fn(async () => {
				fsReadCallCount++;
				return Buffer.from(`content-v${fsReadCallCount}`);
			}),
		},
	};
});

// Import after mocks so AutocycleAgent uses the mocked modules
const { AutocycleAgent } = await import("../src/autocycle/autocycle-agent.js");

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function mockRunner(overrides: Partial<AgentRunner> = {}): AgentRunner {
	return {
		submit: vi.fn(async () => {}),
		cancel: vi.fn(),
		clearHistory: vi.fn(),
		isRunning: false,
		permissions: { check: vi.fn(), getRules: vi.fn(() => []), reset: vi.fn() } as any,
		checkToolPermission: vi.fn(async () => true),
		...overrides,
	} as unknown as AgentRunner;
}

function makeMockCtx(overrides: Partial<AppCommandContext> = {}): AppCommandContext {
	const runner = mockRunner();
	let activeAutocycle: InstanceType<typeof AutocycleAgent> | null = null;
	return {
		commands: { register: vi.fn() } as any,
		state: new AppState(),
		agentRunner: runner,
		config: {} as any,
		autoPr: false,
		autoShip: false,
		addInfoMessage: vi.fn(),
		buildSessionData: vi.fn() as any,
		startAutoSaver: vi.fn(),
		quit: vi.fn().mockResolvedValue(undefined),
		getActiveCoder: () => null,
		setActiveCoder: vi.fn(),
		getActiveAutocycle: () => activeAutocycle,
		setActiveAutocycle: (agent: any) => {
			activeAutocycle = agent;
		},
		...overrides,
	} as any;
}

/* ── parseBasicArgs ─────────────────────────────────────────────────────────── */

describe("parseBasicArgs", () => {
	it("parses double-quoted values", () => {
		const { parsed, objective } = parseBasicArgs('optimize --target "src/foo.ts" --command "npm test"');
		expect(parsed.target).toBe("src/foo.ts");
		expect(parsed.command).toBe("npm test");
		expect(objective).toBe("optimize");
	});

	it("parses single-quoted values", () => {
		const { parsed } = parseBasicArgs("go --target 'file.ts' --command 'pnpm test'");
		expect(parsed.target).toBe("file.ts");
		expect(parsed.command).toBe("pnpm test");
	});

	it("parses unquoted single-word values", () => {
		const { parsed } = parseBasicArgs("go --target file.ts --maximize true");
		expect(parsed.target).toBe("file.ts");
		expect(parsed.maximize).toBe("true");
	});

	it("parses multi-word unquoted values until next flag", () => {
		const { parsed } = parseBasicArgs("go --command npm run test --target file.ts");
		expect(parsed.command).toBe("npm run test");
		expect(parsed.target).toBe("file.ts");
	});

	it("parses --key=value syntax", () => {
		const { parsed } = parseBasicArgs("go --target=foo.ts --iterations=10");
		expect(parsed.target).toBe("foo.ts");
		expect(parsed.iterations).toBe("10");
	});

	it("parses camelCase flags used by autocycle research options", () => {
		const { parsed } = parseBasicArgs("go --metricColumn val_bpb --manifest notes.md");
		expect(parsed.metricColumn).toBe("val_bpb");
		expect(parsed.manifest).toBe("notes.md");
	});

	it("parses resume ledger flag", () => {
		const { parsed } = parseBasicArgs("go --resume .takumi/autocycle/run.jsonl");
		expect(parsed.resume).toBe(".takumi/autocycle/run.jsonl");
	});

	it("handles hyphenated file names", () => {
		const { parsed } = parseBasicArgs("go --target my-file.ts --command echo");
		expect(parsed.target).toBe("my-file.ts");
	});

	it("extracts the objective after stripping flags", () => {
		const { objective } = parseBasicArgs('improve perf --target foo.ts --command "npm test"');
		expect(objective).toBe("improve perf");
	});

	it("returns empty objective when only flags", () => {
		const { objective } = parseBasicArgs('--target foo.ts --command "npm test"');
		expect(objective).toBe("");
	});

	it("returns empty parsed and full objective when no flags", () => {
		const { parsed, objective } = parseBasicArgs("just an objective");
		expect(Object.keys(parsed)).toHaveLength(0);
		expect(objective).toBe("just an objective");
	});

	it("handles empty string input", () => {
		const { parsed, objective } = parseBasicArgs("");
		expect(Object.keys(parsed)).toHaveLength(0);
		expect(objective).toBe("");
	});

	it("handles flag at end of input without a value", () => {
		const { parsed } = parseBasicArgs("objective --target");
		// --target at end without a value should not be parsed
		expect(parsed.target).toBeUndefined();
	});
});

/* ── AutocycleAgent ─────────────────────────────────────────────────────────── */

describe("AutocycleAgent", () => {
	beforeEach(async () => {
		mockInitializeRunState.mockClear();
		mockRunCycleEvaluation.mockClear();
		mockGetRunSummary.mockClear();
		mockAutocycleConstructor.mockClear();
		mockReportAutocycleIterationToChitragupta.mockClear();
		mockInitializeRunState.mockResolvedValue({
			...defaultRunSummary,
			completedEvaluations: 0,
			counts: { ...defaultRunSummary.counts, keep: 0 },
			keepRate: 0,
			totalDurationMs: 0,
			averageDurationMs: 0,
		});
		mockGetRunSummary.mockImplementation(() => ({ ...defaultRunSummary, completedEvaluations: 1 }));
		fsReadCallCount = 0;
		// Restore default readFile: incrementing content for mutation detection
		const fsModule = await import("node:fs/promises");
		(fsModule.default.readFile as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			fsReadCallCount++;
			return Buffer.from(`content-v${fsReadCallCount}`);
		});
		mockRunCycleEvaluation.mockResolvedValue({
			iteration: 1,
			success: true,
			status: "keep",
			metric: null,
			stdout: "ok",
			durationMs: 5,
		});
	});

	it("throws if agentRunner is null", () => {
		const ctx = makeMockCtx({ agentRunner: null });
		expect(() => new AutocycleAgent(ctx, { targetFile: "x", evalCommand: "y", evalBudgetMs: 1000 })).toThrow(
			"AgentRunner is not initialized",
		);
	});

	it("initializes with valid options", () => {
		const ctx = makeMockCtx();
		const agent = new AutocycleAgent(ctx, { targetFile: "x", evalCommand: "y", evalBudgetMs: 1000 });
		expect(agent).toBeDefined();
		expect(agent.isActive).toBe(false);
	});

	it("isActive returns false when idle", () => {
		const ctx = makeMockCtx();
		const agent = new AutocycleAgent(ctx, { targetFile: "x", evalCommand: "echo ok", evalBudgetMs: 500 });
		expect(agent.isActive).toBe(false);
	});

	it("cancel() is a no-op when not active and does not call runner.cancel", () => {
		const ctx = makeMockCtx();
		const agent = new AutocycleAgent(ctx, { targetFile: "x", evalCommand: "y", evalBudgetMs: 1000 });
		agent.cancel();
		expect(agent.isActive).toBe(false);
		// runner.cancel should NOT be called because abortController was null (never started)
		expect(ctx.agentRunner!.cancel).not.toHaveBeenCalled();
	});

	it("start() initializes run state before loop", async () => {
		const ctx = makeMockCtx();
		const agent = new AutocycleAgent(ctx, {
			targetFile: "x",
			evalCommand: "echo ok",
			evalBudgetMs: 500,
			maxIterations: 1,
		});

		await agent.start("test");

		expect(mockInitializeRunState).toHaveBeenCalledOnce();
	});

	it("start() sets state signals and resets on completion", async () => {
		const ctx = makeMockCtx();
		mockRunCycleEvaluation.mockResolvedValue({
			iteration: 1,
			success: true,
			status: "keep",
			metric: 0.95,
			stdout: "ok",
			durationMs: 10,
		});

		const agent = new AutocycleAgent(ctx, {
			targetFile: "x",
			evalCommand: "echo ok",
			evalBudgetMs: 500,
			maxIterations: 2,
		});

		await agent.start("test objective");

		// Should have reset signals after completion
		expect(ctx.state.autocyclePhase.value).toBe("idle");
		expect(ctx.state.autocycleIteration.value).toBe(0);
		// Metric should have been set during run
		expect(ctx.state.autocycleMetric.value).toBe(0.95);
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("Starting Autocycle"));
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("Autocycle manifest:"));
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("Autocycle summary:"));
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("complete after"));
		expect(mockReportAutocycleIterationToChitragupta).toHaveBeenCalled();
	});

	it("reports each completed evaluation to Chitragupta hook with manifest and summary", async () => {
		const ctx = makeMockCtx();
		mockRunCycleEvaluation.mockResolvedValue({
			iteration: 1,
			success: true,
			status: "keep",
			metric: 0.91,
			stdout: "ok",
			durationMs: 11,
		});

		const agent = new AutocycleAgent(ctx, {
			targetFile: "x",
			evalCommand: "echo ok",
			evalBudgetMs: 500,
			maxIterations: 1,
		});

		await agent.start("improve quality");

		expect(mockReportAutocycleIterationToChitragupta).toHaveBeenCalledWith(
			expect.objectContaining({
				objective: "improve quality",
				targetFile: "x",
				evalCommand: "echo ok",
				manifestFilePath: expect.stringContaining(".experiment.md"),
				result: expect.objectContaining({ iteration: 1, metric: 0.91, status: "keep" }),
				summary: expect.objectContaining({ completedEvaluations: 1, counts: expect.objectContaining({ keep: 1 }) }),
			}),
		);
	});

	it("resumes from an existing ledger and only runs remaining iterations", async () => {
		const ctx = makeMockCtx();
		mockInitializeRunState.mockResolvedValueOnce({
			...defaultRunSummary,
			completedEvaluations: 2,
			counts: { ...defaultRunSummary.counts, keep: 2 },
			keepRate: 1,
			totalDurationMs: 20,
			averageDurationMs: 10,
			baselineMetric: 1.2,
			bestMetric: 0.9,
			latestMetric: 0.9,
		});
		mockGetRunSummary.mockImplementation(() => ({
			...defaultRunSummary,
			completedEvaluations: 3,
			counts: { ...defaultRunSummary.counts, keep: 3 },
			keepRate: 1,
			totalDurationMs: 30,
			averageDurationMs: 10,
			baselineMetric: 1.2,
			bestMetric: 0.8,
			latestMetric: 0.8,
		}));
		mockRunCycleEvaluation.mockResolvedValueOnce({
			iteration: 3,
			success: true,
			status: "keep",
			metric: 0.8,
			stdout: "ok",
			durationMs: 10,
		});

		const agent = new AutocycleAgent(ctx, {
			targetFile: "x",
			evalCommand: "echo ok",
			evalBudgetMs: 500,
			maxIterations: 3,
			resumeLedgerFile: ".takumi/autocycle/run.jsonl",
		});

		await agent.start("resume me");

		expect(ctx.agentRunner!.submit).toHaveBeenCalledTimes(1);
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("Resuming Autocycle"));
		expect(mockAutocycleConstructor).toHaveBeenCalledWith(
			expect.objectContaining({
				ledgerFile: ".takumi/autocycle/run.jsonl",
				resumeFromLedger: true,
			}),
		);
	});

	it("start() prints a run summary even when iterations are skipped", async () => {
		const ctx = makeMockCtx();
		const fsModule = await import("node:fs/promises");
		(fsModule.default.readFile as ReturnType<typeof vi.fn>).mockImplementation(async () =>
			Buffer.from("unchanged-content"),
		);

		const agent = new AutocycleAgent(ctx, {
			targetFile: "x",
			evalCommand: "echo ok",
			evalBudgetMs: 500,
			maxIterations: 1,
		});

		await agent.start("test");

		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("Autocycle summary:"));
	});

	it("start() clears runner history between iterations", async () => {
		const ctx = makeMockCtx();
		const agent = new AutocycleAgent(ctx, {
			targetFile: "x",
			evalCommand: "echo ok",
			evalBudgetMs: 500,
			maxIterations: 3,
		});

		await agent.start("test");

		// clearHistory called for iterations 2 and 3 (i > 0)
		expect(ctx.agentRunner!.clearHistory).toHaveBeenCalledTimes(2);
	});

	it("start() handles generation failure gracefully and continues", async () => {
		const ctx = makeMockCtx();
		let callCount = 0;

		(ctx.agentRunner as any).submit = vi.fn(async () => {
			callCount++;
			if (callCount === 1) throw new Error("LLM timeout");
		});

		const agent = new AutocycleAgent(ctx, {
			targetFile: "x",
			evalCommand: "echo ok",
			evalBudgetMs: 500,
			maxIterations: 2,
		});

		await agent.start("test");

		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("generation failed"));
		expect(ctx.state.autocyclePhase.value).toBe("idle");
	});

	it("start() passes AbortSignal to runCycleEvaluation", async () => {
		const ctx = makeMockCtx();
		let receivedSignal: AbortSignal | undefined;

		mockRunCycleEvaluation.mockImplementation(async (signal?: AbortSignal) => {
			receivedSignal = signal;
			return { iteration: 1, success: true, status: "keep", metric: null, stdout: "ok", durationMs: 5 };
		});

		const agent = new AutocycleAgent(ctx, {
			targetFile: "x",
			evalCommand: "echo ok",
			evalBudgetMs: 500,
			maxIterations: 1,
		});

		await agent.start("test");

		expect(receivedSignal).toBeInstanceOf(AbortSignal);
	});

	it("start() reports evaluation failures and continues", async () => {
		const ctx = makeMockCtx();

		mockRunCycleEvaluation.mockRejectedValueOnce(new Error("eval crashed")).mockResolvedValueOnce({
			iteration: 2,
			success: true,
			status: "keep",
			metric: null,
			stdout: "ok",
			durationMs: 5,
		});

		const agent = new AutocycleAgent(ctx, {
			targetFile: "x",
			evalCommand: "echo ok",
			evalBudgetMs: 500,
			maxIterations: 2,
		});

		await agent.start("test");

		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("evaluation failed"));
		expect(ctx.state.autocyclePhase.value).toBe("idle");
	});

	it("reports improved vs non-improved iterations correctly", async () => {
		const ctx = makeMockCtx();

		mockRunCycleEvaluation
			.mockResolvedValueOnce({ iteration: 1, success: true, status: "keep", metric: 0.8, stdout: "ok", durationMs: 5 })
			.mockResolvedValueOnce({
				iteration: 2,
				success: false,
				status: "discard",
				metric: 0.5,
				stdout: "ok",
				durationMs: 5,
			});

		const agent = new AutocycleAgent(ctx, {
			targetFile: "x",
			evalCommand: "echo ok",
			evalBudgetMs: 500,
			maxIterations: 2,
		});

		await agent.start("test");

		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("improved!"));
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("no improvement"));
	});

	it("start() skips evaluation when agent does not mutate the target file", async () => {
		const ctx = makeMockCtx();

		// Override readFile to return identical content for both pre and post hash.
		// With the content-aware crypto mock, identical content → identical hash → no mutation.
		const fsModule = await import("node:fs/promises");
		(fsModule.default.readFile as ReturnType<typeof vi.fn>).mockImplementation(async () =>
			Buffer.from("unchanged-content"),
		);

		const agent = new AutocycleAgent(ctx, {
			targetFile: "x",
			evalCommand: "echo ok",
			evalBudgetMs: 500,
			maxIterations: 1,
		});

		await agent.start("test");

		expect(mockRunCycleEvaluation).not.toHaveBeenCalled();
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("did not modify the target file"));
	});

	it("start() reports unreadable target file before generation", async () => {
		const ctx = makeMockCtx();
		const fsModule = await import("node:fs/promises");
		(fsModule.default.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("EACCES"));

		const agent = new AutocycleAgent(ctx, {
			targetFile: "x",
			evalCommand: "echo ok",
			evalBudgetMs: 500,
			maxIterations: 1,
		});

		await agent.start("test");

		expect(mockRunCycleEvaluation).not.toHaveBeenCalled();
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(
			expect.stringContaining("unable to read target file before generation"),
		);
	});

	it("start() reports unreadable target file after generation", async () => {
		const ctx = makeMockCtx();
		const fsModule = await import("node:fs/promises");
		(fsModule.default.readFile as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(Buffer.from("before"))
			.mockRejectedValueOnce(new Error("EACCES"));

		const agent = new AutocycleAgent(ctx, {
			targetFile: "x",
			evalCommand: "echo ok",
			evalBudgetMs: 500,
			maxIterations: 1,
		});

		await agent.start("test");

		expect(mockRunCycleEvaluation).not.toHaveBeenCalled();
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(
			expect.stringContaining("unable to read target file after generation"),
		);
	});

	it("start() throws on invalid metric regex", async () => {
		const ctx = makeMockCtx();

		const agent = new AutocycleAgent(ctx, {
			targetFile: "x",
			evalCommand: "echo ok",
			evalBudgetMs: 500,
			metricRegex: "[invalid",
			maxIterations: 1,
		});

		await expect(agent.start("test")).rejects.toThrow("Invalid metric regex");
	});

	it("start() uses batch() for signal updates", async () => {
		const ctx = makeMockCtx();
		const agent = new AutocycleAgent(ctx, {
			targetFile: "x",
			evalCommand: "echo ok",
			evalBudgetMs: 500,
			maxIterations: 1,
		});

		await agent.start("test");

		// After completion, batch() should have reset signals
		expect(ctx.state.autocyclePhase.value).toBe("idle");
		expect(ctx.state.autocycleIteration.value).toBe(0);
	});
});

/* ── registerAutocycleCommands ──────────────────────────────────────────────── */

describe("registerAutocycleCommands", () => {
	it("registers /autocycle and /autocycle-cancel commands", () => {
		const ctx = makeMockCtx();
		registerAutocycleCommands(ctx);

		const regSpy = ctx.commands.register as ReturnType<typeof vi.fn>;
		expect(regSpy).toHaveBeenCalledTimes(2);
		expect(regSpy.mock.calls[0][0]).toBe("/autocycle");
		expect(regSpy.mock.calls[1][0]).toBe("/autocycle-cancel");
	});

	it("/autocycle rejects when no objective", async () => {
		const ctx = makeMockCtx();
		registerAutocycleCommands(ctx);
		const handler = (ctx.commands.register as ReturnType<typeof vi.fn>).mock.calls[0][2];

		await handler("");
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
	});

	it("/autocycle rejects when missing --target or --command", async () => {
		const ctx = makeMockCtx();
		registerAutocycleCommands(ctx);
		const handler = (ctx.commands.register as ReturnType<typeof vi.fn>).mock.calls[0][2];

		await handler("improve things");
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("--target"));
	});

	it("/autocycle rejects when agentRunner is null", async () => {
		const ctx = makeMockCtx({ agentRunner: null });
		registerAutocycleCommands(ctx);
		const handler = (ctx.commands.register as ReturnType<typeof vi.fn>).mock.calls[0][2];

		await handler('improve --target foo.ts --command "npm test"');
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("No agent runner"));
	});

	it("/autocycle passes --resume ledger path into Autocycle construction", async () => {
		const ctx = makeMockCtx();
		registerAutocycleCommands(ctx);
		const handler = (ctx.commands.register as ReturnType<typeof vi.fn>).mock.calls[0][2];

		await handler('improve --target foo.ts --command "npm test" --resume .takumi/autocycle/run.jsonl');

		expect(mockAutocycleConstructor).toHaveBeenCalledWith(
			expect.objectContaining({
				ledgerFile: ".takumi/autocycle/run.jsonl",
				resumeFromLedger: true,
			}),
		);
	});

	it("/autocycle-cancel reports no active cycle", () => {
		const ctx = makeMockCtx();
		registerAutocycleCommands(ctx);
		const cancelHandler = (ctx.commands.register as ReturnType<typeof vi.fn>).mock.calls[1][2];

		cancelHandler("");
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("No autocycle"));
	});

	it("/autocycle guards against double invocation", async () => {
		const ctx = makeMockCtx();
		const mockAgent = { isActive: true } as any;
		ctx.setActiveAutocycle(mockAgent);

		registerAutocycleCommands(ctx);
		const handler = (ctx.commands.register as ReturnType<typeof vi.fn>).mock.calls[0][2];

		await handler('improve --target foo.ts --command "npm test"');
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(
			expect.stringContaining("/autocycle is unavailable while the autocycle lane is active."),
		);
	});

	it("/autocycle-cancel calls cancel on active agent", () => {
		const ctx = makeMockCtx();
		const cancelSpy = vi.fn();
		const mockAgent = { isActive: true, cancel: cancelSpy } as any;
		ctx.setActiveAutocycle(mockAgent);

		registerAutocycleCommands(ctx);
		const cancelHandler = (ctx.commands.register as ReturnType<typeof vi.fn>).mock.calls[1][2];

		cancelHandler("");
		expect(cancelSpy).toHaveBeenCalled();
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("cancellation requested"));
	});

	it("/autocycle rejects whitespace-only objective", async () => {
		const ctx = makeMockCtx();
		registerAutocycleCommands(ctx);
		const handler = (ctx.commands.register as ReturnType<typeof vi.fn>).mock.calls[0][2];

		await handler("   --target foo.ts --command echo");
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
	});

	it("/autocycle rejects invalid --budget (NaN)", async () => {
		const ctx = makeMockCtx();
		registerAutocycleCommands(ctx);
		const handler = (ctx.commands.register as ReturnType<typeof vi.fn>).mock.calls[0][2];

		await handler('improve --target foo.ts --command "npm test" --budget abc');
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("--budget must be a number"));
	});

	it("/autocycle rejects float --budget values instead of truncating them", async () => {
		const ctx = makeMockCtx();
		registerAutocycleCommands(ctx);
		const handler = (ctx.commands.register as ReturnType<typeof vi.fn>).mock.calls[0][2];

		await handler('improve --target foo.ts --command "npm test" --budget 1.5');
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("--budget must be a number"));
	});

	it("/autocycle rejects --budget out of range", async () => {
		const ctx = makeMockCtx();
		registerAutocycleCommands(ctx);
		const handler = (ctx.commands.register as ReturnType<typeof vi.fn>).mock.calls[0][2];

		await handler('improve --target foo.ts --command "npm test" --budget 9999');
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("--budget must be a number"));
	});

	it("/autocycle rejects invalid --iterations (NaN)", async () => {
		const ctx = makeMockCtx();
		registerAutocycleCommands(ctx);
		const handler = (ctx.commands.register as ReturnType<typeof vi.fn>).mock.calls[0][2];

		await handler('improve --target foo.ts --command "npm test" --iterations xyz');
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("--iterations must be a number"));
	});

	it("/autocycle rejects float --iterations values instead of truncating them", async () => {
		const ctx = makeMockCtx();
		registerAutocycleCommands(ctx);
		const handler = (ctx.commands.register as ReturnType<typeof vi.fn>).mock.calls[0][2];

		await handler('improve --target foo.ts --command "npm test" --iterations 2.5');
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("--iterations must be a number"));
	});

	it("/autocycle rejects --iterations out of range", async () => {
		const ctx = makeMockCtx();
		registerAutocycleCommands(ctx);
		const handler = (ctx.commands.register as ReturnType<typeof vi.fn>).mock.calls[0][2];

		await handler('improve --target foo.ts --command "npm test" --iterations 999');
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("--iterations must be a number"));
	});

	it("/autocycle rejects --budget at lower boundary (0)", async () => {
		const ctx = makeMockCtx();
		registerAutocycleCommands(ctx);
		const handler = (ctx.commands.register as ReturnType<typeof vi.fn>).mock.calls[0][2];

		await handler('improve --target foo.ts --command "npm test" --budget 0');
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("--budget must be a number"));
	});

	it("/autocycle accepts --budget at exact boundaries (1 and 3600)", async () => {
		const ctx = makeMockCtx();
		registerAutocycleCommands(ctx);
		const handler = (ctx.commands.register as ReturnType<typeof vi.fn>).mock.calls[0][2];

		// Budget 1 should not produce an error about budget
		await handler('improve --target foo.ts --command "npm test" --budget 1');
		const budgetCalls = (ctx.addInfoMessage as ReturnType<typeof vi.fn>).mock.calls.filter((c: any) =>
			String(c[0]).includes("--budget"),
		);
		expect(budgetCalls).toHaveLength(0);
	});

	it("/autocycle rejects --iterations at lower boundary (0)", async () => {
		const ctx = makeMockCtx();
		registerAutocycleCommands(ctx);
		const handler = (ctx.commands.register as ReturnType<typeof vi.fn>).mock.calls[0][2];

		await handler('improve --target foo.ts --command "npm test" --iterations 0');
		expect(ctx.addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("--iterations must be a number"));
	});
});
