import type { CliAdapterContract } from "./cli-adapter-contract.js";
import type { CapabilityDescriptor, CapabilityHealthSnapshot, CapabilityHealthState } from "./control-plane.js";
import { TAKUMI_CAPABILITY } from "./takumi-capability.js";

export interface BuildCliCapabilityOptions {
	id: string;
	label: string;
	providerFamily: string;
	capabilities: string[];
	costClass: CapabilityDescriptor["costClass"];
	trust?: CapabilityDescriptor["trust"];
	health?: CapabilityDescriptor["health"];
	tags?: string[];
	priority?: number;
	contract: CliAdapterContract;
	metadata?: Record<string, unknown>;
}

export interface BuildCliCapabilityHealthOptions {
	capabilityId: string;
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

export interface DefaultLocalCodingCapabilitiesOptions {
	includeTakumi?: boolean;
	includeCliPresets?: boolean;
	extraCapabilities?: CapabilityDescriptor[];
}

export function buildCliCapability(options: BuildCliCapabilityOptions): CapabilityDescriptor {
	return {
		id: options.id,
		kind: "cli",
		label: options.label,
		capabilities: options.capabilities,
		costClass: options.costClass,
		trust: options.trust ?? "local",
		health: options.health ?? "healthy",
		invocation: {
			id: `${options.providerFamily}-cli-adapter`,
			transport: options.contract.transport,
			entrypoint: `${options.contract.binaryEnv ?? options.contract.binaryCandidates[0]}|${options.contract.binaryCandidates.join("|")}`,
			requestShape: "CliAdapterRequest",
			responseShape: options.contract.stdoutProtocol,
			timeoutMs: options.contract.timeoutMs,
			streaming: options.contract.stdoutProtocol === "ndjson" || options.contract.stdoutProtocol === "line-json",
		},
		tags: options.tags ?? ["cli", "coding", options.providerFamily],
		priority: options.priority,
		providerFamily: options.providerFamily,
		metadata: {
			adapter: true,
			contractId: options.contract.id,
			stdoutProtocol: options.contract.stdoutProtocol,
			stderrMode: options.contract.stderrMode,
			binaryCandidates: [...options.contract.binaryCandidates],
			...options.metadata,
		},
	};
}

export function buildCliCapabilityHealth(options: BuildCliCapabilityHealthOptions): CapabilityHealthSnapshot {
	const state = options.state ?? "unknown";
	return {
		capabilityId: options.capabilityId,
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

export const CLAUDE_CLI_CONTRACT: CliAdapterContract = {
	id: "agent.delegate.cli-claude",
	transport: "local-process",
	binaryEnv: "CLAUDE_EXEC_BIN",
	binaryCandidates: ["claude"],
	stdoutProtocol: "text",
	stderrMode: "diagnostic-text",
	timeoutMs: 60_000,
	workingDirectoryFromRequest: true,
	retry: {
		maxAttempts: 1,
		retryOnTransportFailure: false,
		nonRetryableExitCodes: [64, 78],
	},
	metadata: {
		interactive: true,
	},
};

export const CODEX_CLI_CONTRACT: CliAdapterContract = {
	id: "agent.delegate.cli-codex",
	transport: "local-process",
	binaryEnv: "CODEX_EXEC_BIN",
	binaryCandidates: ["codex"],
	stdoutProtocol: "text",
	stderrMode: "diagnostic-text",
	timeoutMs: 60_000,
	workingDirectoryFromRequest: true,
	retry: {
		maxAttempts: 1,
		retryOnTransportFailure: false,
		nonRetryableExitCodes: [64, 78],
	},
};

export const AIDER_CLI_CONTRACT: CliAdapterContract = {
	id: "agent.delegate.cli-aider",
	transport: "local-process",
	binaryEnv: "AIDER_EXEC_BIN",
	binaryCandidates: ["aider"],
	stdoutProtocol: "text",
	stderrMode: "diagnostic-text",
	timeoutMs: 90_000,
	workingDirectoryFromRequest: true,
	retry: {
		maxAttempts: 1,
		retryOnTransportFailure: false,
		nonRetryableExitCodes: [64, 78],
	},
};

export const CLAUDE_CLI_CAPABILITY = buildCliCapability({
	id: "cli.claude",
	label: "Claude CLI Executor",
	providerFamily: "anthropic",
	capabilities: ["coding.fast-local", "coding.patch-cheap", "coding.review.strict", "agent.delegate.cli-claude"],
	costClass: "low",
	priority: 10,
	contract: CLAUDE_CLI_CONTRACT,
	tags: ["cli", "coding", "anthropic", "local"],
});

export const CODEX_CLI_CAPABILITY = buildCliCapability({
	id: "cli.codex",
	label: "Codex CLI Executor",
	providerFamily: "openai",
	capabilities: ["coding.fast-local", "coding.patch-cheap", "coding.review.strict", "agent.delegate.cli-codex"],
	costClass: "low",
	// I give Codex the highest default local CLI priority so engine routing and local
	// fallback presets converge on the same executor preference.
	priority: 20,
	contract: CODEX_CLI_CONTRACT,
	tags: ["cli", "coding", "openai", "local"],
});

export const AIDER_CLI_CAPABILITY = buildCliCapability({
	id: "cli.aider",
	label: "Aider CLI Executor",
	providerFamily: "aider",
	capabilities: ["coding.fast-local", "coding.patch-cheap", "agent.delegate.cli-aider"],
	costClass: "low",
	contract: AIDER_CLI_CONTRACT,
	tags: ["cli", "coding", "aider", "local"],
});

export const DEFAULT_CLI_CAPABILITIES: CapabilityDescriptor[] = [
	CODEX_CLI_CAPABILITY,
	CLAUDE_CLI_CAPABILITY,
	AIDER_CLI_CAPABILITY,
];

export function getDefaultLocalCodingCapabilities(
	options: DefaultLocalCodingCapabilitiesOptions = {},
): CapabilityDescriptor[] {
	const capabilities: CapabilityDescriptor[] = [];

	if (options.includeTakumi ?? true) {
		capabilities.push(TAKUMI_CAPABILITY);
	}

	if (options.includeCliPresets ?? true) {
		capabilities.push(...DEFAULT_CLI_CAPABILITIES);
	}

	if (options.extraCapabilities?.length) {
		capabilities.push(...options.extraCapabilities);
	}

	return dedupeCapabilities(capabilities);
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

function dedupeCapabilities(capabilities: CapabilityDescriptor[]): CapabilityDescriptor[] {
	const seen = new Set<string>();
	return capabilities.filter((capability) => {
		if (seen.has(capability.id)) {
			return false;
		}
		seen.add(capability.id);
		return true;
	});
}
