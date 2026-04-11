import {
	type AgentRole,
	type ClassificationResult,
	deriveClusterConfig,
	shouldEscalateWeakConsensus,
	type TopologyWinRate,
	type ValidationResult,
} from "@takumi/agent";
import type { ChitraguptaObserver, ExecutionLaneEnvelope } from "@takumi/bridge";
import type { OrchestrationConfig } from "@takumi/core";
import { DEFAULT_SABHA_ASKER, DEFAULT_SABHA_CONVENER, DEFAULT_SABHA_PARTICIPANTS } from "../sabha-defaults.js";
import type { AppState } from "../state.js";

interface PrepareMeshClusterInput {
	description: string;
	result: ClassificationResult;
	state: AppState;
	orchestrationConfig?: OrchestrationConfig;
	maxValidationRetries: number;
	laneEnvelopes?: Partial<Record<AgentRole, ExecutionLaneEnvelope>>;
	/** Historical topology win-rates used to bias Lucy's topology selection. */
	profileBias?: TopologyWinRate[];
}

export function prepareMeshCluster(input: PrepareMeshClusterInput) {
	return {
		...deriveClusterConfig({
			description: input.description,
			classification: input.result.classification,
			topology: input.result.topology,
			maxRetries: input.maxValidationRetries,
			isolationMode: input.state.isolationMode.value,
			orchestrationConfig: input.orchestrationConfig,
			integrityStatus: input.state.scarlettIntegrityReport.value.status,
			profileBias: input.profileBias,
		}),
		laneEnvelopes: input.laneEnvelopes,
	};
}

export async function maybeEscalateMeshSabha(
	observer: ChitraguptaObserver | null,
	topic: string,
	reason: string,
): Promise<boolean> {
	if (!observer) return false;
	const result = await observer.sabhaAsk({
		topic: reason ? `${topic}\n\nReason: ${reason}` : topic,
		convener: DEFAULT_SABHA_CONVENER,
		askerId: DEFAULT_SABHA_ASKER,
		participants: DEFAULT_SABHA_PARTICIPANTS,
	});
	return Boolean(result?.sabha.id);
}

export async function maybeEscalateWeakConsensusToSabha(input: {
	observer: ChitraguptaObserver | null;
	description: string;
	results: ValidationResult[];
	attempt: number;
	orchestrationConfig?: OrchestrationConfig;
}): Promise<boolean> {
	const approvals = input.results.filter((result) => result.decision === "APPROVE").length;
	const rejections = input.results.filter((result) => result.decision === "REJECT").length;
	if (!shouldEscalateWeakConsensus(approvals, rejections, input.attempt, input.orchestrationConfig?.mesh)) {
		return false;
	}
	return maybeEscalateMeshSabha(
		input.observer,
		`Weak mesh consensus: ${input.description}`,
		`Approvals=${approvals}, rejections=${rejections}, attempt=${input.attempt}`,
	);
}
