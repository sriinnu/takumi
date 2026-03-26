import type { Message } from "@takumi/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatMessagesAsMarkdown } from "../src/app.js";
import { SlashCommandRegistry } from "../src/commands.js";
import { AppState } from "../src/state.js";

/* ── Mock fs ───────────────────────────────────────────────────────────────── */

vi.mock("node:fs/promises", () => ({
	writeFile: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockResolvedValue(""),
	readdir: vi.fn(),
	mkdir: vi.fn(),
	unlink: vi.fn(),
}));

import { readFile, writeFile } from "node:fs/promises";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function makeMessage(overrides?: Partial<Message>): Message {
	return {
		id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
		role: "user",
		content: [{ type: "text", text: "hello" }],
		timestamp: Date.now(),
		...overrides,
	};
}

function makeUserMessage(text: string): Message {
	return makeMessage({
		role: "user",
		content: [{ type: "text", text }],
	});
}

function makeAssistantMessage(text: string): Message {
	return makeMessage({
		role: "assistant",
		content: [{ type: "text", text }],
	});
}

function makeToolMessage(): Message {
	return makeMessage({
		role: "assistant",
		content: [
			{
				type: "tool_use",
				id: "tool-1",
				name: "read",
				input: { file_path: "src/app.ts" },
			},
			{
				type: "tool_result",
				toolUseId: "tool-1",
				content: "file contents here",
				isError: false,
			},
			{ type: "text", text: "I read the file." },
		],
	});
}

/**
 * Create a minimal command setup that emulates how TakumiApp registers
 * the /think, /export, and /retry commands, without needing the full app.
 */
function createTestSetup() {
	const state = new AppState();
	const commands = new SlashCommandRegistry();
	const infoMessages: string[] = [];

	const addInfoMessage = (text: string) => {
		const msg: Message = {
			id: `info-${Date.now()}`,
			role: "assistant",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		};
		state.addMessage(msg);
		infoMessages.push(text);
	};

	// Mock agent runner
	const agentRunner = {
		isRunning: false,
		submit: vi.fn().mockResolvedValue(undefined),
		clearHistory: vi.fn(),
	};

	// ── /think ────────────────────────────────────────────────────────────────
	commands.register("/think", "Toggle extended thinking", (args) => {
		if (!args) {
			state.thinking.value = !state.thinking.value;
			const status = state.thinking.value ? "enabled" : "disabled";
			const budgetInfo = state.thinking.value ? ` (budget: ${state.thinkingBudget.value} tokens)` : "";
			addInfoMessage(`Extended thinking ${status}${budgetInfo}`);
			return;
		}

		if (args === "on") {
			state.thinking.value = true;
			addInfoMessage(`Extended thinking enabled (budget: ${state.thinkingBudget.value} tokens)`);
			return;
		}

		if (args === "off") {
			state.thinking.value = false;
			addInfoMessage("Extended thinking disabled");
			return;
		}

		if (args.startsWith("budget ")) {
			const budgetStr = args.slice(7).trim();
			const budget = parseInt(budgetStr, 10);
			if (Number.isNaN(budget) || budget <= 0) {
				addInfoMessage(`Invalid budget: "${budgetStr}" — must be a positive number`);
				return;
			}
			state.thinkingBudget.value = budget;
			addInfoMessage(`Thinking budget set to ${budget} tokens`);
			return;
		}

		addInfoMessage("Usage: /think [on|off|budget <tokens>]");
	});

	// ── /export ───────────────────────────────────────────────────────────────
	commands.register("/export", "Export conversation to file", async (args) => {
		const messages = state.messages.value;
		if (messages.length === 0) {
			addInfoMessage("No messages to export");
			return;
		}

		let format: "md" | "json" | "jsonl" = "md";
		let outputPath = "";

		if (args) {
			const parts = args.trim().split(/\s+/);
			for (const part of parts) {
				if (part === "json") {
					format = "json";
				} else if (part === "jsonl") {
					format = "jsonl";
				} else if (part === "md" || part === "markdown") {
					format = "md";
				} else {
					outputPath = part;
				}
			}
		}

		if (!outputPath) {
			const date = new Date().toISOString().slice(0, 10);
			outputPath = `./takumi-export-${date}.${format}`;
		}

		try {
			let content: string;
			if (format === "json") {
				content = JSON.stringify({ id: state.sessionId.value, messages, model: state.model.value }, null, 2);
			} else if (format === "jsonl") {
				content = [
					JSON.stringify({
						type: "session_meta",
						version: 1,
						session: {
							id: state.sessionId.value,
							title: "Imported session",
							createdAt: 0,
							updatedAt: 0,
							model: state.model.value,
							tokenUsage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
						},
					}),
					...messages.map((message) => JSON.stringify({ type: "message", message })),
				].join("\n");
			} else {
				content = formatMessagesAsMarkdown(messages, state.sessionId.value, state.model.value);
			}

			await (writeFile as unknown as (...args: unknown[]) => Promise<void>)(outputPath, content, "utf-8");
			addInfoMessage(`Session exported to ${outputPath}`);
		} catch (err) {
			addInfoMessage(`Export failed: ${(err as Error).message}`);
		}
	});

	commands.register("/import", "Import Takumi session", async (args) => {
		const inputPath = args.trim();
		if (!inputPath) {
			addInfoMessage("Usage: /import <path-to-session.json|jsonl>");
			return;
		}

		try {
			const raw = String(await (readFile as unknown as (...args: unknown[]) => Promise<string>)(inputPath, "utf-8"));
			let imported: { id: string; messages: Message[]; model: string };
			if (inputPath.endsWith(".jsonl")) {
				const lines = raw.split("\n").filter(Boolean);
				const meta = JSON.parse(lines[0]);
				imported = {
					id: meta.session.id,
					model: meta.session.model,
					messages: lines.slice(1).map((line) => JSON.parse(line).message),
				};
			} else {
				imported = JSON.parse(raw) as { id: string; messages: Message[]; model: string };
			}

			state.sessionId.value = imported.id;
			state.model.value = imported.model;
			state.messages.value = imported.messages;
			addInfoMessage(`Imported session ${imported.id} from ${inputPath}`);
		} catch (err) {
			addInfoMessage(`Import failed: ${(err as Error).message}`);
		}
	});

	// ── /retry ────────────────────────────────────────────────────────────────
	commands.register("/retry", "Retry last response", async (args) => {
		const messages = state.messages.value;
		if (messages.length === 0) {
			addInfoMessage("No messages to retry");
			return;
		}

		if (agentRunner.isRunning) {
			addInfoMessage("Cannot retry while agent is running");
			return;
		}

		let turnIndex: number | undefined;
		if (args) {
			turnIndex = parseInt(args.trim(), 10);
			if (Number.isNaN(turnIndex) || turnIndex < 0) {
				addInfoMessage(`Invalid turn number: "${args.trim()}"`);
				return;
			}
		}

		let lastUserText = "";
		let cutIndex: number;

		if (turnIndex !== undefined) {
			cutIndex = turnIndex;
			if (cutIndex > messages.length) {
				cutIndex = messages.length;
			}
			for (let i = cutIndex - 1; i >= 0; i--) {
				if (messages[i].role === "user") {
					for (const block of messages[i].content) {
						if (block.type === "text") {
							lastUserText = block.text;
							break;
						}
					}
					if (lastUserText) break;
				}
			}
			addInfoMessage(`Retrying from turn ${turnIndex}...`);
		} else {
			cutIndex = messages.length;
			while (cutIndex > 0 && messages[cutIndex - 1].role === "assistant") {
				cutIndex--;
			}
			for (let i = cutIndex - 1; i >= 0; i--) {
				if (messages[i].role === "user") {
					for (const block of messages[i].content) {
						if (block.type === "text") {
							lastUserText = block.text;
							break;
						}
					}
					if (lastUserText) break;
				}
			}
			addInfoMessage("Retrying last response...");
		}

		if (!lastUserText) {
			addInfoMessage("No user message found to retry");
			return;
		}

		state.messages.value = messages.slice(0, cutIndex);
		agentRunner.clearHistory();
		await agentRunner.submit(lastUserText);
	});

	return { state, commands, infoMessages, agentRunner };
}

/* ── Tests ──────────────────────────────────────────────────────────────────── */

describe("/think command", () => {
	let setup: ReturnType<typeof createTestSetup>;

	beforeEach(() => {
		setup = createTestSetup();
	});

	it("toggles thinking on when initially off", async () => {
		const { state, commands, infoMessages } = setup;
		expect(state.thinking.value).toBe(false);

		await commands.execute("/think");

		expect(state.thinking.value).toBe(true);
		expect(infoMessages[0]).toContain("enabled");
	});

	it("toggles thinking off when currently on", async () => {
		const { state, commands, infoMessages } = setup;
		state.thinking.value = true;

		await commands.execute("/think");

		expect(state.thinking.value).toBe(false);
		expect(infoMessages[0]).toContain("disabled");
	});

	it("explicitly enables thinking with 'on'", async () => {
		const { state, commands, infoMessages } = setup;
		expect(state.thinking.value).toBe(false);

		await commands.execute("/think on");

		expect(state.thinking.value).toBe(true);
		expect(infoMessages[0]).toContain("enabled");
	});

	it("explicitly disables thinking with 'off'", async () => {
		const { state, commands, infoMessages } = setup;
		state.thinking.value = true;

		await commands.execute("/think off");

		expect(state.thinking.value).toBe(false);
		expect(infoMessages[0]).toContain("disabled");
	});

	it("sets budget with 'budget' subcommand", async () => {
		const { state, commands, infoMessages } = setup;

		await commands.execute("/think budget 50000");

		expect(state.thinkingBudget.value).toBe(50000);
		expect(infoMessages[0]).toContain("50000");
	});

	it("shows current state when toggling on", async () => {
		const { state, commands, infoMessages } = setup;
		state.thinkingBudget.value = 20000;

		await commands.execute("/think");

		expect(infoMessages[0]).toContain("20000");
	});

	it("rejects NaN budget", async () => {
		const { state, commands, infoMessages } = setup;
		const originalBudget = state.thinkingBudget.value;

		await commands.execute("/think budget abc");

		expect(state.thinkingBudget.value).toBe(originalBudget);
		expect(infoMessages[0]).toContain("Invalid budget");
	});

	it("rejects zero budget", async () => {
		const { commands, infoMessages } = setup;

		await commands.execute("/think budget 0");

		expect(infoMessages[0]).toContain("Invalid budget");
	});

	it("rejects negative budget", async () => {
		const { commands, infoMessages } = setup;

		await commands.execute("/think budget -100");

		expect(infoMessages[0]).toContain("Invalid budget");
	});

	it("shows usage for unknown subcommand", async () => {
		const { commands, infoMessages } = setup;

		await commands.execute("/think foobar");

		expect(infoMessages[0]).toContain("Usage:");
	});

	it("'on' is idempotent when already on", async () => {
		const { state, commands } = setup;
		state.thinking.value = true;

		await commands.execute("/think on");

		expect(state.thinking.value).toBe(true);
	});

	it("'off' is idempotent when already off", async () => {
		const { state, commands } = setup;
		state.thinking.value = false;

		await commands.execute("/think off");

		expect(state.thinking.value).toBe(false);
	});
});

describe("/export command", () => {
	let setup: ReturnType<typeof createTestSetup>;

	beforeEach(() => {
		setup = createTestSetup();
		vi.mocked(writeFile).mockClear();
	});

	it("exports as markdown by default", async () => {
		const { state, commands, infoMessages } = setup;
		state.addMessage(makeUserMessage("hello"));
		state.addMessage(makeAssistantMessage("hi there"));

		await commands.execute("/export");

		expect(writeFile).toHaveBeenCalledOnce();
		const [path, content] = vi.mocked(writeFile).mock.calls[0];
		expect(path).toMatch(/takumi-export-.*\.md$/);
		expect(content).toContain("## User");
		expect(content).toContain("hello");
		expect(content).toContain("## Assistant");
		expect(content).toContain("hi there");
		expect(infoMessages).toHaveLength(1);
		expect(infoMessages[0]).toContain("exported");
	});

	it("exports as JSON when 'json' specified", async () => {
		const { state, commands } = setup;
		state.addMessage(makeUserMessage("hello"));

		await commands.execute("/export json");

		const [path, content] = vi.mocked(writeFile).mock.calls[0];
		expect(path).toMatch(/\.json$/);
		const parsed = JSON.parse(content as string);
		expect(parsed).toHaveProperty("messages");
		expect(Array.isArray(parsed.messages)).toBe(true);
		expect(parsed.messages.length).toBeGreaterThan(0);
	});

	it("exports as JSONL when specified", async () => {
		const { state, commands } = setup;
		state.addMessage(makeUserMessage("hello"));

		await commands.execute("/export jsonl");

		const [path, content] = vi.mocked(writeFile).mock.calls[0];
		expect(path).toMatch(/\.jsonl$/);
		const lines = String(content).split("\n");
		expect(JSON.parse(lines[0]).type).toBe("session_meta");
		expect(JSON.parse(lines[1]).type).toBe("message");
	});

	it("exports as markdown when 'md' specified explicitly", async () => {
		const { state, commands } = setup;
		state.addMessage(makeUserMessage("test"));

		await commands.execute("/export md");

		const [path] = vi.mocked(writeFile).mock.calls[0];
		expect(path).toMatch(/\.md$/);
	});

	it("exports to a custom path", async () => {
		const { state, commands } = setup;
		state.addMessage(makeUserMessage("hello"));

		await commands.execute("/export /tmp/my-export.md");

		const [path] = vi.mocked(writeFile).mock.calls[0];
		expect(path).toBe("/tmp/my-export.md");
	});

	it("handles empty conversation", async () => {
		const { commands, infoMessages } = setup;

		await commands.execute("/export");

		expect(writeFile).not.toHaveBeenCalled();
		expect(infoMessages[0]).toContain("No messages");
	});

	it("messages with tool calls exported correctly in markdown", async () => {
		const { state, commands } = setup;
		state.addMessage(makeUserMessage("read app.ts"));
		state.addMessage(makeToolMessage());

		await commands.execute("/export");

		const [, content] = vi.mocked(writeFile).mock.calls[0];
		expect(content).toContain("### Tool: read");
		expect(content).toContain("### Tool Result");
		expect(content).toContain("file contents here");
	});

	it("messages with tool calls exported correctly in JSON", async () => {
		const { state, commands } = setup;
		state.addMessage(makeUserMessage("read app.ts"));
		state.addMessage(makeToolMessage());

		await commands.execute("/export json");

		const [, content] = vi.mocked(writeFile).mock.calls[0];
		const parsed = JSON.parse(content as string).messages;
		// Second message should have tool_use, tool_result, and text blocks
		const assistantMsg = parsed.find((m: Message) => m.role === "assistant");
		expect(assistantMsg).toBeDefined();
		const types = assistantMsg.content.map((b: { type: string }) => b.type);
		expect(types).toContain("tool_use");
		expect(types).toContain("tool_result");
	});

	it("default filename includes today's date", async () => {
		const { state, commands } = setup;
		state.addMessage(makeUserMessage("test"));
		const today = new Date().toISOString().slice(0, 10);

		await commands.execute("/export");

		const [path] = vi.mocked(writeFile).mock.calls[0];
		expect(path).toContain(today);
	});

	it("reports export failure", async () => {
		const { state, commands, infoMessages } = setup;
		state.addMessage(makeUserMessage("test"));
		vi.mocked(writeFile).mockRejectedValueOnce(new Error("EACCES"));

		await commands.execute("/export");

		expect(infoMessages[0]).toContain("Export failed");
		expect(infoMessages[0]).toContain("EACCES");
	});

	it("includes session header in markdown export", async () => {
		const { state, commands } = setup;
		state.sessionId.value = "session-2026-02-13-abcd";
		state.model.value = "claude-opus-4-20250514";
		state.addMessage(makeUserMessage("test"));

		await commands.execute("/export");

		const [, content] = vi.mocked(writeFile).mock.calls[0];
		expect(content).toContain("# Takumi Session: session-2026-02-13-abcd");
		expect(content).toContain("Model: claude-opus-4-20250514");
	});

	it("exports JSON format with custom path", async () => {
		const { state, commands } = setup;
		state.addMessage(makeUserMessage("hello"));

		await commands.execute("/export json /tmp/conv.json");

		const [path, content] = vi.mocked(writeFile).mock.calls[0];
		expect(path).toBe("/tmp/conv.json");
		const parsed = JSON.parse(content as string);
		expect(Array.isArray(parsed.messages)).toBe(true);
	});

	it("imports a JSONL session into state", async () => {
		const { commands, state, infoMessages } = setup;
		vi.mocked(readFile).mockResolvedValueOnce(
			[
				JSON.stringify({
					type: "session_meta",
					version: 1,
					session: {
						id: "session-imported",
						title: "Imported",
						createdAt: 0,
						updatedAt: 0,
						model: "claude-sonnet-4",
						tokenUsage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
					},
				}),
				JSON.stringify({ type: "message", message: makeUserMessage("restored") }),
			].join("\n"),
		);

		await commands.execute("/import /tmp/session.jsonl");

		expect(state.sessionId.value).toBe("session-imported");
		expect(state.model.value).toBe("claude-sonnet-4");
		expect(state.messages.value.some((msg) => msg.role === "user")).toBe(true);
		expect(infoMessages.at(-1)).toContain("Imported session session-imported");
	});

	it("shows usage when /import has no path", async () => {
		const { commands, infoMessages } = setup;
		await commands.execute("/import");
		expect(infoMessages.at(-1)).toContain("Usage: /import");
	});
});

describe("/retry command", () => {
	let setup: ReturnType<typeof createTestSetup>;

	beforeEach(() => {
		setup = createTestSetup();
	});

	it("removes last assistant message and re-submits", async () => {
		const { state, commands, agentRunner } = setup;
		state.messages.value = [makeUserMessage("explain this code"), makeAssistantMessage("Here is the explanation.")];

		await commands.execute("/retry");

		// Should have removed the assistant message
		const remaining = state.messages.value;
		// The info message is added, and the user message is kept
		const nonInfoMessages = remaining.filter((m) => !m.id.startsWith("info-"));
		expect(nonInfoMessages).toHaveLength(1);
		expect(nonInfoMessages[0].role).toBe("user");
		expect(agentRunner.submit).toHaveBeenCalledWith("explain this code");
		expect(agentRunner.clearHistory).toHaveBeenCalled();
	});

	it("handles retry with turn number", async () => {
		const { state, commands, agentRunner } = setup;
		state.messages.value = [
			makeUserMessage("first question"),
			makeAssistantMessage("first answer"),
			makeUserMessage("second question"),
			makeAssistantMessage("second answer"),
		];

		await commands.execute("/retry 2");

		// Should keep only first 2 messages (index 0 and 1)
		const nonInfoMessages = state.messages.value.filter((m) => !m.id.startsWith("info-"));
		expect(nonInfoMessages).toHaveLength(2);
		expect(agentRunner.submit).toHaveBeenCalledWith("first question");
	});

	it("handles empty conversation", async () => {
		const { commands, agentRunner, infoMessages } = setup;

		await commands.execute("/retry");

		expect(infoMessages[0]).toContain("No messages");
		expect(agentRunner.submit).not.toHaveBeenCalled();
	});

	it("removes tool results along with assistant message", async () => {
		const { state, commands, agentRunner } = setup;
		state.messages.value = [makeUserMessage("read the file"), makeToolMessage()];

		await commands.execute("/retry");

		const nonInfoMessages = state.messages.value.filter((m) => !m.id.startsWith("info-"));
		expect(nonInfoMessages).toHaveLength(1);
		expect(nonInfoMessages[0].role).toBe("user");
		expect(agentRunner.submit).toHaveBeenCalledWith("read the file");
	});

	it("reports error when agent is running", async () => {
		const { state, commands, agentRunner, infoMessages } = setup;
		state.messages.value = [makeUserMessage("test")];
		agentRunner.isRunning = true;

		await commands.execute("/retry");

		expect(infoMessages[0]).toContain("Cannot retry while agent is running");
		expect(agentRunner.submit).not.toHaveBeenCalled();
	});

	it("reports error on invalid turn number", async () => {
		const { state, commands, agentRunner, infoMessages } = setup;
		state.messages.value = [makeUserMessage("test"), makeAssistantMessage("response")];

		await commands.execute("/retry abc");

		expect(infoMessages[0]).toContain("Invalid turn number");
		expect(agentRunner.submit).not.toHaveBeenCalled();
	});

	it("handles no user message found to retry", async () => {
		const { state, commands, agentRunner, infoMessages } = setup;
		// Only assistant messages (edge case)
		state.messages.value = [makeAssistantMessage("orphan response")];

		await commands.execute("/retry");

		// The assistant message gets removed, but there's no user message to re-submit
		expect(infoMessages).toContain("No user message found to retry");
		expect(agentRunner.submit).not.toHaveBeenCalled();
	});

	it("messages state is updated correctly after retry", async () => {
		const { state, commands } = setup;
		const userMsg = makeUserMessage("hello");
		const assistantMsg = makeAssistantMessage("world");
		state.messages.value = [userMsg, assistantMsg];

		await commands.execute("/retry");

		const nonInfoMessages = state.messages.value.filter((m) => !m.id.startsWith("info-"));
		expect(nonInfoMessages).toHaveLength(1);
		expect(nonInfoMessages[0].id).toBe(userMsg.id);
	});

	it("removes multiple consecutive assistant messages", async () => {
		const { state, commands, agentRunner } = setup;
		state.messages.value = [
			makeUserMessage("question"),
			makeAssistantMessage("answer part 1"),
			makeAssistantMessage("answer part 2"),
		];

		await commands.execute("/retry");

		const nonInfoMessages = state.messages.value.filter((m) => !m.id.startsWith("info-"));
		expect(nonInfoMessages).toHaveLength(1);
		expect(nonInfoMessages[0].role).toBe("user");
		expect(agentRunner.submit).toHaveBeenCalledWith("question");
	});

	it("retry from turn 0 removes all messages", async () => {
		const { state, commands, agentRunner, infoMessages } = setup;
		state.messages.value = [makeUserMessage("hello"), makeAssistantMessage("world")];

		await commands.execute("/retry 0");

		// No user message found before cut point 0
		expect(infoMessages).toContain("No user message found to retry");
		expect(agentRunner.submit).not.toHaveBeenCalled();
	});

	it("retry with turn number larger than message count does not crash", async () => {
		const { state, commands, agentRunner } = setup;
		state.messages.value = [makeUserMessage("hello"), makeAssistantMessage("world")];

		await commands.execute("/retry 100");

		// Should find the user message and resubmit
		expect(agentRunner.submit).toHaveBeenCalledWith("hello");
	});

	it("clears agent history before resubmitting", async () => {
		const { state, commands, agentRunner } = setup;
		state.messages.value = [makeUserMessage("test"), makeAssistantMessage("response")];

		await commands.execute("/retry");

		// clearHistory should be called before submit
		const clearOrder = agentRunner.clearHistory.mock.invocationCallOrder[0];
		const submitOrder = agentRunner.submit.mock.invocationCallOrder[0];
		expect(clearOrder).toBeLessThan(submitOrder);
	});
});

describe("formatMessagesAsMarkdown", () => {
	it("produces valid markdown header", () => {
		const messages: Message[] = [makeUserMessage("hi")];
		const md = formatMessagesAsMarkdown(messages, "session-123", "claude-opus");

		expect(md).toContain("# Takumi Session: session-123");
		expect(md).toContain("Model: claude-opus");
		expect(md).toContain("---");
	});

	it("formats user and assistant messages with role headings", () => {
		const messages: Message[] = [makeUserMessage("question"), makeAssistantMessage("answer")];
		const md = formatMessagesAsMarkdown(messages, "s1", "m1");

		expect(md).toContain("## User");
		expect(md).toContain("question");
		expect(md).toContain("## Assistant");
		expect(md).toContain("answer");
	});

	it("includes thinking blocks in details tags", () => {
		const messages: Message[] = [
			makeMessage({
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "let me think about this..." },
					{ type: "text", text: "Here is my answer." },
				],
			}),
		];
		const md = formatMessagesAsMarkdown(messages, "s1", "m1");

		expect(md).toContain("<details><summary>Thinking</summary>");
		expect(md).toContain("let me think about this...");
		expect(md).toContain("</details>");
	});

	it("formats tool use blocks", () => {
		const messages: Message[] = [makeToolMessage()];
		const md = formatMessagesAsMarkdown(messages, "s1", "m1");

		expect(md).toContain("### Tool: read (tool-1)");
		expect(md).toContain("file_path");
		expect(md).toContain("src/app.ts");
	});

	it("returns empty content section for empty messages", () => {
		const md = formatMessagesAsMarkdown([], "s1", "m1");
		expect(md).toContain("# Takumi Session: s1");
		// No User/Assistant sections
		expect(md).not.toContain("## User");
		expect(md).not.toContain("## Assistant");
	});
});
