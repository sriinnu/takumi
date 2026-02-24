import { createLogger } from "@takumi/core";
import type { PhaseContext } from "./phases.js";
import { FIXER_PROMPT } from "./prompts.js";
import { augmentPromptWithReflexion, generateSelfCritique, retrievePastCritiques, storeCritique } from "./reflexion.js";
import {
	type AgentInstance,
	AgentRole,
	type ClusterEvent,
	ClusterPhase,
	type ClusterState,
	ValidationDecision,
} from "./types.js";

const log = createLogger("cluster-phases-fix");

interface FixingDeps {
	ctx: PhaseContext;
	runAgent: (
		agent: AgentInstance,
		systemPrompt: string,
		userMessage: string,
		phase: ClusterPhase,
		attemptNumber?: number,
	) => Promise<string>;
	getAgentByRole: (state: ClusterState, role: AgentRole) => AgentInstance | null;
}

export async function* runFixingPhase({ ctx, runAgent, getAgentByRole }: FixingDeps): AsyncGenerator<ClusterEvent> {
	const state = ctx.getState();
	ctx.setPhase(ClusterPhase.FIXING);
	const worker = getAgentByRole(state, AgentRole.WORKER);
	if (!worker) return;
	const findingsSummary = state.validationResults
		.filter((r) => r.decision === ValidationDecision.REJECT)
		.map(
			(r) =>
				`${r.validatorRole}:\n${r.findings.map((f) => `  [${f.severity}] ${f.description}`).join("\n")}\n${r.reasoning}`,
		)
		.join("\n\n");
	const userMsg = `The validators rejected your work:\n\n${findingsSummary}\n\nFix all issues and re-run tests.`;
	let systemPrompt = FIXER_PROMPT;
	const reflexionConfig = ctx.orchestrationConfig?.reflexion;
	if (reflexionConfig?.enabled && ctx.chitragupta && state.workProduct) {
		try {
			const critique = await generateSelfCritique(
				ctx,
				state.config.taskDescription,
				state.workProduct.summary ?? "",
				state.validationResults,
			);
			if (reflexionConfig.useAkasha) await storeCritique(ctx.chitragupta, critique, "CODING");
			const past = await retrievePastCritiques(
				ctx.chitragupta,
				state.config.taskDescription,
				reflexionConfig.maxHistorySize ?? 3,
			);
			systemPrompt = augmentPromptWithReflexion(FIXER_PROMPT, [critique, ...past]);
		} catch (err) {
			log.error("Reflexion failed, continuing without self-critique", err);
		}
	}
	const fixed = await runAgent(worker, systemPrompt, userMsg, ClusterPhase.FIXING, state.validationAttempt);
	state.workProduct = { ...state.workProduct!, summary: fixed };
	await ctx.saveCheckpoint();
}
