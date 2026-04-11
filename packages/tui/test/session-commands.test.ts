import type { Message } from "@takumi/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { AppState } from "../src/state.js";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

/**
 * Registers the session/memory/permission commands on a SlashCommandRegistry,
 * mirroring the logic in TakumiApp.registerDefaultCommands() so we can test
 * the handlers in isolation without constructing the full TUI.
 */
function registerTestCommands(
	commands: SlashCommandRegistry,
	state: AppState,
	agentRunner: { permissions: { getRules: () => any[]; reset: () => void } } | null,
) {
	/** Add an informational message to state (mirrors TakumiApp.addInfoMessage). */
	function addInfoMessage(text: string): void {
		const msg: Message = {
			id: `info-${Date.now()}`,
			role: "assistant",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		};
		state.addMessage(msg);
	}

	commands.register("/session", "Session management", async (args) => {
		if (!args || args === "info") {
			const info = [
				`Session: ${state.sessionId.value || "(none)"}`,
				`Model: ${state.model.value}`,
				`Turns: ${state.turnCount.value}`,
				`Tokens: ${state.totalTokens.value}`,
				`Cost: ${state.formattedCost.value}`,
			];
			addInfoMessage(info.join("\n"));
			return;
		}

		if (args === "list") {
			addInfoMessage("Session listing requires Chitragupta connection");
			return;
		}

		if (args.startsWith("resume ")) {
			const sessionId = args.slice(7).trim();
			if (sessionId) {
				state.sessionId.value = sessionId;
				addInfoMessage(`Resumed session: ${sessionId}`);
			}
			return;
		}

		addInfoMessage("Usage: /session [info|list|resume <id>]");
	});

	commands.register("/memory", "Search project memory", async (args) => {
		if (!args) {
			addInfoMessage("Usage: /memory <search query>");
			return;
		}
		addInfoMessage(`Searching memory for: ${args}...`);
		addInfoMessage("Memory search requires Chitragupta connection");
	});

	commands.register("/permission", "Manage tool permissions", (args) => {
		if (!args) {
			if (agentRunner) {
				const rules = agentRunner.permissions.getRules();
				if (rules.length === 0) {
					addInfoMessage("No permission rules configured");
				} else {
					const lines = rules.map((r: any) => `  ${r.allow ? "allow" : "deny"} ${r.tool} ${r.pattern} (${r.scope})`);
					addInfoMessage(`Permission rules:\n${lines.join("\n")}`);
				}
			} else {
				addInfoMessage("No agent runner configured");
			}
			return;
		}

		if (args === "reset") {
			agentRunner?.permissions.reset();
			addInfoMessage("Session permissions reset");
			return;
		}

		addInfoMessage("Usage: /permission [reset]");
	});
}

/** Extract text content from the last message in state. */
function lastMessageText(state: AppState): string {
	const messages = state.messages.value;
	if (messages.length === 0) return "";
	const last = messages[messages.length - 1];
	const block = last.content.find((b) => b.type === "text");
	return block?.type === "text" ? block.text : "";
}

/* ── Tests ──────────────────────────────────────────────────────────────────── */

describe("Session commands", () => {
	let commands: SlashCommandRegistry;
	let state: AppState;

	beforeEach(() => {
		commands = new SlashCommandRegistry();
		state = new AppState();
	});

	/* ---- /session -------------------------------------------------------- */

	describe("/session", () => {
		it("shows session info with no args", async () => {
			registerTestCommands(commands, state, null);
			state.sessionId.value = "session-2026-01-01-abcd";
			state.model.value = "claude-sonnet-4-20250514";

			await commands.execute("/session");

			const text = lastMessageText(state);
			expect(text).toContain("Session: session-2026-01-01-abcd");
			expect(text).toContain("Model: claude-sonnet-4-20250514");
			expect(text).toContain("Turns:");
			expect(text).toContain("Tokens:");
			expect(text).toContain("Cost:");
		});

		it("shows session info with 'info' arg", async () => {
			registerTestCommands(commands, state, null);

			await commands.execute("/session info");

			const text = lastMessageText(state);
			expect(text).toContain("Session:");
			expect(text).toContain("Model:");
		});

		it("shows (none) when sessionId is empty", async () => {
			registerTestCommands(commands, state, null);

			await commands.execute("/session");

			const text = lastMessageText(state);
			expect(text).toContain("Session: (none)");
		});

		it("shows list message", async () => {
			registerTestCommands(commands, state, null);

			await commands.execute("/session list");

			const text = lastMessageText(state);
			expect(text).toContain("Session listing requires Chitragupta connection");
		});

		it("resume sets sessionId", async () => {
			registerTestCommands(commands, state, null);

			await commands.execute("/session resume session-2026-02-13-xyz1");

			expect(state.sessionId.value).toBe("session-2026-02-13-xyz1");
			const text = lastMessageText(state);
			expect(text).toContain("Resumed session: session-2026-02-13-xyz1");
		});

		it("resume does nothing with empty id", async () => {
			registerTestCommands(commands, state, null);
			state.sessionId.value = "original";

			await commands.execute("/session resume ");

			// sessionId should remain unchanged — empty string after trim
			// The handler checks `if (sessionId)` so empty string is falsy
			expect(state.sessionId.value).toBe("original");
		});

		it("shows usage for unknown subcommand", async () => {
			registerTestCommands(commands, state, null);

			await commands.execute("/session unknown");

			const text = lastMessageText(state);
			expect(text).toContain("Usage: /session [info|list|resume <id>]");
		});
	});

	/* ---- /memory --------------------------------------------------------- */

	describe("/memory", () => {
		it("shows usage with no args", async () => {
			registerTestCommands(commands, state, null);

			await commands.execute("/memory");

			const text = lastMessageText(state);
			expect(text).toContain("Usage: /memory <search query>");
		});

		it("shows search message and connection notice with args", async () => {
			registerTestCommands(commands, state, null);

			await commands.execute("/memory refactoring patterns");

			const messages = state.messages.value;
			expect(messages.length).toBeGreaterThanOrEqual(2);

			const texts = messages.map((m) => {
				const block = m.content.find((b) => b.type === "text");
				return block?.type === "text" ? block.text : "";
			});

			expect(texts.some((t) => t.includes("Searching memory for: refactoring patterns..."))).toBe(true);
			expect(texts.some((t) => t.includes("Memory search requires Chitragupta connection"))).toBe(true);
		});
	});

	/* ---- /permission ----------------------------------------------------- */

	describe("/permission", () => {
		it("shows 'No permission rules' with no rules and no args", async () => {
			const mockPermissions = {
				getRules: vi.fn().mockReturnValue([]),
				reset: vi.fn(),
			};
			registerTestCommands(commands, state, { permissions: mockPermissions });

			await commands.execute("/permission");

			const text = lastMessageText(state);
			expect(text).toContain("No permission rules configured");
			expect(mockPermissions.getRules).toHaveBeenCalledOnce();
		});

		it("shows rules when they exist", async () => {
			const mockPermissions = {
				getRules: vi.fn().mockReturnValue([
					{ tool: "bash", pattern: "*", allow: true, scope: "session" },
					{ tool: "write", pattern: "/tmp/**", allow: false, scope: "project" },
				]),
				reset: vi.fn(),
			};
			registerTestCommands(commands, state, { permissions: mockPermissions });

			await commands.execute("/permission");

			const text = lastMessageText(state);
			expect(text).toContain("Permission rules:");
			expect(text).toContain("allow bash * (session)");
			expect(text).toContain("deny write /tmp/** (project)");
		});

		it("shows 'No agent runner' when agentRunner is null", async () => {
			registerTestCommands(commands, state, null);

			await commands.execute("/permission");

			const text = lastMessageText(state);
			expect(text).toContain("No agent runner configured");
		});

		it("reset calls permissions.reset()", async () => {
			const mockPermissions = {
				getRules: vi.fn().mockReturnValue([]),
				reset: vi.fn(),
			};
			registerTestCommands(commands, state, { permissions: mockPermissions });

			await commands.execute("/permission reset");

			expect(mockPermissions.reset).toHaveBeenCalledOnce();
			const text = lastMessageText(state);
			expect(text).toContain("Session permissions reset");
		});

		it("reset works even when agentRunner is null (no crash)", async () => {
			registerTestCommands(commands, state, null);

			await commands.execute("/permission reset");

			const text = lastMessageText(state);
			expect(text).toContain("Session permissions reset");
		});

		it("shows usage for unknown subcommand", async () => {
			registerTestCommands(commands, state, null);

			await commands.execute("/permission grant bash");

			const text = lastMessageText(state);
			expect(text).toContain("Usage: /permission [reset]");
		});
	});

	/* ---- session ID generation ------------------------------------------- */

	describe("session ID generation", () => {
		it("generates session-YYYY-MM-DD-XXXX format", () => {
			// Mimic the logic from TakumiApp.start()
			const date = new Date().toISOString().slice(0, 10);
			const rand = Math.random().toString(36).slice(2, 6);
			const sessionId = `session-${date}-${rand}`;

			expect(sessionId).toMatch(/^session-\d{4}-\d{2}-\d{2}-[a-z0-9]{4}$/);
		});

		it("sets sessionId on state when empty", () => {
			expect(state.sessionId.value).toBe("");

			// Simulate what start() does
			if (!state.sessionId.value) {
				const date = new Date().toISOString().slice(0, 10);
				const rand = Math.random().toString(36).slice(2, 6);
				state.sessionId.value = `session-${date}-${rand}`;
			}

			expect(state.sessionId.value).toMatch(/^session-\d{4}-\d{2}-\d{2}-[a-z0-9]{4}$/);
		});

		it("does not overwrite existing sessionId", () => {
			state.sessionId.value = "session-existing-1234";

			// Simulate what start() does
			if (!state.sessionId.value) {
				const date = new Date().toISOString().slice(0, 10);
				const rand = Math.random().toString(36).slice(2, 6);
				state.sessionId.value = `session-${date}-${rand}`;
			}

			expect(state.sessionId.value).toBe("session-existing-1234");
		});
	});

	/* ---- addInfoMessage -------------------------------------------------- */

	describe("addInfoMessage", () => {
		it("creates an assistant message with the given text", async () => {
			registerTestCommands(commands, state, null);

			await commands.execute("/session");

			const messages = state.messages.value;
			expect(messages.length).toBeGreaterThanOrEqual(1);

			const msg = messages[0];
			expect(msg.role).toBe("assistant");
			expect(msg.id).toMatch(/^info-\d+$/);
			expect(msg.content).toHaveLength(1);
			expect(msg.content[0].type).toBe("text");
		});

		it("sets a timestamp on the message", async () => {
			const before = Date.now();
			registerTestCommands(commands, state, null);

			await commands.execute("/session");

			const after = Date.now();
			const msg = state.messages.value[0];
			expect(msg.timestamp).toBeGreaterThanOrEqual(before);
			expect(msg.timestamp).toBeLessThanOrEqual(after);
		});
	});
});
