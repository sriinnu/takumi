/**
 * Convention file loader — Phase 45
 *
 * Loads well-known convention files from `.takumi/` that customize agent
 * behavior without writing full extensions:
 *
 * - `.takumi/system-prompt.md`  — appended to the system prompt
 * - `.takumi/tool-rules.json`   — permission overrides for tools
 *
 * These are "zero-config" customization points: drop a file, get behavior.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@takumi/core";
import { buildPackageRuntimeSnapshotFromPaths, type PackageRuntimeSnapshot } from "./package-runtime-snapshot.js";
import { buildSkillsPrompt, type LoadedSkill, loadSkills } from "./skills-loader.js";

const log = createLogger("convention-loader");

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/** A single tool permission rule from `.takumi/tool-rules.json`. */
export interface ToolRule {
	/** Tool name or glob pattern (e.g. "bash", "write", "edit_*"). */
	tool: string;
	/** Whether the tool requires explicit user permission. */
	requiresPermission: boolean;
	/** Optional reason shown when permission is requested. */
	reason?: string;
}

/** Result of loading convention files. */
export interface ConventionFiles {
	/** Extra system prompt text from `.takumi/system-prompt.md`. */
	systemPromptAddon: string | null;
	/** Tool permission rules from `.takumi/tool-rules.json`. */
	toolRules: ToolRule[];
	/** Loaded prompt skills from `.takumi/skills/`. */
	skills: LoadedSkill[];
	/** Rendered prompt block describing loaded skills. */
	skillsPromptAddon: string | null;
	/** Paths of files that were successfully loaded. */
	loadedFiles: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Loading
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Load convention files from the project's `.takumi/` directory.
 *
 * Never throws — returns empty defaults if files are missing or malformed.
 */
export function loadConventionFiles(cwd: string, configuredPackagePaths: string[] = []): ConventionFiles {
	const snapshot = buildPackageRuntimeSnapshotFromPaths(cwd, configuredPackagePaths);
	return loadConventionFilesFromSnapshot(snapshot, cwd);
}

/**
 * Load convention files using one already-computed package snapshot.
 */
export function loadConventionFilesFromSnapshot(snapshot: PackageRuntimeSnapshot, cwd = snapshot.cwd): ConventionFiles {
	const result: ConventionFiles = {
		systemPromptAddon: null,
		toolRules: [],
		skills: [],
		skillsPromptAddon: null,
		loadedFiles: [],
	};
	const systemPromptBlocks: string[] = [];

	// ── System prompt addon ─────────────────────────────────────────────────
	for (const promptEntry of snapshot.views.systemPrompts) {
		try {
			const content = readFileSync(promptEntry.path, "utf-8").trim();
			if (content.length === 0) {
				continue;
			}
			systemPromptBlocks.push(`## Package: ${promptEntry.packageName}\n${content}`);
			result.loadedFiles.push(promptEntry.path);
		} catch (err) {
			log.debug(`Failed to read ${promptEntry.path}: ${(err as Error).message}`);
		}
	}
	const promptPath = join(cwd, ".takumi", "system-prompt.md");
	if (existsSync(promptPath)) {
		try {
			const content = readFileSync(promptPath, "utf-8").trim();
			if (content.length > 0) {
				systemPromptBlocks.push(content);
				result.loadedFiles.push(promptPath);
				log.info(`Loaded system prompt addon (${content.length} chars)`);
			}
		} catch (err) {
			log.debug(`Failed to read ${promptPath}: ${(err as Error).message}`);
		}
	}
	result.systemPromptAddon = systemPromptBlocks.length > 0 ? systemPromptBlocks.join("\n\n") : null;

	// ── Tool rules ──────────────────────────────────────────────────────────
	for (const rulesEntry of snapshot.views.toolRules) {
		try {
			const raw = readFileSync(rulesEntry.path, "utf-8");
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) {
				log.warn(`${rulesEntry.path}: expected JSON array, got ${typeof parsed}`);
				continue;
			}
			result.toolRules.push(
				...parsed.filter(
					(rule: unknown): rule is ToolRule =>
						typeof rule === "object" &&
						rule !== null &&
						typeof (rule as ToolRule).tool === "string" &&
						typeof (rule as ToolRule).requiresPermission === "boolean",
				),
			);
			result.loadedFiles.push(rulesEntry.path);
		} catch (err) {
			log.debug(`Failed to parse ${rulesEntry.path}: ${(err as Error).message}`);
		}
	}
	const rulesPath = join(cwd, ".takumi", "tool-rules.json");
	if (existsSync(rulesPath)) {
		try {
			const raw = readFileSync(rulesPath, "utf-8");
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				result.toolRules.push(
					...parsed.filter(
						(r: unknown): r is ToolRule =>
							typeof r === "object" &&
							r !== null &&
							typeof (r as ToolRule).tool === "string" &&
							typeof (r as ToolRule).requiresPermission === "boolean",
					),
				);
				result.loadedFiles.push(rulesPath);
				log.info(`Loaded ${result.toolRules.length} tool rules`);
			} else {
				log.warn(`${rulesPath}: expected JSON array, got ${typeof parsed}`);
			}
		} catch (err) {
			log.debug(`Failed to parse ${rulesPath}: ${(err as Error).message}`);
		}
	}

	// ── Skills ──────────────────────────────────────────────────────────────
	const loadedSkills = loadSkills(cwd, snapshot.views.skillRoots);
	result.skills = loadedSkills.skills;
	result.skillsPromptAddon = buildSkillsPrompt(loadedSkills.skills);
	result.loadedFiles.push(...loadedSkills.loadedFiles);
	for (const error of snapshot.report.errors) {
		log.debug(`Package discovery skipped ${error.path}: ${error.error}`);
	}
	if (loadedSkills.skills.length > 0) {
		log.info(`Loaded ${loadedSkills.skills.length} skill prompt(s)`);
	}

	return result;
}
