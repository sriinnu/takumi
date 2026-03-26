import { access } from "node:fs/promises";
import {
	inspectPersistedSideAgentRegistry,
	repairPersistedSideAgentRegistry,
	type SideAgentRegistryRepairResult,
	type SideAgentRegistrySnapshot,
} from "@takumi/agent";
import type { TakumiConfig } from "@takumi/core";
import { resolveSideAgentStateDir } from "./side-agent-tools.js";

export type SideAgentsAction = "inspect" | "repair";
export type SideAgentRegistryStatus = "absent" | "clean" | "needs_repair" | "blocked";

/**
 * I keep the inspect surface structured so JSON callers and human operators get
 * the same truth without scraping ANSI output.
 */
export interface SideAgentRegistryInspectReport {
	action: "inspect";
	workspace: string;
	registryPath: string;
	status: SideAgentRegistryStatus;
	exists: boolean;
	totalEntries: number;
	retainedEntries: number;
	normalizedEntries: number;
	malformedEntries: number;
	repairSuggested: boolean;
	summary: string;
	readError?: string;
	parseError?: string;
}

export interface SideAgentRegistryRepairReport {
	action: "repair";
	workspace: string;
	result: SideAgentRegistryRepairResult;
}

export function buildSideAgentRegistryInspectReport(
	workspace: string,
	snapshot: SideAgentRegistrySnapshot,
	exists: boolean,
): SideAgentRegistryInspectReport {
	if (snapshot.readError) {
		return {
			action: "inspect",
			workspace,
			registryPath: snapshot.registryPath,
			status: "blocked",
			exists,
			totalEntries: snapshot.totalEntries,
			retainedEntries: snapshot.agents.length,
			normalizedEntries: snapshot.normalizedEntries,
			malformedEntries: snapshot.malformedEntries,
			repairSuggested: false,
			summary: "Registry could not be read from disk.",
			readError: snapshot.readError,
		};
	}
	if (snapshot.parseError) {
		return {
			action: "inspect",
			workspace,
			registryPath: snapshot.registryPath,
			status: "needs_repair",
			exists,
			totalEntries: snapshot.totalEntries,
			retainedEntries: snapshot.agents.length,
			normalizedEntries: snapshot.normalizedEntries,
			malformedEntries: snapshot.malformedEntries,
			repairSuggested: true,
			summary: "Registry is unreadable and needs an explicit repair rewrite.",
			parseError: snapshot.parseError,
		};
	}
	if (!exists) {
		return {
			action: "inspect",
			workspace,
			registryPath: snapshot.registryPath,
			status: "absent",
			exists: false,
			totalEntries: 0,
			retainedEntries: 0,
			normalizedEntries: 0,
			malformedEntries: 0,
			repairSuggested: false,
			summary: "Registry file does not exist yet.",
		};
	}
	const needsRepair = snapshot.normalizedEntries > 0 || snapshot.malformedEntries > 0 || snapshot.totalEntries !== snapshot.agents.length;
	return {
		action: "inspect",
		workspace,
		registryPath: snapshot.registryPath,
		status: needsRepair ? "needs_repair" : "clean",
		exists,
		totalEntries: snapshot.totalEntries,
		retainedEntries: snapshot.agents.length,
		normalizedEntries: snapshot.normalizedEntries,
		malformedEntries: snapshot.malformedEntries,
		repairSuggested: needsRepair,
		summary: needsRepair
			? "Registry contains malformed, duplicate, or normalized rows and should be rewritten explicitly."
			: "Registry is internally consistent.",
	};
}

export function formatSideAgentRegistryInspectReport(report: SideAgentRegistryInspectReport): string {
	const lines = [
		"Takumi Side Agents — INSPECT",
		"",
		`Workspace:          ${report.workspace}`,
		`Registry:           ${report.registryPath}`,
		`Status:             ${report.status}`,
		`Entries:            ${report.totalEntries} total · ${report.retainedEntries} retained · ${report.normalizedEntries} normalized · ${report.malformedEntries} malformed`,
		`Repair suggested:   ${report.repairSuggested ? "yes" : "no"}`,
		`Summary:            ${report.summary}`,
	];
	if (report.readError) {
		lines.push(`Read error:         ${report.readError}`);
	}
	if (report.parseError) {
		lines.push(`Parse error:        ${report.parseError}`);
	}
	if (report.repairSuggested) {
		lines.push("Next step:          takumi side-agents repair");
	}
	return lines.join("\n");
}

export function formatSideAgentRegistryRepairReport(report: SideAgentRegistryRepairReport): string {
	const { result } = report;
	const lines = [
		"Takumi Side Agents — REPAIR",
		"",
		`Workspace:          ${report.workspace}`,
		`Registry:           ${result.registryPath}`,
		`Mode:               ${result.mode}`,
		`Changed:            ${result.changed ? "yes" : "no"}`,
		`Entries:            ${result.totalEntries} input · ${result.writtenEntries} written · ${result.removedEntries} removed`,
		`Normalized rows:    ${result.normalizedEntries}`,
		`Malformed rows:     ${result.malformedEntries}`,
		`Summary:            ${result.summary}`,
	];
	if (result.backupPath) {
		lines.push(`Backup:             ${result.backupPath}`);
	}
	return lines.join("\n");
}

export async function cmdSideAgents(
	_config: TakumiConfig,
	action: string,
	asJson = false,
	cwd = process.cwd(),
): Promise<void> {
	if (action !== "inspect" && action !== "repair") {
		throw new Error(`Unsupported side-agent action "${action}". Use "inspect" or "repair".`);
	}
	const baseDir = resolveSideAgentStateDir(cwd);
	if (action === "inspect") {
		const snapshot = await inspectPersistedSideAgentRegistry(baseDir);
		const exists = await fileExists(snapshot.registryPath);
		const report = buildSideAgentRegistryInspectReport(cwd, snapshot, exists);
		if (asJson) {
			console.log(JSON.stringify(report, null, 2));
			return;
		}
		console.log(formatSideAgentRegistryInspectReport(report));
		return;
	}

	const report: SideAgentRegistryRepairReport = {
		action: "repair",
		workspace: cwd,
		result: await repairPersistedSideAgentRegistry(baseDir),
	};
	if (asJson) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}
	console.log(formatSideAgentRegistryRepairReport(report));
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
