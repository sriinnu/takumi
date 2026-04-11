import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveConfigDir } from "./platform-detect.js";

export type TakumiConfigPathKind = "project-local" | "project-root" | "legacy-home" | "user-global";

export interface TakumiConfigPathEntry {
	path: string;
	kind: TakumiConfigPathKind;
	exists: boolean;
}

export function getProjectTakumiConfigPaths(cwd = process.cwd()): string[] {
	return dedupePaths([join(cwd, ".takumi", "config.json"), join(cwd, "takumi.config.json")]);
}

export function getGlobalTakumiConfigPaths(): string[] {
	return dedupePaths([join(homedir(), ".takumi", "config.json"), join(resolveConfigDir(), "config.json")]);
}

export function getTakumiConfigSearchPaths(cwd = process.cwd()): string[] {
	return dedupePaths([...getProjectTakumiConfigPaths(cwd), ...getGlobalTakumiConfigPaths()]);
}

export function inspectTakumiConfigPaths(cwd = process.cwd()): {
	activePath: string | null;
	defaultGlobalPath: string;
	defaultProjectPath: string;
	searchPaths: TakumiConfigPathEntry[];
} {
	const projectPaths = getProjectTakumiConfigPaths(cwd);
	const globalPaths = getGlobalTakumiConfigPaths();
	const searchPaths = dedupeEntries([
		{ path: projectPaths[0]!, kind: "project-local" as const },
		{ path: projectPaths[1]!, kind: "project-root" as const },
		{ path: globalPaths[0]!, kind: "legacy-home" as const },
		{ path: globalPaths[1]!, kind: "user-global" as const },
	]).map((entry) => ({
		...entry,
		exists: existsSync(entry.path),
	}));

	const activePath = searchPaths.find((entry) => entry.exists)?.path ?? null;

	return {
		activePath,
		defaultGlobalPath: globalPaths[globalPaths.length - 1]!,
		defaultProjectPath: projectPaths[0]!,
		searchPaths,
	};
}

export function findExistingTakumiConfigPath(paths: readonly string[]): string | null {
	for (const filePath of paths) {
		if (existsSync(filePath)) {
			return filePath;
		}
	}
	return null;
}

function dedupePaths(paths: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const filePath of paths) {
		if (!filePath || seen.has(filePath)) continue;
		seen.add(filePath);
		result.push(filePath);
	}
	return result;
}

function dedupeEntries(entries: ReadonlyArray<{ path: string; kind: TakumiConfigPathKind }>): Array<{
	path: string;
	kind: TakumiConfigPathKind;
}> {
	const seen = new Set<string>();
	const result: Array<{ path: string; kind: TakumiConfigPathKind }> = [];
	for (const entry of entries) {
		if (!entry.path || seen.has(entry.path)) continue;
		seen.add(entry.path);
		result.push(entry);
	}
	return result;
}
