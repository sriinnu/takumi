import type { CapabilityDescriptor, CapabilityHealthSnapshot, CapabilityHealthState } from "./control-plane.js";
import { TAKUMI_EXEC_PARENT_CONTRACT } from "./takumi-exec-contract.js";

export interface BuildTakumiCapabilityHealthOptions {
	state?: CapabilityHealthState;
	reason?: string;
	errorRate?: number;
	p50LatencyMs?: number;
	p95LatencyMs?: number;
	throttleRate?: number;
	authFailures?: number;
	lastSuccessAt?: number;
	lastFailureAt?: number;
}

export const TAKUMI_CAPABILITY: CapabilityDescriptor = {
	id: "adapter.takumi.executor",
	kind: "adapter",
	label: "Takumi Coding Executor",
	capabilities: ["coding.patch-and-validate", "coding.review.strict", "agent.delegate.takumi"],
	costClass: "medium",
	trust: "privileged",
	health: "healthy",
	invocation: {
		id: "takumi-agent-loop",
		transport: "local-process",
		entrypoint: `${TAKUMI_EXEC_PARENT_CONTRACT.binaryEnv || "TAKUMI_EXEC_BIN"}|takumi exec --headless --stream=ndjson`,
		requestShape: "TakumiExecRequest",
		responseShape: `${TAKUMI_EXEC_PARENT_CONTRACT.protocol} envelopes`,
		timeoutMs: TAKUMI_EXEC_PARENT_CONTRACT.timeoutMs,
		streaming: true,
	},
	tags: ["coding", "executor", "verification", "privileged"],
	providerFamily: "takumi",
	metadata: {
		runtime: "takumi",
		adapter: true,
		execProtocol: TAKUMI_EXEC_PARENT_CONTRACT.protocol,
		execSchemaVersion: TAKUMI_EXEC_PARENT_CONTRACT.schemaVersion,
		execBinaryCandidates: [...TAKUMI_EXEC_PARENT_CONTRACT.binaryCandidates],
	},
};

export function buildTakumiCapabilityHealth(
	options: BuildTakumiCapabilityHealthOptions = {},
): CapabilityHealthSnapshot {
	const state = options.state ?? "unknown";
	return {
		capabilityId: TAKUMI_CAPABILITY.id,
		state,
		errorRate: options.errorRate ?? defaultErrorRate(state),
		p50LatencyMs: options.p50LatencyMs,
		p95LatencyMs: options.p95LatencyMs,
		throttleRate: options.throttleRate,
		authFailures: options.authFailures,
		lastSuccessAt: options.lastSuccessAt,
		lastFailureAt: options.lastFailureAt,
		reason: options.reason,
	};
}

function defaultErrorRate(state: CapabilityHealthState): number {
	switch (state) {
		case "healthy":
			return 0;
		case "degraded":
			return 0.25;
		case "unknown":
			return 0.5;
		case "down":
			return 1;
	}
}
