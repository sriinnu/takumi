import type { Message } from "@takumi/core";

/** Format messages as a Markdown document suitable for /export. */
export function formatMessagesAsMarkdown(messages: Message[], sessionId: string, model: string): string {
	const date = new Date().toISOString().slice(0, 10);
	const lines: string[] = [`# Takumi Session: ${sessionId}`, `Date: ${date}`, `Model: ${model}`, "", "---", ""];

	for (const msg of messages) {
		const role = msg.role === "user" ? "User" : "Assistant";
		lines.push(`## ${role}`, "");
		for (const block of msg.content) {
			switch (block.type) {
				case "text":
					lines.push(block.text, "");
					break;
				case "thinking":
					lines.push("<details><summary>Thinking</summary>", "", block.thinking, "", "</details>", "");
					break;
				case "tool_use":
					lines.push(
						`### Tool: ${block.name} (${block.id})`,
						"",
						"```json",
						JSON.stringify(block.input, null, 2),
						"```",
						"",
					);
					break;
				case "tool_result":
					lines.push(`### Tool Result (${block.toolUseId})`, "", "```", block.content, "```", "");
					break;
				case "image":
					lines.push(`[Image: ${block.mediaType}]`, "");
					break;
			}
		}
		lines.push("---", "");
	}

	return lines.join("\n");
}
