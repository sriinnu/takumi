import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
	DEFAULT_SIDE_AGENT_REGISTRY_DIR,
	inspectPersistedSideAgentRegistry,
	resolveSideAgentRegistryPath,
	type SideAgentRegistrySnapshot,
} from "./side-agent-registry-io.js";

export type SideAgentRegistryRepairMode = "noop_missing" | "noop_clean" | "rewritten_normalized" | "rewritten_reset";

/**
 * I keep repair results structured so CLI commands and diagnostics can explain
 * exactly what changed without reparsing formatted text.
 */
export interface SideAgentRegistryRepairResult {
	registryPath: string;
	backupPath: string | null;
	mode: SideAgentRegistryRepairMode;
	changed: boolean;
	totalEntries: number;
	writtenEntries: number;
	removedEntries: number;
	normalizedEntries: number;
	malformedEntries: number;
	summary: string;
}

/**
 * I perform an explicit, operator-driven repair pass over the persisted
 * side-agent registry. I never run during normal bootstrap.
 */
export async function repairPersistedSideAgentRegistry(
	baseDir = DEFAULT_SIDE_AGENT_REGISTRY_DIR,
): Promise<SideAgentRegistryRepairResult> {
	const registryPath = resolveSideAgentRegistryPath(baseDir);
	let raw: string;
	try {
		raw = await readFile(registryPath, "utf-8");
	} catch (error) {
		const code = typeof error === "object" && error && "code" in error ? String(error.code) : null;
		if (code === "ENOENT") {
			return {
				registryPath,
				backupPath: null,
				mode: "noop_missing",
				changed: false,
				totalEntries: 0,
				writtenEntries: 0,
				removedEntries: 0,
				normalizedEntries: 0,
				malformedEntries: 0,
				summary: "Registry file is absent; nothing to repair.",
			};
		}
		throw new Error(
			`Failed to read side-agent registry for repair: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const snapshot = await inspectPersistedSideAgentRegistry(baseDir);
	if (snapshot.readError) {
		throw new Error(`Failed to inspect side-agent registry for repair: ${snapshot.readError}`);
	}
	if (snapshot.parseError) {
		return rewriteCorruptRegistry(snapshot, raw);
	}
	if (
		snapshot.totalEntries === snapshot.agents.length &&
		snapshot.normalizedEntries === 0 &&
		snapshot.malformedEntries === 0
	) {
		return {
			registryPath,
			backupPath: null,
			mode: "noop_clean",
			changed: false,
			totalEntries: snapshot.totalEntries,
			writtenEntries: snapshot.agents.length,
			removedEntries: 0,
			normalizedEntries: 0,
			malformedEntries: 0,
			summary: "Registry is already clean; no rewrite was needed.",
		};
	}

	const nextContent = JSON.stringify(snapshot.agents, null, "\t");
	const backupPath = await backupRegistryFile(snapshot.registryPath, raw);
	await writeFile(snapshot.registryPath, nextContent, "utf-8");
	const removedEntries = snapshot.totalEntries - snapshot.agents.length;
	return {
		registryPath: snapshot.registryPath,
		backupPath,
		mode: "rewritten_normalized",
		changed: true,
		totalEntries: snapshot.totalEntries,
		writtenEntries: snapshot.agents.length,
		removedEntries,
		normalizedEntries: snapshot.normalizedEntries,
		malformedEntries: snapshot.malformedEntries,
		summary: `Rewrote the registry with ${snapshot.agents.length} retained entr${snapshot.agents.length === 1 ? "y" : "ies"} after removing ${removedEntries} malformed, duplicate, or unrecoverable row${removedEntries === 1 ? "" : "s"}.`,
	};
}

async function rewriteCorruptRegistry(
	snapshot: SideAgentRegistrySnapshot,
	raw: string,
): Promise<SideAgentRegistryRepairResult> {
	const backupPath = await backupRegistryFile(snapshot.registryPath, raw);
	await mkdir(dirname(snapshot.registryPath), { recursive: true });
	await writeFile(snapshot.registryPath, "[]", "utf-8");
	return {
		registryPath: snapshot.registryPath,
		backupPath,
		mode: "rewritten_reset",
		changed: true,
		totalEntries: 0,
		writtenEntries: 0,
		removedEntries: 0,
		normalizedEntries: 0,
		malformedEntries: 0,
		summary: "Backed up the unreadable registry and reset it to an empty array so bootstrap can start cleanly.",
	};
}

async function backupRegistryFile(registryPath: string, raw: string): Promise<string> {
	const directory = dirname(registryPath);
	const stem = basename(registryPath, ".json");
	const backupPath = join(directory, `${stem}.backup-${Date.now()}.json`);
	await mkdir(directory, { recursive: true });
	await writeFile(backupPath, raw, "utf-8");
	return backupPath;
}
