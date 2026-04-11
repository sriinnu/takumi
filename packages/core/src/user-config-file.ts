import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_CONFIG } from "./config.js";
import {
	findExistingTakumiConfigPath,
	getGlobalTakumiConfigPaths,
	getProjectTakumiConfigPaths,
	inspectTakumiConfigPaths,
	type TakumiConfigPathEntry,
	type TakumiConfigPathKind,
} from "./config-locations.js";
import { IS_LINUX, IS_MACOS, IS_WINDOWS } from "./platform-detect.js";
import type { TakumiConfig } from "./types.js";

export type TakumiConfigFileTarget = "active" | "global" | "project";

export interface TakumiConfigTemplate {
	provider: string;
	model: string;
	theme: TakumiConfig["theme"];
	thinking: boolean;
	thinkingBudget: number;
	maxTokens: number;
	maxTurns: number;
	logLevel: TakumiConfig["logLevel"];
	systemPrompt: string;
}

export interface EnsuredTakumiConfigFile {
	filePath: string;
	created: boolean;
	target: TakumiConfigFileTarget;
}

export interface TakumiConfigInspection {
	activePath: string | null;
	defaultGlobalPath: string;
	defaultProjectPath: string;
	searchPaths: TakumiConfigPathEntry[];
}

interface LaunchCommand {
	command: string;
	args: string[];
}

export function buildTakumiConfigTemplate(): TakumiConfigTemplate {
	return {
		provider: DEFAULT_CONFIG.provider,
		model: DEFAULT_CONFIG.model,
		theme: DEFAULT_CONFIG.theme,
		thinking: DEFAULT_CONFIG.thinking,
		thinkingBudget: DEFAULT_CONFIG.thinkingBudget,
		maxTokens: DEFAULT_CONFIG.maxTokens,
		maxTurns: DEFAULT_CONFIG.maxTurns,
		logLevel: DEFAULT_CONFIG.logLevel,
		systemPrompt: DEFAULT_CONFIG.systemPrompt,
	};
}

export function formatTakumiConfigFile(): string {
	return `${JSON.stringify(buildTakumiConfigTemplate(), null, "\t")}\n`;
}

export function inspectTakumiUserConfig(cwd = process.cwd()): TakumiConfigInspection {
	return inspectTakumiConfigPaths(cwd);
}

export async function ensureTakumiConfigFile(
	target: TakumiConfigFileTarget = "active",
	cwd = process.cwd(),
): Promise<EnsuredTakumiConfigFile> {
	const filePath = resolveTakumiConfigTargetPath(target, cwd);
	try {
		await access(filePath, fsConstants.F_OK);
		return { filePath, created: false, target };
	} catch {
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, formatTakumiConfigFile(), "utf-8");
		return { filePath, created: true, target };
	}
}

export function getTakumiConfigPath(target: TakumiConfigFileTarget = "active", cwd = process.cwd()): string {
	return resolveTakumiConfigTargetPath(target, cwd);
}

export function formatTakumiConfigInspection(inspection: TakumiConfigInspection): string {
	const lines: string[] = [];
	if (inspection.activePath) {
		lines.push(`Active config: ${inspection.activePath}`);
	} else {
		lines.push(`No Takumi config file found. Default global path: ${inspection.defaultGlobalPath}`);
	}

	lines.push("Search order:");
	inspection.searchPaths.forEach((entry, index) => {
		const marker = entry.path === inspection.activePath ? "▶" : entry.exists ? "•" : "○";
		lines.push(`  ${marker} ${index + 1}. ${entry.path} (${formatConfigPathKind(entry.kind)})`);
	});

	return lines.join("\n");
}

export function tryRevealTakumiConfigFile(filePath: string): { opened: boolean; command?: string; error?: string } {
	const launch = resolveRevealCommand(filePath);
	if (!launch) {
		return { opened: false, error: "automatic file reveal is unavailable on this platform" };
	}

	const result = spawnSync(launch.command, launch.args, { stdio: "ignore" });
	if (result.error || (result.status ?? 0) !== 0) {
		const reason = result.error?.message ?? `command exited with status ${result.status ?? "unknown"}`;
		return {
			opened: false,
			command: [launch.command, ...launch.args].join(" "),
			error: reason,
		};
	}

	return {
		opened: true,
		command: [launch.command, ...launch.args].join(" "),
	};
}

function resolveTakumiConfigTargetPath(target: TakumiConfigFileTarget, cwd: string): string {
	const inspection = inspectTakumiConfigPaths(cwd);
	if (target === "project") {
		return findExistingTakumiConfigPath(getProjectTakumiConfigPaths(cwd)) ?? inspection.defaultProjectPath;
	}
	if (target === "global") {
		return findExistingTakumiConfigPath(getGlobalTakumiConfigPaths()) ?? inspection.defaultGlobalPath;
	}
	return inspection.activePath ?? inspection.defaultGlobalPath;
}

function formatConfigPathKind(kind: TakumiConfigPathKind): string {
	switch (kind) {
		case "project-local":
			return "project .takumi/config.json";
		case "project-root":
			return "project takumi.config.json";
		case "legacy-home":
			return "legacy home config";
		case "user-global":
			return "platform user config";
	}
}

function resolveRevealCommand(filePath: string): LaunchCommand | null {
	if (IS_MACOS) {
		return { command: "open", args: [filePath] };
	}
	if (IS_LINUX) {
		return { command: "xdg-open", args: [filePath] };
	}
	if (IS_WINDOWS) {
		return { command: "cmd.exe", args: ["/c", "start", "", filePath] };
	}
	return null;
}
