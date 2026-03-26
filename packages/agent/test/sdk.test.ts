import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMessageSpy, directCtor, openaiCtor, geminiCtor } = vi.hoisted(() => {
	const sendMessageSpy = vi.fn(async () => undefined);

	const directCtor = vi.fn(function DirectProvider(this: { sendMessage: typeof sendMessageSpy }) {
		this.sendMessage = sendMessageSpy;
	});
	const openaiCtor = vi.fn(function OpenAIProvider(this: { sendMessage: typeof sendMessageSpy }) {
		this.sendMessage = sendMessageSpy;
	});
	const geminiCtor = vi.fn(function GeminiProvider(this: { sendMessage: typeof sendMessageSpy }) {
		this.sendMessage = sendMessageSpy;
	});

	return { sendMessageSpy, directCtor, openaiCtor, geminiCtor };
});

vi.mock("../src/providers/direct.js", () => ({
	DirectProvider: directCtor,
}));

vi.mock("../src/providers/openai.js", () => ({
	OpenAIProvider: openaiCtor,
}));

vi.mock("../src/providers/gemini.js", () => ({
	GeminiProvider: geminiCtor,
}));

vi.mock("../src/loop.js", () => ({
	agentLoop: vi.fn(
		(_message: string, _history: unknown[], options: { sendMessage: (...args: unknown[]) => unknown }) => {
			options.sendMessage([], "system");
			return (async function* () {
				yield { type: "done", stopReason: "end_turn" };
			})();
		},
	),
}));

import { createSession } from "../src/sdk.js";

describe("createSession provider instantiation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("does not construct the provider until the first send", () => {
		createSession({
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
			apiKey: "test-key",
		});

		expect(directCtor).not.toHaveBeenCalled();
		expect(openaiCtor).not.toHaveBeenCalled();
		expect(geminiCtor).not.toHaveBeenCalled();
	});

	it("constructs the provider on first send and reuses it", async () => {
		const session = createSession({
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
			apiKey: "test-key",
		});

		for await (const _event of session.send("hello")) {
			// consume stream
		}
		for await (const _event of session.send("again")) {
			// consume stream
		}

		expect(directCtor).toHaveBeenCalledTimes(1);
		expect(sendMessageSpy).toHaveBeenCalledTimes(2);
	});
});
