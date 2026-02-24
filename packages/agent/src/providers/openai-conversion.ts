import type { MessagePayload } from "../loop.js";

export interface OpenAIMessage {
	role: "system" | "user" | "assistant" | "tool";
	content?: string | null;
	tool_calls?: OpenAIToolCall[];
	tool_call_id?: string;
}

export interface OpenAIToolCall {
	id: string;
	type: "function";
	function: {
		name: string;
		arguments: string;
	};
}

export interface OpenAITool {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

/** Convert Anthropic-format messages to OpenAI messages. */
export function convertMessages(messages: MessagePayload[]): OpenAIMessage[] {
	const result: OpenAIMessage[] = [];

	for (const msg of messages) {
		if (typeof msg.content === "string") {
			result.push({ role: msg.role, content: msg.content });
			continue;
		}

		if (!Array.isArray(msg.content)) {
			result.push({ role: msg.role, content: String(msg.content ?? "") });
			continue;
		}

		const blocks = msg.content as any[];
		const hasToolUse = blocks.some((b) => b.type === "tool_use");
		const hasToolResult = blocks.some((b) => b.type === "tool_result");

		if (hasToolResult) {
			for (const block of blocks) {
				if (block.type === "tool_result") {
					const content =
						typeof block.content === "string"
							? block.content
							: Array.isArray(block.content)
								? block.content.map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n")
								: JSON.stringify(block.content ?? "");
					result.push({ role: "tool", tool_call_id: block.tool_use_id, content });
				} else if (block.type === "text") {
					result.push({ role: "user", content: block.text });
				}
			}
			continue;
		}

		if (hasToolUse) {
			const textParts: string[] = [];
			const toolCalls: OpenAIToolCall[] = [];

			for (const block of blocks) {
				if (block.type === "text") {
					textParts.push(block.text);
				} else if (block.type === "tool_use") {
					toolCalls.push({
						id: block.id,
						type: "function",
						function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
					});
				}
			}

			result.push({
				role: "assistant",
				content: textParts.length > 0 ? textParts.join("\n") : null,
				tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
			});
			continue;
		}

		const texts: string[] = [];
		for (const block of blocks) {
			if (block.type === "text") texts.push(block.text);
			else if (block.type === "thinking") {
				// Skip Anthropic-only thought blocks for OpenAI APIs.
			} else texts.push(JSON.stringify(block));
		}

		result.push({ role: msg.role, content: texts.join("\n") });
	}

	return result;
}

/** Convert Anthropic tool definitions to OpenAI function-calling format. */
export function convertTools(tools: any[]): OpenAITool[] {
	return tools.map((tool) => ({
		type: "function" as const,
		function: {
			name: tool.name,
			description: tool.description ?? "",
			parameters: tool.input_schema ?? tool.inputSchema ?? {},
		},
	}));
}
