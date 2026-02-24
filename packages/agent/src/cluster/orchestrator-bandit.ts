import type { Logger, OrchestrationConfig } from "@takumi/core";
import type {
	AutonomousOrchestrator,
	OrchestratorStats,
	OrchestratorTask,
	TaskResult,
} from "@yugenlab/chitragupta/niyanta";
import type { ClusterState } from "./types.js";

export interface StrategyArms {
	execution: string[];
	validation: string[];
}

export function createNiyantaTask(clusterId: string, taskDescription: string): OrchestratorTask {
	return {
		id: clusterId,
		type: "prompt",
		description: taskDescription,
		priority: "normal",
		status: "pending",
	};
}

export function buildStats(agentCount: number): OrchestratorStats {
	return {
		totalTasks: 1,
		pendingTasks: 0,
		runningTasks: 1,
		completedTasks: 0,
		failedTasks: 0,
		activeAgents: agentCount,
		totalCost: 0,
		totalTokens: 0,
		averageLatency: 0,
		throughput: 0,
	};
}

export function registerStrategies(config?: OrchestrationConfig, log?: Logger): StrategyArms {
	if (!config) {
		return { execution: ["standard"], validation: ["standard_validation"] };
	}

	const execution: string[] = ["standard"];
	if (config.ensemble?.enabled) {
		execution.push(`ensemble_k${config.ensemble.workerCount}_t${config.ensemble.temperature}`);
	}
	if (config.progressiveRefinement?.enabled) {
		execution.push(
			`progressive_i${config.progressiveRefinement.maxIterations}_t${config.progressiveRefinement.targetScore}`,
		);
	}

	const validation: string[] = ["standard_validation"];
	if (config.moA?.enabled) {
		validation.push(`moa_r${config.moA.rounds}_v${config.moA.validatorCount}`);
	}

	log?.info(`Registered strategies: execution=[${execution.join(", ")}] validation=[${validation.join(", ")}]`);
	return { execution, validation };
}

export function applyStrategy(strategy: string, log?: Logger): void {
	if (strategy.startsWith("ensemble_")) {
		log?.info(`Bandit selected: ${strategy} (using config values)`);
		return;
	}
	if (strategy.startsWith("progressive_")) {
		log?.info(`Bandit selected: ${strategy} (using config values)`);
		return;
	}
	if (strategy.startsWith("moa_")) {
		log?.info(`Bandit selected: ${strategy} (using config values)`);
		return;
	}
	if (strategy === "standard") {
		log?.info("Bandit selected: standard single-worker execution");
		return;
	}
	if (strategy === "standard_validation") {
		log?.info("Bandit selected: standard single-round validation");
	}
}

export function recordBanditOutcome(
	autonomous: AutonomousOrchestrator,
	task: OrchestratorTask | null,
	state: ClusterState | null,
	runStartMs: number,
	totalInputTokens: number,
	totalOutputTokens: number,
	success: boolean,
	strategy: string,
	log?: Logger,
): void {
	if (!task) return;

	const durationMs = Date.now() - runStartMs;
	const totalTokens = totalInputTokens + totalOutputTokens;
	const cost = (totalInputTokens * 3 + totalOutputTokens * 15) / 1_000_000;
	const heuristicScore = state?.workProduct?.heuristicScore ?? 0;
	const consensusScore =
		state?.workProduct?.metadata?.consensusScore ?? state?.workProduct?.metadata?.moaConsensus ?? 0;

	const result: TaskResult = {
		success,
		output: success ? "Cluster completed" : "Cluster failed",
		metrics: {
			startTime: runStartMs,
			endTime: Date.now(),
			tokenUsage: totalTokens,
			cost,
			toolCalls: 0,
			retries: state?.validationAttempt ?? 0,
		},
	};

	autonomous.recordOutcome(task, result, strategy as never);
	log?.info(
		`Bandit feedback: ${strategy} → ${success ? "SUCCESS" : "FAIL"} ` +
			`(heuristic=${heuristicScore.toFixed(2)}, consensus=${consensusScore.toFixed(2)}, ` +
			`tokens=${totalTokens}, latency=${durationMs}ms)`,
	);
}
