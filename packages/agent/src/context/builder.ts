/**
 * Context builder -- assembles the system prompt from project context,
 * soul data, tool definitions, and user instructions.
 *
 * Two APIs:
 *   1. buildContext()       -- async, auto-detects project + loads soul (original)
 *   2. buildSystemPrompt()  -- sync, takes pre-gathered options (new, richer)
 */

import type { ToolDefinition } from "@takumi/core";
import { buildSystemPrompt as buildBaseSystemPrompt } from "../message.js";
import { truncateToTokenBudget } from "./budget.js";
import { detectProject, type ProjectContext } from "./project.js";
import { formatSoulPrompt, loadSoul, type SoulData } from "./soul.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ContextOptions {
	/** Working directory. */
	cwd: string;

	/** Available tools. */
	tools: ToolDefinition[];

	/** Additional system prompt text from config. */
	customPrompt?: string;
}

export interface SystemPromptOptions {
	/** Available tools. */
	tools: ToolDefinition[];

	/** Personality, preferences, identity. */
	soul?: SoulData;

	/** Detected project context. */
	projectContext?: ProjectContext;

	/** User-provided custom instructions. */
	customInstructions?: string;

	/** Model identifier (for model-specific tuning). */
	model?: string;

	/** Maximum tokens for the system prompt (truncates if exceeded). */
	maxTokens?: number;

	/** RAG context from codebase indexer (injected between project context and instructions). */
	ragContext?: string;
}

// ── Default identity ─────────────────────────────────────────────────────────

const DEFAULT_IDENTITY = [
	"You are Takumi, an AI coding assistant running in a terminal.",
	"You help users with software development tasks by reading, writing, and editing code.",
	"You are precise, thorough, and careful with the user's codebase.",
].join("\n");

// ── Default guidelines ───────────────────────────────────────────────────────

const DEFAULT_GUIDELINES = [
	"- Be concise and direct in your responses.",
	"- Use tools to accomplish tasks rather than just describing what to do.",
	"- When editing files, prefer making targeted edits over rewriting entire files.",
	"- Always verify your changes work by reading the result.",
	"- When searching for code, start broad and narrow down.",
	"- For file operations, always use absolute paths.",
	"- Confirm before performing destructive operations (deleting files, force-pushing, resetting git state).",
	"- Never commit secrets, credentials, or API keys.",
	"- Prefer reading existing files before creating new ones.",
].join("\n");

// ── buildSystemPrompt (new rich API) ─────────────────────────────────────────

/**
 * Build a rich system prompt from pre-gathered options.
 *
 * Sections (in order):
 *   1. Identity -- from soul data or defaults
 *   2. Capabilities -- tool list with descriptions
 *   3. Project Context -- language, framework, conventions
 *   4. Instructions -- behavioral guidelines
 *   5. Custom -- user-provided instructions
 *   6. Environment -- platform, date, cwd
 */
export function buildSystemPrompt(options: SystemPromptOptions): string {
	const { tools, soul, projectContext, customInstructions, model, maxTokens } = options;
	// ragContext is accessed via options.ragContext below

	const sections: string[] = [];

	// ── 1. Identity ──────────────────────────────────────────────────────────

	sections.push("# Identity\n");

	if (soul?.identity) {
		sections.push(soul.identity);
	} else {
		sections.push(DEFAULT_IDENTITY);
	}

	if (soul?.personality) {
		sections.push("");
		sections.push(soul.personality);
	}

	// ── 2. Capabilities (tools) ──────────────────────────────────────────────

	if (tools.length > 0) {
		sections.push("");
		sections.push("# Available Tools\n");

		for (const tool of tools) {
			sections.push(`## ${tool.name}`);
			sections.push(tool.description);
			sections.push(`Category: ${tool.category}`);
			if (tool.requiresPermission) {
				sections.push("Requires user permission before execution.");
			}
			sections.push("");
		}
	}

	// ── 3. Project Context ───────────────────────────────────────────────────

	if (projectContext) {
		sections.push("# Project Context\n");

		const meta: string[] = [];
		if (projectContext.name) {
			meta.push(`Project: ${projectContext.name}`);
		}
		if (projectContext.path) {
			meta.push(`Path: ${projectContext.path}`);
		}
		if (projectContext.language) {
			meta.push(`Language: ${projectContext.language}`);
		}
		if (projectContext.framework) {
			meta.push(`Framework: ${projectContext.framework}`);
		}
		if (projectContext.packageManager) {
			meta.push(`Package manager: ${projectContext.packageManager}`);
		}
		if (projectContext.gitBranch) {
			meta.push(`Git branch: ${projectContext.gitBranch}`);
		}
		if (meta.length > 0) {
			sections.push(meta.join("\n"));
		}

		if (projectContext.recentFiles && projectContext.recentFiles.length > 0) {
			sections.push("");
			sections.push("Recently modified files:");
			for (const f of projectContext.recentFiles.slice(0, 15)) {
				sections.push(`- ${f}`);
			}
		}

		if (projectContext.conventions) {
			sections.push("");
			sections.push("## Coding Conventions\n");
			sections.push(projectContext.conventions);
		}
	}

	// ── 3b. RAG Context ─────────────────────────────────────────────────────

	if (options.ragContext) {
		sections.push("");
		sections.push(options.ragContext);
	}

	// ── 4. Instructions (guidelines) ─────────────────────────────────────────

	sections.push("");
	sections.push("# Instructions\n");
	sections.push(DEFAULT_GUIDELINES);

	if (soul?.preferences) {
		sections.push("");
		sections.push("## User Preferences\n");
		sections.push(soul.preferences);
	}

	// ── 5. Custom instructions ───────────────────────────────────────────────

	if (customInstructions) {
		sections.push("");
		sections.push("# Custom Instructions\n");
		sections.push(customInstructions);
	}

	// ── 6. Environment ───────────────────────────────────────────────────────

	sections.push("");
	sections.push("# Environment\n");
	const envLines: string[] = [];
	if (projectContext?.path) {
		envLines.push(`Working directory: ${projectContext.path}`);
	}
	envLines.push(`Platform: ${process.platform}`);
	envLines.push(`Date: ${new Date().toISOString().slice(0, 10)}`);
	if (model) {
		envLines.push(`Model: ${model}`);
	}
	sections.push(envLines.join("\n"));

	let result = sections.join("\n");

	// Truncate if a max token budget was given
	if (maxTokens && maxTokens > 0) {
		result = truncateToTokenBudget(result, maxTokens);
	}

	return result;
}

// ── buildContext (original async API, preserved for compatibility) ────────────

/**
 * Build the complete system prompt including project context.
 * This is the original async API that auto-detects project info and loads soul.
 */
export async function buildContext(options: ContextOptions): Promise<string> {
	const { cwd, tools, customPrompt } = options;

	const parts: string[] = [];

	// Base system prompt with tools
	parts.push(buildBaseSystemPrompt(tools));

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
