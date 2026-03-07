import type { CapabilityDescriptor, CapabilityHealthSnapshot, CapabilityHealthState } from "./control-plane.js";

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
		transport: "inproc",
		entrypoint: "@takumi/agent/loop",
		requestShape: "RoutingRequest + coding session context",
		responseShape: "AgentEvent stream + execution report",
		timeoutMs: 120_000,
		streaming: true,
	},
	tags: ["coding", "executor", "verification", "privileged"],
	providerFamily: "takumi",
	metadata: {
		runtime: "takumi",
		adapter: true,
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
