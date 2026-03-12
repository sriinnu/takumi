import type { AppCommandContext } from "./app-command-context.js";
import {
	buildSessionContext,
	dispatchCodeCommand,
	executeNativeTool,
	hasNativeTool,
	parseJsonToolOutput,
	runAnalysisMacro,
	runCodeMacro,
} from "./app-command-macros.js";
import { formatRoutingDecision } from "./control-plane-state.js";
import { formatScarlettIntegrityReport } from "./scarlett-runtime.js";

interface NativeSideAgentStartResult {
	id: string;
	status: string;
	worktree: string;
	branch: string;
	tmuxWindow: string;
}

interface NativeSideAgentQueryResult {
	id: string;
	query: string;
	format: string;
	responseType: "structured" | "raw";
	response: unknown;
	warning?: string;
}

interface NativeWorktreeCreateResult {
	path: string;
	branch: string;
	label: string;
}

function parseTestMode(args: string): { mode: "unit" | "integration" | "e2e"; scope: string } {
	const trimmed = args.trim();
	if (!trimmed) {
		return { mode: "unit", scope: "" };
	}
	const [first, ...rest] = trimmed.split(/\s+/);
	if (first === "unit" || first === "integration" || first === "e2e") {
		return { mode: first, scope: rest.join(" ").trim() };
	}
	return { mode: "unit", scope: trimmed };
}

function buildPlanningPrompt(kind: string, task: string, ctx: AppCommandContext, extra = ""): string {
	return [
		`Workflow command: ${kind}`,
		"Stay in analysis mode.",
		"Do not edit files, do not write code, and do not run mutating commands.",
		extra,
		"Return concise Markdown with: framing, assumptions, plan/options, risks, and next steps.",
		"",
		buildSessionContext(ctx),
		"",
		`Task: ${task}`,
	]
		.filter(Boolean)
		.join("\n");
}

function slugifyLaneLabel(input: string): string {
	const slug = input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 24);
	return slug || `lane-${Date.now().toString(36)}`;
}

async function runNativeSideAgentLane(
	ctx: AppCommandContext,
	commandName: string,
	task: string,
	query: string,
): Promise<NativeSideAgentQueryResult | null> {
	if (!hasNativeTool(ctx, "takumi_agent_start") || !hasNativeTool(ctx, "takumi_agent_query")) {
		return null;
	}

	const startResult = await executeNativeTool(ctx, commandName, "takumi_agent_start", {
		description: task,
		initialPrompt: [
			`Native workflow lane for ${commandName}.`,
			"Stay scoped to the requested task and keep your work independent from the main lane.",
			"Prefer structured reasoning and be explicit about assumptions.",
		].join("\n"),
	});
	const started = parseJsonToolOutput<NativeSideAgentStartResult>(startResult);
	if (!started?.id) {
		return null;
	}

	ctx.addInfoMessage(`${commandName} spawned side lane ${started.id} on ${started.branch} (${started.worktree}).`);

	const queryResult = await executeNativeTool(ctx, commandName, "takumi_agent_query", {
		id: started.id,
		query,
		format: "json",
	});
	return parseJsonToolOutput<NativeSideAgentQueryResult>(queryResult);
}

export function registerWorkflowCommands(ctx: AppCommandContext): void {
	ctx.commands.register("/plan", "Plan a task without executing it", async (args) => {
		if (!args.trim()) {
			ctx.addInfoMessage("Usage: /plan <task>");
			return;
		}
		await runAnalysisMacro(ctx, "/plan", buildPlanningPrompt("/plan", args.trim(), ctx));
	});

	ctx.commands.register("/design", "Review architecture and tradeoffs before implementation", async (args) => {
		const scope = args.trim() || "current task / recent session context";
		await runAnalysisMacro(
			ctx,
			"/design",
			buildPlanningPrompt(
				"/design",
				scope,
				ctx,
				"Focus on architecture, tradeoffs, interfaces, failure modes, and maintainability.",
			),
		);
	});

	ctx.commands.register("/build", "Execute an approved plan through the coding agent", async (args) => {
		const target = args.trim() || "the approved plan implied by the current session";
		await runCodeMacro(
			ctx,
			"/build",
			[
				"Execution mode: implement the approved plan or task.",
				"Make small, verifiable changes.",
				"Run relevant validation before concluding.",
				`Execution target: ${target}`,
			].join("\n"),
		);
	});

	ctx.commands.register("/test", "Create or expand tests with an explicit test mode", async (args) => {
		const { mode, scope } = parseTestMode(args);
		await runCodeMacro(
			ctx,
			"/test",
			[
				`Testing mode: ${mode}`,
				"Add or improve tests first-class, then run the relevant test commands.",
				"Prioritize high-signal edge cases, regressions, and failure paths.",
				scope ? `Testing scope: ${scope}` : "Testing scope: current task / recent changes",
			].join("\n"),
		);
	});

	ctx.commands.register("/review", "Run a code, security, and performance review pass", async (args) => {
		await runAnalysisMacro(
			ctx,
			"/review",
			buildPlanningPrompt(
				"/review",
				args.trim() || "current workspace or recent changes",
				ctx,
				"Review for correctness, security, performance, maintainability, and hidden risk. Do not patch files in this pass.",
			),
		);
	});

	ctx.commands.register("/reflect", "Summarize decisions, blockers, and next steps", async (args) => {
		await runAnalysisMacro(
			ctx,
			"/reflect",
			buildPlanningPrompt(
				"/reflect",
				args.trim() || "current session",
				ctx,
				"Summarize what happened, what was decided, what remains risky, and what should happen next.",
			),
		);
	});

	ctx.commands.register(
		"/co-plan",
		"Generate an alternative implementation plan from a second perspective",
		async (args) => {
			const task = args.trim() || "current task / recent session context";
			const nativeReport = await runNativeSideAgentLane(
				ctx,
				"/co-plan",
				`Independent planning lane for: ${task}`,
				[
					`Produce an independent implementation plan for: ${task}`,
					"Return strict JSON with keys: summary, assumptions, steps, risks, tradeoffs, recommendation.",
					"Do not write code or mutate files.",
				].join("\n"),
			);
			if (nativeReport) {
				await runAnalysisMacro(
					ctx,
					"/co-plan",
					[
						buildPlanningPrompt(
							"/co-plan",
							task,
							ctx,
							"Compare the primary plan against the independently generated alternative lane and recommend one.",
						),
						"Independent side-lane output:",
						typeof nativeReport.response === "string"
							? nativeReport.response
							: JSON.stringify(nativeReport.response, null, 2),
					].join("\n\n"),
				);
				return;
			}
			await runAnalysisMacro(
				ctx,
				"/co-plan",
				[
					buildPlanningPrompt(
						"/co-plan",
						task,
						ctx,
						"If side-agent tools are available, use them to get an independent second plan. Otherwise simulate a clearly independent alternative plan.",
					),
					"Compare the primary plan and the alternative plan, then recommend one.",
				].join("\n\n"),
			);
		},
	);

	ctx.commands.register("/co-validate", "Run adversarial validation or staff-engineer-style review", async (args) => {
		const task = args.trim() || "current work";
		const nativeReport = await runNativeSideAgentLane(
			ctx,
			"/co-validate",
			`Independent validation lane for: ${task}`,
			[
				`Perform an adversarial validation review for: ${task}`,
				"Return strict JSON with keys: verdict, confidence, majorRisks, requiredBeforeMerge, canWait, suggestedTests.",
				"Be skeptical, concrete, and concise.",
			].join("\n"),
		);
		if (nativeReport) {
			await runAnalysisMacro(
				ctx,
				"/co-validate",
				[
					buildPlanningPrompt(
						"/co-validate",
						task,
						ctx,
						"Take an adversarial validation stance using the independent lane report below.",
					),
					"Independent validation lane output:",
					typeof nativeReport.response === "string"
						? nativeReport.response
						: JSON.stringify(nativeReport.response, null, 2),
				].join("\n\n"),
			);
			return;
		}
		await runAnalysisMacro(
			ctx,
			"/co-validate",
			[
				buildPlanningPrompt(
					"/co-validate",
					args.trim() || "current work",
					ctx,
					"Take an adversarial validation stance. If side-agent tools are available, use them for an independent reviewer lane.",
				),
				"Return: major risks, confidence level, what must be fixed before merge, and what can safely wait.",
			].join("\n\n"),
		);
	});

	ctx.commands.register("/route-plan", "Show which orchestration topology Takumi would use and why", async (args) => {
		const recentRoutes = ctx.state.routingDecisions.value.slice(-3);
		const routingContext =
			recentRoutes.length > 0
				? recentRoutes
						.map((decision, index) => `### Recent route ${index + 1}\n${formatRoutingDecision(decision)}`)
						.join("\n\n")
				: "No prior routing decisions recorded in this session.";
		await runAnalysisMacro(
			ctx,
			"/route-plan",
			[
				"Workflow command: /route-plan",
				"Recommend the best orchestration topology for the requested task.",
				"Choose among: direct single-agent, planning-first, adversarial validation, multi-worktree speculative execution, or side-agent council.",
				"Explain why the topology fits the task and the current control-plane health.",
				"",
				formatScarlettIntegrityReport(ctx.state.scarlettIntegrityReport.value),
				"",
				routingContext,
				"",
				buildSessionContext(ctx),
				"",
				`Task: ${args.trim() || "current task / recent session context"}`,
			].join("\n"),
		);
	});

	ctx.commands.register("/worktree-spin", "Create isolated execution lanes for a task", async (args) => {
		if (!args.trim()) {
			ctx.addInfoMessage("Usage: /worktree-spin <task>");
			return;
		}

		if (hasNativeTool(ctx, "worktree_create")) {
			const label = slugifyLaneLabel(args);
			const createResult = await executeNativeTool(ctx, "/worktree-spin", "worktree_create", { label });
			const worktree = parseJsonToolOutput<NativeWorktreeCreateResult>(createResult);
			if (worktree?.path) {
				ctx.addInfoMessage(
					`/worktree-spin created isolated lane ${worktree.label} at ${worktree.path} (${worktree.branch}).`,
				);
				const dispatched = await dispatchCodeCommand(
					ctx,
					"/worktree-spin",
					[
						"Isolated worktree lane mode.",
						`A real worktree has already been created at: ${worktree.path}`,
						`Associated branch reference: ${worktree.branch}`,
						"Operate only on files inside that worktree path.",
						"Use worktree_exec for validation commands against that lane.",
						"Use worktree_merge only if the lane is validated and ready to bring back.",
						"Use worktree_destroy when the lane is no longer needed.",
						`Task: ${args.trim()}`,
					].join("\n"),
				);
				if (!dispatched && hasNativeTool(ctx, "worktree_destroy")) {
					await executeNativeTool(ctx, "/worktree-spin", "worktree_destroy", {
						worktree_path: worktree.path,
					});
				}
				return;
			}
		}

		await runCodeMacro(
			ctx,
			"/worktree-spin",
			[
				"Worktree-lane mode.",
				"Use the exact tools worktree_create, worktree_exec, worktree_merge, and worktree_destroy when isolation is useful.",
				"If parallel analysis helps, you may also use takumi_agent_start / takumi_agent_query for a second lane.",
				"Prefer safe isolated execution before merging changes back.",
				`Task: ${args.trim()}`,
			].join("\n"),
		);
	});

	ctx.commands.register(
		"/scarlett-fix",
		"Suggest integrity-aware remediation steps from Scarlett findings",
		async (args) => {
			const report = ctx.state.scarlettIntegrityReport.value;
			if (report.findings.length === 0 && !args.trim()) {
				ctx.addInfoMessage(
					"Scarlett currently reports no integrity findings. Pass a scope if you still want a remediation review.",
				);
				return;
			}
			await runAnalysisMacro(
				ctx,
				"/scarlett-fix",
				[
					"Workflow command: /scarlett-fix",
					"Recommend remediation steps for integrity drift, degraded capabilities, routing issues, or control-plane anomalies.",
					"Do not edit files in this pass.",
					"",
					formatScarlettIntegrityReport(report),
					"",
					args.trim() ? `Scope override: ${args.trim()}` : "Scope override: none",
				].join("\n"),
			);
		},
	);
}
