import { bootstrapChitraguptaForExec, type ExecBootstrapResult, type ToolRegistry } from "@takumi/agent";
import type { ExecBootstrapSnapshot, TakumiConfig } from "@takumi/core";
import { collectFastProviderStatus, type FastProviderStatus } from "./cli-auth.js";
import { buildDegradedLocalModeStatus, type DegradedLocalModeStatus } from "./degraded-local-mode.js";
import { deriveStartupProviderTruth } from "./startup-provider-truth.js";
import {
	probeSideAgentBootstrap,
	registerOptionalSideAgentTools,
	type SideAgentBootstrapStatus,
} from "./side-agent-tools.js";

export interface RuntimeBootstrapOptions {
	cwd?: string;
	tools?: ToolRegistry;
	enableChitraguptaBootstrap?: boolean;
	includeProviderStatus?: boolean;
	bootstrapMode?: "interactive" | "exec" | "doctor";
	runtimeRole?: "core" | "side-agent-worker";
	consumer?: string;
	capability?: string;
}

export interface RuntimeBootstrapResult {
	cwd: string;
	sideAgents: SideAgentBootstrapStatus;
	chitragupta: ExecBootstrapResult | null;
	providerStatuses: FastProviderStatus[];
	degradedLocalMode: DegradedLocalModeStatus | null;
	bootstrap: ExecBootstrapSnapshot;
	warningLines: string[];
}

function buildUnrequestedChitraguptaBootstrap(): ExecBootstrapResult {
	return {
		bridge: null,
		connected: false,
		degraded: false,
		transport: "unavailable",
		memoryEntries: 0,
		vasanaCount: 0,
		hasHealth: false,
		summary: "bootstrap not requested",
		memoryContext: "",
	};
}

function buildBootstrapSnapshot(
	chitragupta: ExecBootstrapResult,
	sideAgents: SideAgentBootstrapStatus,
	degradedLocalMode: DegradedLocalModeStatus | null,
	warnings: string[],
): ExecBootstrapSnapshot {
	return {
		connected: chitragupta.connected,
		degraded: chitragupta.degraded || sideAgents.degraded,
		transport: chitragupta.transport,
		memoryEntries: chitragupta.memoryEntries,
		vasanaCount: chitragupta.vasanaCount,
		hasHealth: chitragupta.hasHealth,
		summary: chitragupta.summary,
		warnings: warnings.length > 0 ? warnings : undefined,
		sideAgents: {
			enabled: sideAgents.enabled,
			degraded: sideAgents.degraded,
			reason: sideAgents.reason,
			summary: sideAgents.summary,
			detail: sideAgents.detail,
		},
		localFallback: degradedLocalMode
			? {
				active: degradedLocalMode.active,
				providerCount: degradedLocalMode.providerCount,
				currentTarget: degradedLocalMode.currentTarget,
				summary: degradedLocalMode.summary,
			}
			: undefined,
		error: chitragupta.error,
	};
}

function buildBootstrapWarnings(
	sideAgents: SideAgentBootstrapStatus,
	chitragupta: ExecBootstrapResult,
	enableChitraguptaBootstrap: boolean,
	degradedLocalMode: DegradedLocalModeStatus | null,
): string[] {
	const lines = [...(chitragupta.warnings ?? [])];
	if (sideAgents.degraded) {
		lines.push(`Side agents: ${sideAgents.summary}`);
	}
	if (enableChitraguptaBootstrap && chitragupta.degraded) {
		lines.push(`Chitragupta: ${chitragupta.summary}`);
	}
	if (degradedLocalMode?.active) {
		lines.push(degradedLocalMode.summary);
	}
	return lines;
}

function buildWorkerSideAgentBootstrapStatus(): SideAgentBootstrapStatus {
	return {
		enabled: false,
		degraded: false,
		reason: "worker_runtime",
		summary: "disabled inside a side-agent worker",
		detail: "The core runtime owns side-agent orchestration; worker lanes never bootstrap lane infrastructure.",
	};
}

/**
 * I collect the runtime bootstrap truth once so interactive, doctor, and
 * headless entrypoints can stay aligned on readiness, degradation, and the
 * operator-facing warning text.
 */
export async function collectRuntimeBootstrap(
	config: TakumiConfig,
	options: RuntimeBootstrapOptions = {},
): Promise<RuntimeBootstrapResult> {
	const cwd = options.cwd ?? process.cwd();
	const sideAgentPromise =
		options.runtimeRole === "side-agent-worker"
			? Promise.resolve(buildWorkerSideAgentBootstrapStatus())
			: options.tools
				? registerOptionalSideAgentTools(options.tools, config, cwd)
				: probeSideAgentBootstrap(config, cwd);
	const chitraguptaPromise = options.enableChitraguptaBootstrap
		? bootstrapChitraguptaForExec({
				cwd,
				mode: options.bootstrapMode ?? "exec",
				consumer: options.consumer ?? "takumi",
				capability: options.capability,
				configuredProvider: config.provider,
				configuredModel: config.model,
				agentLabel: options.bootstrapMode === "interactive" ? "takumi" : "takumi.exec",
			})
		: Promise.resolve(buildUnrequestedChitraguptaBootstrap());
	const providerStatusPromise = options.includeProviderStatus
		? collectFastProviderStatus().catch(() => [])
		: Promise.resolve([] as FastProviderStatus[]);
	const [sideAgents, chitragupta, providerStatuses] = await Promise.all([
		sideAgentPromise,
		chitraguptaPromise,
		providerStatusPromise,
	]);
	const authoritativeProviderStatuses = deriveStartupProviderTruth(
		{},
		providerStatuses,
		chitragupta.bootstrapResult,
	).providerStatuses;
	const degradedLocalMode = buildDegradedLocalModeStatus({
		chitraguptaDegraded: Boolean(options.enableChitraguptaBootstrap && chitragupta.degraded),
		currentProvider: config.provider,
		currentModel: config.model,
		providerStatuses: authoritativeProviderStatuses,
	});
	const dedupedWarningLines = Array.from(
		new Set(
			buildBootstrapWarnings(
				sideAgents,
				chitragupta,
				Boolean(options.enableChitraguptaBootstrap),
				degradedLocalMode,
			),
		),
	);

	return {
		cwd,
		sideAgents,
		chitragupta: options.enableChitraguptaBootstrap ? chitragupta : null,
		providerStatuses: authoritativeProviderStatuses,
		degradedLocalMode,
		bootstrap: buildBootstrapSnapshot(chitragupta, sideAgents, degradedLocalMode, dedupedWarningLines),
		warningLines: dedupedWarningLines,
	};
}
