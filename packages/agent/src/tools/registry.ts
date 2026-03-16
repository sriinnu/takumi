/**
 * ToolRegistry — manages available tools, validates inputs,
 * and dispatches execution.
 */

import type { PermissionDecision, ToolDefinition, ToolResult } from "@takumi/core";
import { createLogger } from "@takumi/core";
import type { ExperienceMemory } from "../context/experience-memory.js";
import { type RankedTool, rankToolDefinitions, selectToolDefinitions, type ToolSelectionOptions } from "./selection.js";

const log = createLogger("tool-registry");

export type ToolHandler = (input: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult>;
export type ToolPermissionChecker = (
	tool: string,
	input: Record<string, unknown>,
	definition: ToolDefinition,
) => Promise<PermissionDecision>;

interface RegisteredTool {
	definition: ToolDefinition;
	handler: ToolHandler;
}

export class ToolRegistry {
	private tools = new Map<string, RegisteredTool>();
	private permissionChecker: ToolPermissionChecker | null = null;

	/** Register a tool with its definition and handler. */
	register(definition: ToolDefinition, handler: ToolHandler): void {
		if (this.tools.has(definition.name)) {
			log.warn(`Overwriting existing tool: ${definition.name}`);
		}
		this.tools.set(definition.name, { definition, handler });
		log.info(`Registered tool: ${definition.name}`);
	}

	/** Unregister a tool by name. */
	unregister(name: string): boolean {
		return this.tools.delete(name);
	}

	/** Check if a tool is registered. */
	has(name: string): boolean {
		return this.tools.has(name);
	}

	/** Get a tool definition by name. */
	getDefinition(name: string): ToolDefinition | undefined {
		return this.tools.get(name)?.definition;
	}

	/** Get all tool definitions (for building the system prompt). */
	getDefinitions(): ToolDefinition[] {
		return [...this.tools.values()].map((t) => t.definition);
	}

	/** Rank tool definitions for a specific task/query. */
	rankDefinitions(
		query: string,
		options: Omit<ToolSelectionOptions, "experienceMemory"> & { experienceMemory?: ExperienceMemory } = {},
	): RankedTool[] {
		return rankToolDefinitions(this.getDefinitions(), query, options);
	}

	/** Select a working subset of tools for a specific task/query. */
	selectDefinitions(
		query: string,
		options: Omit<ToolSelectionOptions, "experienceMemory"> & { experienceMemory?: ExperienceMemory } = {},
	): ToolDefinition[] {
		return selectToolDefinitions(this.getDefinitions(), query, options);
	}

	/** List all registered tool names. */
	listNames(): string[] {
		return [...this.tools.keys()];
	}

	/** Configure a permission checker for tools that require explicit approval. */
	setPermissionChecker(checker: ToolPermissionChecker | null): void {
		this.permissionChecker = checker;
	}

	/** Execute a tool by name with the given input. */
	async execute(
		name: string,
		input: Record<string, unknown>,
		signal?: AbortSignal,
		options?: { permissionChecked?: boolean },
	): Promise<ToolResult> {
		const tool = this.tools.get(name);
		if (!tool) {
			return {
				output: `Unknown tool: ${name}. Available tools: ${this.listNames().join(", ")}`,
				isError: true,
			};
		}

		log.info(`Executing tool: ${name}`, { input: summarizeInput(input) });

		if (tool.definition.requiresPermission && !options?.permissionChecked) {
			const decision = this.permissionChecker
				? await this.permissionChecker(name, input, tool.definition)
				: { allowed: false, reason: `Permission required for tool: ${name}` };
			if (!decision.allowed) {
				log.info(`Tool ${name} blocked by permission gate`, { reason: decision.reason ?? "denied" });
				return {
					output: decision.reason ?? `Permission denied for tool: ${name}`,
					isError: true,
				};
			}
		}

		try {
			const result = await tool.handler(input, signal);
			log.info(`Tool ${name} completed`, {
				isError: result.isError,
				outputLength: result.output.length,
			});
			return result;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log.error(`Tool ${name} failed: ${message}`);
			return {
				output: `Tool execution error: ${message}`,
				isError: true,
			};
		}
	}

	/** Get count of registered tools. */
	get size(): number {
		return this.tools.size;
	}
}

/** Summarize tool input for logging (avoid logging file contents). */
function summarizeInput(input: Record<string, unknown>): Record<string, unknown> {
	const summary: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		if (typeof value === "string" && value.length > 200) {
			summary[key] = `<${value.length} chars>`;
		} else {
			summary[key] = value;
		}
	}
	return summary;
}
