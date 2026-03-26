import { bootstrapChitraguptaForExec, type ExecBootstrapResult, type ToolRegistry } from "@takumi/agent";
import type { ExecBootstrapSnapshot, TakumiConfig } from "@takumi/core";
import {
	probeSideAgentBootstrap,
	registerOptionalSideAgentTools,
	type SideAgentBootstrapStatus,
} from "./side-agent-tools.js";

export interface RuntimeBootstrapOptions {
	cwd?: string;
	tools?: ToolRegistry;
	enableChitraguptaBootstrap?: boolean;
}

export interface RuntimeBootstrapResult {
	cwd: string;
	sideAgents: SideAgentBootstrapStatus;
	chitragupta: ExecBootstrapResult | null;
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
): ExecBootstrapSnapshot {
	return {
		connected: chitragupta.connected,
		degraded: chitragupta.degraded || sideAgents.degraded,
		transport: chitragupta.transport,
		memoryEntries: chitragupta.memoryEntries,
		vasanaCount: chitragupta.vasanaCount,
		hasHealth: chitragupta.hasHealth,
		summary: chitragupta.summary,
		sideAgents: {
			enabled: sideAgents.enabled,
			degraded: sideAgents.degraded,
			reason: sideAgents.reason,
			summary: sideAgents.summary,
			detail: sideAgents.detail,
		},
		error: chitragupta.error,
	};
}

function buildBootstrapWarnings(
	sideAgents: SideAgentBootstrapStatus,
	chitragupta: ExecBootstrapResult,
	enableChitraguptaBootstrap: boolean,
): string[] {
	const lines: string[] = [];
	if (sideAgents.degraded) {
		lines.push(`Side agents: ${sideAgents.summary}`);
	}
	if (enableChitraguptaBootstrap && chitragupta.degraded) {
		lines.push(`Chitragupta: ${chitragupta.summary}`);
	}
	return lines;
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
	const sideAgentPromise = options.tools
		? registerOptionalSideAgentTools(options.tools, config, cwd)
		: probeSideAgentBootstrap(config, cwd);
	const chitraguptaPromise = options.enableChitraguptaBootstrap
		? bootstrapChitraguptaForExec({ cwd })
		: Promise.resolve(buildUnrequestedChitraguptaBootstrap());
	const [sideAgents, chitragupta] = await Promise.all([sideAgentPromise, chitraguptaPromise]);

	return {
		cwd,
		sideAgents,
		chitragupta: options.enableChitraguptaBootstrap ? chitragupta : null,
		bootstrap: buildBootstrapSnapshot(chitragupta, sideAgents),
		warningLines: buildBootstrapWarnings(sideAgents, chitragupta, Boolean(options.enableChitraguptaBootstrap)),
	};
}
