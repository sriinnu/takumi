import { createLogger } from "@takumi/core";
import type { AgentEvaluator } from "@yugenlab/chitragupta/niyanta";
import { type MoAConfig, moaValidate } from "./mixture-of-agents.js";
import { getValidatorPrompt } from "./prompts.js";
import {
	type AgentInstance,
	AgentRole,
	type ClusterEvent,
	ClusterPhase,
	type ClusterState,
	ValidationDecision,
	type ValidationResult,
	type WorkProduct,
} from "./types.js";
import { aggregateValidations } from "./weighted-voting.js";

const log = createLogger("cluster-phases-validate");
const HEURISTIC_PASS = 4.0;

interface ValidationDeps {
	ctx: import("./phases.js").PhaseContext;
	evaluator: AgentEvaluator;
	runAgent: (
		agent: AgentInstance,
		systemPrompt: string,
		userMessage: string,
		phase: ClusterPhase,
		attemptNumber?: number,
	) => Promise<string>;
	getAgentsByRolePattern: (state: ClusterState, pattern: RegExp) => AgentInstance[];
	aggregateValidationResults: (state: ClusterState, results: ValidationResult[]) => ValidationDecision;
}

export async function* runValidationPhase(deps: ValidationDeps): AsyncGenerator<ClusterEvent> {
	const { ctx, evaluator, getAgentsByRolePattern } = deps;
	const state = ctx.getState();
	ctx.setPhase(ClusterPhase.VALIDATING);
	state.validationAttempt++;
	const validators = getAgentsByRolePattern(state, /^VALIDATOR_/);
	if (validators.length === 0 || !state.workProduct) {
		state.finalDecision = ValidationDecision.APPROVE;
		return;
	}
	const heuristic = evaluator.evaluate("worker", state.id, state.config.taskDescription, state.workProduct.summary);
	if (heuristic.overallScore < HEURISTIC_PASS) {
		state.finalDecision = ValidationDecision.REJECT;
		state.validationResults = [
			{
				validatorId: "heuristic",
				validatorRole: AgentRole.VALIDATOR_REQUIREMENTS,
				decision: ValidationDecision.REJECT,
				findings: [
					{
						severity: "critical",
						category: "quality",
						description: `Heuristic pre-screen failed (score ${heuristic.overallScore.toFixed(2)}/10)`,
					},
				],
				reasoning: "Automatic heuristic rejection — output quality below threshold.",
				confidence: 0.9,
			},
		];
		yield {
			type: "validation_complete",
			clusterId: state.id,
			attempt: state.validationAttempt,
			results: state.validationResults,
			decision: ValidationDecision.REJECT,
			timestamp: Date.now(),
		};
		return;
	}

	const explicitMoAConfig = ctx.orchestrationConfig?.moA;
	const shouldUseAdversarialDefaultMoA = state.config.topology === "adversarial" && explicitMoAConfig === undefined;
	const moaConfig =
		explicitMoAConfig ??
		(shouldUseAdversarialDefaultMoA
			? {
					enabled: true,
					rounds: 2,
					validatorCount: 3,
					allowCrossTalk: true,
					temperatures: [0.2, 0.1, 0.05],
				}
			: undefined);
	if (moaConfig?.enabled) yield* runMoAValidation(deps, state, moaConfig);
	else yield* runStandardValidation(deps, state, validators);
	await ctx.saveCheckpoint();
}

async function* runStandardValidation(
	deps: ValidationDeps,
	state: ClusterState,
	validators: AgentInstance[],
): AsyncGenerator<ClusterEvent> {
	const results = await Promise.all(validators.map((v) => runValidator(deps, v, state.workProduct!)));
	state.validationResults = results;
	const decision = deps.aggregateValidationResults(state, results);
	state.finalDecision = decision;
	yield {
		type: "validation_complete",
		clusterId: state.id,
		attempt: state.validationAttempt,
		results,
		decision,
		timestamp: Date.now(),
	};
}

async function* runMoAValidation(
	{ ctx, evaluator }: ValidationDeps,
	state: ClusterState,
	config: Partial<MoAConfig>,
): AsyncGenerator<ClusterEvent> {
	const workProduct = state.workProduct;
	if (!workProduct) throw new Error("No work product to validate");
	const result = await moaValidate(ctx, evaluator, workProduct.summary, state.config.taskDescription, config);
	const finalRound = result.rounds[result.rounds.length - 1];
	state.validationResults = finalRound.validators.map((v) => ({
		validatorId: v.validatorId,
		validatorRole: AgentRole.VALIDATOR_REQUIREMENTS,
		decision: v.decision,
		findings: [],
		reasoning: v.reasoning,
		confidence: v.confidence,
	}));
	state.finalDecision = result.finalDecision;
	state.workProduct = {
		...workProduct,
		metadata: {
			...workProduct.metadata,
			moaRounds: result.rounds.length,
			moaConsensus: result.finalConsensus,
			moaAverageConfidence: result.averageConfidence,
		},
	};
	ctx.onTokenUsage?.(result.totalTokenUsage.input, result.totalTokenUsage.output);
	yield {
		type: "moa_validation_complete",
		clusterId: state.id,
		rounds: result.rounds.length,
		finalDecision: result.finalDecision,
		consensus: result.finalConsensus,
		averageConfidence: result.averageConfidence,
		timestamp: Date.now(),
	};
	yield {
		type: "validation_complete",
		clusterId: state.id,
		attempt: state.validationAttempt,
		results: state.validationResults,
		decision: result.finalDecision,
		timestamp: Date.now(),
	};
}

export async function runValidator(
	deps: ValidationDeps,
	validator: AgentInstance,
	workProduct: WorkProduct,
): Promise<ValidationResult> {
	const systemPrompt = getValidatorPrompt(validator.role, deps.ctx.getState().config.topology);
	const testLine = workProduct.testResults
		? `Tests: ${workProduct.testResults.passed ? "PASSED" : "FAILED"}\n${workProduct.testResults.output}`
		: "";
	const buildLine = workProduct.buildResults
		? `Build: ${workProduct.buildResults.success ? "SUCCESS" : "FAILED"}\n${workProduct.buildResults.output}`
		: "";
	const userMsg = [
		`Task: ${validator.context.taskDescription}`,
		`\nWork Product:\n${workProduct.summary}`,
		`\nFiles Modified: ${workProduct.filesModified.join(", ") || "None"}`,
		testLine,
		buildLine,
		'\nRespond with JSON:\n{"decision":"APPROVE"|"REJECT"|"NEEDS_INFO","findings":[{"severity":"critical"|"major"|"minor"|"info","category":"...","description":"...","suggestion":"..."}],"reasoning":"...","confidence":0.0}',
	]
		.filter(Boolean)
		.join("\n");
	try {
		const raw = await deps.runAgent(validator, systemPrompt, userMsg, ClusterPhase.VALIDATING, 1);
		const json = JSON.parse((raw.match(/\{[\s\S]*\}/) ?? ["{}"])[0]);
		return {
			validatorId: validator.id,
			validatorRole: validator.role,
			decision: (json.decision as ValidationDecision) ?? ValidationDecision.REJECT,
			findings: json.findings ?? [],
			reasoning: json.reasoning ?? "",
			confidence: json.confidence ?? 0.5,
		};
	} catch (err) {
		log.error(`Validator ${validator.role} failed`, err);
		return {
			validatorId: validator.id,
			validatorRole: validator.role,
			decision: ValidationDecision.REJECT,
			findings: [
				{
					severity: "critical",
					category: "validation_error",
					description: `Validator threw: ${err instanceof Error ? err.message : String(err)}`,
				},
			],
			reasoning: "Validator encountered an error — defaulting to REJECT.",
			confidence: 0.1,
		};
	}
}

export function aggregateValidationResults(
	ctx: import("./phases.js").PhaseContext,
	evaluator: AgentEvaluator,
	state: ClusterState,
	results: ValidationResult[],
): ValidationDecision {
	if (ctx.orchestrationConfig?.weightedVoting) {
		const weighted = aggregateValidations(results, evaluator);
		return weighted.decision;
	}
	const approvals = results.filter((r) => r.decision === ValidationDecision.APPROVE).length;
	const rejections = results.filter((r) => r.decision === ValidationDecision.REJECT).length;
	switch (state.config.validationStrategy) {
		case "none":
			return ValidationDecision.APPROVE;
		case "single":
			return approvals > 0 ? ValidationDecision.APPROVE : ValidationDecision.REJECT;
		case "majority":
			return approvals > results.length / 2 ? ValidationDecision.APPROVE : ValidationDecision.REJECT;
		case "all_approve":
			return rejections === 0 ? ValidationDecision.APPROVE : ValidationDecision.REJECT;
		default:
			return ValidationDecision.REJECT;
	}
}
