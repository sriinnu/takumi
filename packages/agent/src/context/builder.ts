/**
 * Context builder — assembles the system prompt from project context,
 * user instructions, and tool definitions.
 */

import type { ToolDefinition } from "@takumi/core";
import { buildSystemPrompt } from "../message.js";
import { detectProject, type ProjectInfo } from "./project.js";
import { loadSoul, formatSoulPrompt } from "./soul.js";

export interface ContextOptions {
	/** Working directory. */
	cwd: string;

	/** Available tools. */
	tools: ToolDefinition[];

	/** Additional system prompt text from config. */
	customPrompt?: string;
}

/**
 * Build the complete system prompt including project context.
 */
export async function buildContext(options: ContextOptions): Promise<string> {
	const { cwd, tools, customPrompt } = options;

	const parts: string[] = [];

	// Base system prompt with tools
	parts.push(buildSystemPrompt(tools));

	// Project context
	const project = await detectProject(cwd);
	if (project) {
		parts.push("");
		parts.push("## Project Context");
		parts.push("");

		if (project.name) {
			parts.push(`Project: ${project.name}`);
		}

		if (project.gitBranch) {
			parts.push(`Git branch: ${project.gitBranch}`);
		}

		if (project.instructions) {
			parts.push("");
			parts.push("## Project Instructions");
			parts.push(project.instructions);
		}
	}

	// Soul data (personality, preferences, identity)
	const soul = loadSoul(project?.root ?? cwd);
	const soulPrompt = formatSoulPrompt(soul);
	if (soulPrompt) {
		parts.push("");
		parts.push(soulPrompt);
	}

	// Custom prompt from config
	if (customPrompt) {
		parts.push("");
		parts.push("## User Instructions");
		parts.push(customPrompt);
	}

	// Environment info
	parts.push("");
	parts.push("## Environment");
	parts.push(`Working directory: ${cwd}`);
	parts.push(`Platform: ${process.platform}`);
	parts.push(`Node: ${process.version}`);
	parts.push(`Date: ${new Date().toISOString().slice(0, 10)}`);

	return parts.join("\n");
}
