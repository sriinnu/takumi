import type { OrchestrationConfig } from "@takumi/core";
import { createLogger } from "@takumi/core";
import type { AgentEvaluator } from "@yugenlab/chitragupta/niyanta";
import { type EnsembleConfig, ensembleExecute } from "./ensemble.js";
import type { PhaseContext } from "./phases.js";
import { progressiveRefine } from "./progressive-refinement.js";
import { getPlannerPrompt, getWorkerPrompt } from "./prompts.js";
import { type AgentInstance, AgentRole, type ClusterEvent, ClusterPhase, type ClusterState } from "./types.js";

const log = createLogger("cluster-phases-exec");

interface ExecutionDeps {
	ctx: PhaseContext;
	evaluator: AgentEvaluator;
	runAgent: (
		agent: AgentInstance,
		systemPrompt: string,
		userMessage: string,
		phase: ClusterPhase,
		attemptNumber?: number,
	) => Promise<string>;
	getAgentByRole: (state: ClusterState, role: AgentRole) => AgentInstance | null;
}

export async function* runPlanningPhase({
	ctx,
	runAgent,
	getAgentByRole,
}: ExecutionDeps): AsyncGenerator<ClusterEvent> {
	const state = ctx.getState();
	ctx.setPhase(ClusterPhase.PLANNING);
	const planner = getAgentByRole(state, AgentRole.PLANNER);
	if (!planner) return;
	const userMsg = `Task: ${state.config.taskDescription}\n\nWorking directory: ${ctx.workDir}\n\nCreate a detailed implementation plan.`;
	state.plan = await runAgent(planner, getPlannerPrompt(state.config.topology), userMsg, ClusterPhase.PLANNING, 1);
	await ctx.saveCheckpoint();
	yield {
		type: "phase_change",
		clusterId: state.id,
		oldPhase: ClusterPhase.PLANNING,
		newPhase: ClusterPhase.EXECUTING,
		timestamp: Date.now(),
	};
}

export async function* runExecutionPhase(deps: ExecutionDeps): AsyncGenerator<ClusterEvent> {
	const { ctx } = deps;
	const state = ctx.getState();
	ctx.setPhase(ClusterPhase.EXECUTING);
	const config = ctx.orchestrationConfig;
	const explicitEnsembleConfig = config?.ensemble;
	const ensembleConfig =
		explicitEnsembleConfig ??
		(state.config.topology === "swarm"
			? {
					enabled: true,
					workerCount: 3,
					temperature: 0.9,
					parallel: true,
				}
			: undefined);
	if (ensembleConfig?.enabled) {
		yield* runEnsembleExecution(deps, ensembleConfig);
	} else if (config?.progressiveRefinement?.enabled) yield* runProgressiveExecution(deps, config.progressiveRefinement);
	else await runStandardExecution(deps);
	await ctx.saveCheckpoint();
	yield {
		type: "phase_change",
		clusterId: state.id,
		oldPhase: ClusterPhase.EXECUTING,
		newPhase: ClusterPhase.VALIDATING,
		timestamp: Date.now(),
	};
}

async function runStandardExecution({ ctx, runAgent, getAgentByRole }: ExecutionDeps): Promise<void> {
	const state = ctx.getState();
	const worker = getAgentByRole(state, AgentRole.WORKER);
	if (!worker) throw new Error("No WORKER agent in cluster");
	const userMsg = state.plan
		? `Plan:\n${state.plan}\n\nWorking directory: ${ctx.workDir}\n\nImplement this plan now.`
		: `Task: ${state.config.taskDescription}\n\nWorking directory: ${ctx.workDir}\n\nImplement this task.`;
	const response = await runAgent(
		worker,
		getWorkerPrompt(!!state.plan, state.config.topology),
		userMsg,
		ClusterPhase.EXECUTING,
		1,
	);
	state.workProduct = {
		filesModified: [],
		diff: "",
		summary: response,
		testResults: undefined,
		buildResults: undefined,
	};
}

async function* runEnsembleExecution(
	{ ctx, getAgentByRole, evaluator }: ExecutionDeps,
	config: EnsembleConfig,
): AsyncGenerator<ClusterEvent> {
	const state = ctx.getState();
	if (!getAgentByRole(state, AgentRole.WORKER)) throw new Error("No WORKER agent in cluster");
	const result = await ensembleExecute(ctx, state.config.taskDescription, config, evaluator);
	log.info(`Ensemble complete: winner=${result.winner.workerId}`);
	state.workProduct = {
		filesModified: [],
		diff: "",
		summary: result.winner.output,
		testResults: undefined,
		buildResults: undefined,
		heuristicScore: result.winner.heuristicScore,
		metadata: {
			ensembleCandidates: result.candidates.length,
			consensusScore: result.consensus,
			avgScore: result.candidates.reduce((sum, c) => sum + c.heuristicScore, 0) / result.candidates.length,
		},
	};
	ctx.onTokenUsage?.(result.totalTokens.input, result.totalTokens.output);
	yield {
		type: "ensemble_complete",
		clusterId: state.id,
		candidateCount: result.candidates.length,
		winnerId: result.winner.workerId,
		timestamp: Date.now(),
	};
}

async function* runProgressiveExecution(
	{ ctx, runAgent, getAgentByRole, evaluator }: ExecutionDeps,
	config: NonNullable<OrchestrationConfig["progressiveRefinement"]>,
): AsyncGenerator<ClusterEvent> {
	const state = ctx.getState();
	const worker = getAgentByRole(state, AgentRole.WORKER);
	if (!worker) throw new Error("No WORKER agent in cluster");
	const userMsg = state.plan
		? `Plan:\n${state.plan}\n\nWorking directory: ${ctx.workDir}\n\nImplement this plan now.`
		: `Task: ${state.config.taskDescription}\n\nWorking directory: ${ctx.workDir}\n\nImplement this task.`;
	const initialDraft = await runAgent(
		worker,
		getWorkerPrompt(!!state.plan, state.config.topology),
		userMsg,
		ClusterPhase.EXECUTING,
		1,
	);
	const result = await progressiveRefine(ctx, evaluator, state.config.taskDescription, initialDraft, {
		maxIterations: config.maxIterations,
		minImprovement: config.minImprovement,
		useCriticModel: config.useCriticModel,
		targetScore: config.targetScore,
	});
	const initialScore = result.iterations[0]?.heuristicScore ?? 0;
	state.workProduct = {
		filesModified: [],
		diff: "",
		summary: result.finalOutput,
		testResults: undefined,
		buildResults: undefined,
		heuristicScore: result.finalScore,
		metadata: {
			iterations: result.iterations.length,
			stopReason: result.stopReason,
			initialScore,
			improvementRate: result.improvement,
		},
	};
	ctx.onTokenUsage?.(result.totalTokenUsage.input, result.totalTokenUsage.output);
	yield {
		type: "progressive_complete",
		clusterId: state.id,
		iterationCount: result.iterations.length,
		finalScore: result.finalScore,
		stopReason: result.stopReason,
		timestamp: Date.now(),
	};
}
