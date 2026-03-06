import type { ToolDefinition } from "@takumi/core";
import type { ExperienceMemory } from "./context/experience-memory.js";
import type { MemoryHooks } from "./context/memory-hooks.js";
import type { PrincipleMemory } from "./context/principles.js";
import type { ExtensionRunner } from "./extensions/extension-runner.js";
import type { MessagePayload } from "./loop.js";
import { buildSystemPrompt } from "./message.js";
import type { ToolRegistry } from "./tools/registry.js";

export function mergeExtensionTools(tools: ToolRegistry, extensionRunner?: ExtensionRunner): void {
	if (!extensionRunner) {
		return;
	}

	for (const [name, { tool }] of extensionRunner.getAllTools()) {
		if (!tools.has(name)) {
			tools.register(
				{
					name: tool.name,
					description: tool.description,
					inputSchema: tool.inputSchema,
					requiresPermission: tool.requiresPermission,
					category: tool.category,
				},
				async (args, signal) => {
					const ctx = extensionRunner.createContext();
					return tool.execute(args, signal, ctx);
				},
			);
		}
	}
}

export function buildEnrichedSystemPrompt(
	toolDefs: ToolDefinition[],
	userMessage: string,
	basePrompt?: string,
	memoryHooks?: MemoryHooks,
	principleMemory?: PrincipleMemory,
): string {
	let system = basePrompt ?? buildSystemPrompt(toolDefs);
	if (memoryHooks) {
		const lessons = memoryHooks.recall(userMessage, 5);
		const lessonBlock = memoryHooks.formatForPrompt(lessons);
		if (lessonBlock) {
			system = `${system}\n\n${lessonBlock}`;
		}
	}
	if (principleMemory) {
		const principles = principleMemory.recall(userMessage, 5);
		const principleBlock = principleMemory.formatForPrompt(principles);
		if (principleBlock) {
			system = `${system}\n\n${principleBlock}`;
		}
	}
	return system;
}

export function selectTurnTools(
	tools: ToolRegistry,
	userMessage: string,
	messages: MessagePayload[],
	experienceMemory?: ExperienceMemory,
): ToolDefinition[] {
	return tools.selectDefinitions(buildToolSelectionQuery(userMessage, messages), {
		experienceMemory,
		limit: 12,
		alwaysInclude: ["ask"],
	});
}

function buildToolSelectionQuery(userMessage: string, messages: MessagePayload[]): string {
	const recentUserText = messages
		.slice(-4)
		.filter((message) => message.role === "user")
		.flatMap((message) => flattenTextContent(message.content))
		.slice(-3)
		.join(" ")
		.trim();

	return [userMessage, recentUserText].filter(Boolean).join(" ").trim();
}

function flattenTextContent(content: unknown): string[] {
	if (typeof content === "string") {
		return [content];
	}
	if (!Array.isArray(content)) {
		return [];
	}
	return content.flatMap((block) => {
		if (typeof block === "string") {
			return [block];
		}
		if (
			block &&
			typeof block === "object" &&
			"type" in block &&
			block.type === "text" &&
			"text" in block &&
			typeof block.text === "string"
		) {
			return [block.text];
		}
		return [];
	});
}
