import {
	runNativeSideAgentLane,
	runNativeSideAgentLanes,
	runNativeSideAgentQuestionLanes,
} from "../workflow/workflow-side-agent-lanes.js";
import type { AppCommandContext } from "./app-command-context.js";
import { runAnalysisMacro } from "./app-command-macros.js";
import { buildPlanningPrompt, buildTeamLaneSpecs, formatDelegatedLaneOutput } from "./app-commands-workflow-helpers.js";

export function registerWorkflowLaneCommands(ctx: AppCommandContext): void {
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
				{ topic: "architecture", complexity: "STANDARD" },
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

	ctx.commands.register(
		"/team-plan",
		"Assemble architect, builder, and verifier lanes into a coordinated staffing plan",
		async (args) => {
			const task = args.trim() || "current task / recent session context";
			const laneReports = await runNativeSideAgentLanes(ctx, "/team-plan", buildTeamLaneSpecs(task));
			if (laneReports) {
				await runAnalysisMacro(
					ctx,
					"/team-plan",
					[
						buildPlanningPrompt(
							"/team-plan",
							task,
							ctx,
							"Synthesize a coordinated staffing plan using the delegated architect, builder, and verifier lanes below.",
						),
						"Return Markdown with sections: mission brief, recommended topology, lane charters, dependency order, sync points, merge gates, and operator next steps.",
						"Be explicit about which work should stay in the main lane versus side lanes, and which /lane-* follow-ups should happen next.",
						...laneReports.map((lane) => formatDelegatedLaneOutput(lane.label, lane.report)),
					].join("\n\n"),
				);
				return;
			}

			await runAnalysisMacro(
				ctx,
				"/team-plan",
				[
					buildPlanningPrompt(
						"/team-plan",
						task,
						ctx,
						"Build a coordinated staffing plan for the task. If side-agent tools are available, delegate architect, builder, and verifier roles to distinct lanes.",
					),
					"Return Markdown with sections: mission brief, recommended topology, lane charters, dependency order, sync points, merge gates, and operator next steps.",
					"Treat the architect, builder, and verifier as distinct teammates even if you must simulate them in one pass.",
				].join("\n\n"),
			);
		},
		["/team", "/staff-plan"],
	);

	ctx.commands.register(
		"/question-chain",
		"Build a chain of investigative questions, delegating framing/risk/validation lanes when available",
		async (args) => {
			const task = args.trim() || "current task / recent session context";
			const laneReports = await runNativeSideAgentQuestionLanes(ctx, "/question-chain", [
				{
					label: "framing",
					task: `Framing lane for: ${task}`,
					query: [
						`Build the first question in a chain for: ${task}`,
						"Return strict JSON with keys: primaryQuestion, whyItMatters, assumptionsToTest, evidenceNeeded, nextQuestion.",
						"Focus on framing, scope, ambiguity, and architecture-level unknowns.",
					].join("\n"),
					topic: "architecture",
					complexity: "STANDARD",
				},
				{
					label: "risk",
					task: `Risk lane for: ${task}`,
					query: [
						`Build the hardest risk question in a chain for: ${task}`,
						"Return strict JSON with keys: primaryQuestion, whyItMatters, assumptionsToTest, evidenceNeeded, nextQuestion.",
						"Focus on failure modes, hidden coupling, security, and operational risk.",
					].join("\n"),
					topic: "security-analysis",
					complexity: "CRITICAL",
				},
				{
					label: "validation",
					task: `Validation lane for: ${task}`,
					query: [
						`Build the best validation question in a chain for: ${task}`,
						"Return strict JSON with keys: primaryQuestion, whyItMatters, assumptionsToTest, evidenceNeeded, nextQuestion.",
						"Focus on what evidence, tests, experiments, or checks would de-risk the task.",
					].join("\n"),
					topic: "testing",
					complexity: "STANDARD",
				},
			]);

			if (laneReports) {
				await runAnalysisMacro(
					ctx,
					"/question-chain",
					[
						buildPlanningPrompt(
							"/question-chain",
							task,
							ctx,
							"Create an ordered chain of questions that can guide multi-agent investigation and execution.",
						),
						"Return Markdown with sections: primary question, ordered question chain, delegated lanes, evidence to gather, and recommended next move.",
						...laneReports.map((lane) => formatDelegatedLaneOutput(lane.label, lane.report)),
					].join("\n\n"),
				);
				return;
			}

			await runAnalysisMacro(
				ctx,
				"/question-chain",
				[
					buildPlanningPrompt(
						"/question-chain",
						task,
						ctx,
						"Build a chain of questions from framing, risk, and validation perspectives. If side-agent tools are available, delegate those perspectives to multiple lanes.",
					),
					"Return Markdown with sections: primary question, ordered question chain, delegated lanes (or simulated lanes), evidence to gather, and recommended next move.",
				].join("\n\n"),
			);
		},
		["/q-chain", "/questions"],
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
			{ topic: "security-analysis", complexity: "CRITICAL" },
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
}
