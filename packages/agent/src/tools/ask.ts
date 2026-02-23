/**
 * Ask tool — prompts the user for input or confirmation.
 * The TUI layer handles the actual user interaction; this tool
 * emits an event that the TUI catches and resolves.
 */

import type { ToolDefinition } from "@takumi/core";
import type { ToolHandler } from "./registry.js";

export const askDefinition: ToolDefinition = {
	name: "ask",
	description:
		"Ask the user a question and wait for their response. " +
		"Use this when you need clarification, confirmation, or additional information. " +
		"The question will be displayed in the TUI and the user can type a response.",
	inputSchema: {
		type: "object",
		properties: {
			question: { type: "string", description: "The question to ask the user" },
		},
		required: ["question"],
	},
	requiresPermission: false,
	category: "interact",
};

/**
 * Create an ask handler that uses the provided callback to get user input.
 * The callback is supplied by the TUI layer.
 */
export function createAskHandler(getUserInput: (question: string) => Promise<string>): ToolHandler {
	return async (input) => {
		const question = input.question as string;

		if (!question) {
			return { output: "Error: question is required", isError: true };
		}

		try {
			const response = await getUserInput(question);
			return { output: response, isError: false };
		} catch (err) {
			return {
				output: `Failed to get user input: ${(err as Error).message}`,
				isError: true,
			};
		}
	};
}
