import type { ToolDefinition } from "@takumi/core";
import type { ExperienceMemory } from "./experience-memory.js";

export function buildStrategyPrompt(
	userText: string,
	tools: ToolDefinition[],
	memory: ExperienceMemory,
): string | null {
	const ranked = memory.rankTools(tools, userText);
	const lines: string[] = [
		"## Strategy-Guided Loop",
		"1. Start with a short plan before the first tool call.",
		"2. Gather evidence before editing unless the request is purely generative.",
		"3. Re-check assumptions after each tool result and adapt instead of tunneling.",
		"4. End with a concrete verification step for every changed artifact.",
	];

	if (ranked.length > 0) {
		lines.push("Recommended tools for this turn:");
		for (const entry of ranked.slice(0, 3)) {
			lines.push(`- ${entry.name}: ${entry.reason}`);
		}
	}

	if (memory.archiveCount === 0 && memory.runtimeCount === 0) {
		lines.push("No prior indexed experience yet — treat this as a fresh planning pass.");
	}

	return lines.join("\n");
}
