import { buildUserMessage, type ExperienceMemory, type MessagePayload } from "@takumi/agent";
import type { ToolDefinition } from "@takumi/core";

/** Estimate token usage for the current transcript plus the pending user submit. */
export function estimatePromptHistoryTokens(options: {
	history: MessagePayload[];
	text: string;
	images?: Array<{ mediaType: string; data: string }>;
}): number {
	return estimateHistoryTokens([
		...options.history,
		{ role: "user", content: buildUserMessage(options.text, options.images) },
	]);
}

/** Build dynamic tool-routing hints from ranked experience memory entries. */
export function renderToolRoutingHints(text: string, tools: ToolDefinition[], memory: ExperienceMemory): string {
	const ranked = memory
		.rankTools(tools, text)
		.filter((entry) => entry.score > 0)
		.slice(0, 3);
	if (ranked.length === 0) {
		return "";
	}

	return [
		"## Dynamic Tool Ranking",
		...ranked.map((entry, index) => `${index + 1}. ${entry.name} — ${entry.reason}`),
	].join("\n");
}

/** Summarize tool arguments for operator-visible tool-spinner labels. */
export function summarizeToolArgs(toolName: string, input: Record<string, unknown>): string {
	switch (toolName) {
		case "bash":
		case "execute": {
			const cmd = input.command ?? input.cmd ?? "";
			return String(cmd);
		}
		case "read":
		case "write":
		case "edit": {
			const path = input.file_path ?? input.path ?? input.filename ?? "";
			return String(path);
		}
		case "glob":
		case "grep": {
			const pattern = input.pattern ?? input.query ?? "";
			return String(pattern);
		}
		default: {
			for (const value of Object.values(input)) {
				if (typeof value === "string" && value.length > 0) {
					return value;
				}
			}
			return "";
		}
	}
}

function estimateHistoryTokens(messages: MessagePayload[]): number {
	let chars = 0;
	for (const message of messages) {
		const content = message.content;
		if (typeof content === "string") {
			chars += content.length;
			continue;
		}
		if (!Array.isArray(content)) {
			chars += JSON.stringify(content ?? "").length;
			continue;
		}
		for (const block of content) {
			if (typeof block === "string") {
				chars += block.length;
				continue;
			}
			if (!block || typeof block !== "object") {
				continue;
			}
			if ("text" in block && typeof block.text === "string") chars += block.text.length;
			if ("thinking" in block && typeof block.thinking === "string") chars += block.thinking.length;
			if ("content" in block && typeof block.content === "string") chars += block.content.length;
			if ("input" in block && block.input !== undefined) chars += JSON.stringify(block.input).length;
			if ("source" in block && block.source !== undefined) chars += JSON.stringify(block.source).length;
		}
	}
	return Math.ceil(chars / 4);
}
