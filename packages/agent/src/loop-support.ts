import type { Message, ToolDefinition, ToolResult } from "@takumi/core";
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

export interface EnrichedSystemPromptOptions {
	toolDefs: ToolDefinition[];
	userMessage: string;
	basePrompt?: string;
	memoryHooks?: MemoryHooks;
	principleMemory?: PrincipleMemory;
	ragContext?: string;
}

export function buildEnrichedSystemPrompt(opts: EnrichedSystemPromptOptions): string {
	let system = opts.basePrompt ?? buildSystemPrompt(opts.toolDefs);
	if (opts.ragContext) {
		system = `${system}\n\n${opts.ragContext}`;
	}
	if (opts.memoryHooks) {
		const lessons = opts.memoryHooks.recall(opts.userMessage, 5);
		const lessonBlock = opts.memoryHooks.formatForPrompt(lessons);
		if (lessonBlock) {
			system = `${system}\n\n${lessonBlock}`;
		}
	}
	if (opts.principleMemory) {
		const principles = opts.principleMemory.recall(opts.userMessage, 5);
		const principleBlock = opts.principleMemory.formatForPrompt(principles);
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

/** Convert MessagePayload[] to core Message[] for extension context events. */
export function payloadToCore(messages: MessagePayload[]): Message[] {
	return messages.map((m, i) => ({
		id: `turn-${i}`,
		role: m.role,
		content: Array.isArray(m.content)
			? m.content.map(blockToCore)
			: [{ type: "text" as const, text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
		timestamp: Date.now(),
	}));
}

function blockToCore(block: unknown): Message["content"][number] {
	if (typeof block === "string") return { type: "text", text: block };
	if (!block || typeof block !== "object") return { type: "text", text: "" };
	const b = block as Record<string, unknown>;
	if (b.type === "text") return { type: "text", text: (b.text as string) ?? "" };
	if (b.type === "thinking") return { type: "thinking", thinking: (b.thinking as string) ?? "" };
	if (b.type === "tool_use") {
		return {
			type: "tool_use",
			id: (b.id as string) ?? "",
			name: (b.name as string) ?? "",
			input: (b.input as Record<string, unknown>) ?? {},
		};
	}
	if (b.type === "tool_result") {
		return {
			type: "tool_result",
			toolUseId: (b.tool_use_id as string) ?? (b.toolUseId as string) ?? "",
			content: (b.content as string) ?? (b.text as string) ?? "",
			isError: (b.is_error as boolean) ?? (b.isError as boolean) ?? false,
		};
	}
	if (b.type === "image") {
		return {
			type: "image",
			mediaType: typeof b.mediaType === "string" ? b.mediaType : "image/png",
			data: typeof b.data === "string" ? b.data : "",
		};
	}
	return { type: "text", text: typeof b.text === "string" ? b.text : "" };
}

/** Convert core Message[] back to MessagePayload[]. */
export function coreToPayload(msg: Message): MessagePayload {
	return { role: msg.role, content: msg.content as MessagePayload["content"] };
}

/**
 * Record end-of-turn memory observations: memoryHooks success signal and
 * principleMemory turn recording. Extracted here so loop.ts stays under the
 * 450-line production file limit.
 *
 * Not called on preempted turns — aborted tool results are not meaningful
 * learning signals.
 */
export function recordTurnObservations(
	memoryHooks: MemoryHooks | undefined,
	principleMemory: PrincipleMemory | undefined,
	userText: string,
	toolResults: Array<{ name: string; result: ToolResult }>,
	tools: ToolRegistry,
	finalResponse: string,
): void {
	if (memoryHooks && toolResults.every((e) => !e.result.isError)) {
		memoryHooks.observeSuccess(
			userText,
			toolResults.map((e) => e.name),
		);
	}
	if (principleMemory) {
		const toolCategories = toolResults
			.map((e) => tools.getDefinition(e.name)?.category)
			.filter((cat): cat is NonNullable<ToolDefinition["category"]> => cat !== undefined);
		principleMemory.observeTurn({
			request: userText,
			toolNames: toolResults.map((e) => e.name),
			toolCategories,
			hadError: toolResults.some((e) => e.result.isError),
			finalResponse,
		});
	}
}
