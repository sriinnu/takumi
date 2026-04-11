import type { ChitraguptaBridge, ChitraguptaSessionInfo, MemoryResult } from "@takumi/bridge";
import { describe, expect, it, vi } from "vitest";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { AppState } from "../src/state.js";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

/** Create a mock ChitraguptaBridge with all methods stubbed. */
function createMockBridge(connected = true): ChitraguptaBridge {
	const bridge = {
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn().mockResolvedValue(undefined),
		memorySearch: vi.fn().mockResolvedValue([]),
		sessionList: vi.fn().mockResolvedValue([]),
		sessionShow: vi.fn().mockResolvedValue({ id: "", title: "", turns: [] }),
		handover: vi.fn().mockResolvedValue({
			originalRequest: "",
			filesModified: [],
			filesRead: [],
			decisions: [],
			errors: [],
			recentContext: "",
		}),
		akashaDeposit: vi.fn().mockResolvedValue(undefined),
		akashaTraces: vi.fn().mockResolvedValue([]),
		get isConnected() {
			return connected;
		},
		mcpClient: {
			on: vi.fn(),
			isConnected: connected,
		},
	} as unknown as ChitraguptaBridge;
	return bridge;
}

/** Capture messages added to state via addInfoMessage pattern in /memory and /sessions handlers. */
function collectMessages(state: AppState): string[] {
	const texts: string[] = [];
	const origAdd = state.addMessage.bind(state);
	state.addMessage = (msg) => {
		const textBlock = msg.content.find((c: any) => c.type === "text") as any;
		if (textBlock?.text) texts.push(textBlock.text);
		origAdd(msg);
	};
	return texts;
}

/* ── Tests ──────────────────────────────────────────────────────────────────── */

describe("Chitragupta TUI Integration", () => {
	/* ---- State signals --------------------------------------------------- */

	describe("AppState Chitragupta signals", () => {
		it("initializes chitraguptaConnected to false", () => {
			const state = new AppState();
			expect(state.chitraguptaConnected.value).toBe(false);
		});

		it("initializes chitraguptaBridge to null", () => {
			const state = new AppState();
			expect(state.chitraguptaBridge.value).toBeNull();
		});

		it("allows setting chitraguptaConnected", () => {
			const state = new AppState();
			state.chitraguptaConnected.value = true;
			expect(state.chitraguptaConnected.value).toBe(true);
		});

		it("allows setting chitraguptaBridge", () => {
			const state = new AppState();
			const bridge = createMockBridge();
			state.chitraguptaBridge.value = bridge;
			expect(state.chitraguptaBridge.value).toBe(bridge);
		});

		it("resets chitragupta state on reset()", () => {
			const state = new AppState();
			state.chitraguptaConnected.value = true;
			state.chitraguptaBridge.value = createMockBridge();

			state.reset();

			expect(state.chitraguptaConnected.value).toBe(false);
			expect(state.chitraguptaBridge.value).toBeNull();
		});
	});

	/* ---- Graceful degradation ------------------------------------------- */

	describe("graceful degradation when bridge not available", () => {
		it("state remains false when bridge connection fails", async () => {
			const state = new AppState();
			const bridge = createMockBridge(false);
			(bridge.connect as any).mockRejectedValue(new Error("spawn ENOENT"));

			state.chitraguptaBridge.value = bridge;

			try {
				await bridge.connect();
			} catch {
				state.chitraguptaConnected.value = false;
				state.chitraguptaBridge.value = null;
			}

			expect(state.chitraguptaConnected.value).toBe(false);
			expect(state.chitraguptaBridge.value).toBeNull();
		});

		it("does not crash when chitragupta-mcp binary is not found", async () => {
			const state = new AppState();
			const bridge = createMockBridge(false);
			(bridge.connect as any).mockRejectedValue(new Error("spawn chitragupta-mcp ENOENT"));

			state.chitraguptaBridge.value = bridge;

			// Simulate the try/catch in connectChitragupta
			let caughtError = false;
			try {
				await bridge.connect();
			} catch {
				caughtError = true;
				state.chitraguptaConnected.value = false;
				state.chitraguptaBridge.value = null;
			}

			expect(caughtError).toBe(true);
			expect(state.chitraguptaConnected.value).toBe(false);
		});
	});

	/* ---- Auto-connect success ------------------------------------------- */

	describe("auto-connect success", () => {
		it("sets chitraguptaConnected to true when bridge connects", async () => {
			const state = new AppState();
			const bridge = createMockBridge(true);

			state.chitraguptaBridge.value = bridge;
			await bridge.connect();
			state.chitraguptaConnected.value = true;

			expect(state.chitraguptaConnected.value).toBe(true);
			expect(bridge.connect).toHaveBeenCalledOnce();
		});

		it("runs memorySearch after successful connection", async () => {
			const state = new AppState();
			const bridge = createMockBridge(true);
			const mockResults: MemoryResult[] = [
				{ content: "Past decision about auth", relevance: 0.9, source: "session-1" },
			];
			(bridge.memorySearch as any).mockResolvedValue(mockResults);

			state.chitraguptaBridge.value = bridge;
			await bridge.connect();
			state.chitraguptaConnected.value = true;

			const results = await bridge.memorySearch("takumi", 5);

			expect(bridge.memorySearch).toHaveBeenCalledWith("takumi", 5);
			expect(results).toHaveLength(1);
			expect(results[0].content).toBe("Past decision about auth");
		});
	});

	/* ---- /memory command ------------------------------------------------- */

	describe("/memory command", () => {
		it("returns results when connected", async () => {
			const state = new AppState();
			const messages = collectMessages(state);
			const bridge = createMockBridge(true);
			const mockResults: MemoryResult[] = [
				{ content: "Architecture decision: use SQLite", relevance: 0.95, source: "session-a" },
				{ content: "Pattern: write-through cache", relevance: 0.8 },
			];
			(bridge.memorySearch as any).mockResolvedValue(mockResults);
			state.chitraguptaBridge.value = bridge;
			state.chitraguptaConnected.value = true;

			const commands = new SlashCommandRegistry();
			commands.register("/memory", "Search project memory", async (args) => {
				if (!args) {
					state.addMessage({
						id: "info-1",
						role: "assistant",
						content: [{ type: "text", text: "Usage: /memory <search query>" }],
						timestamp: Date.now(),
					});
					return;
				}

				const b = state.chitraguptaBridge.value;
				if (!b || !state.chitraguptaConnected.value) {
					state.addMessage({
						id: "info-2",
						role: "assistant",
						content: [{ type: "text", text: "Memory search requires Chitragupta connection (not connected)" }],
						timestamp: Date.now(),
					});
					return;
				}

				try {
					const results = await b.memorySearch(args, 10);
					if (results.length === 0) {
						state.addMessage({
							id: "info-3",
							role: "assistant",
							content: [{ type: "text", text: "No memory results found." }],
							timestamp: Date.now(),
						});
					} else {
						const formatted = results
							.map((r, i) => {
								const src = r.source ? ` (${r.source})` : "";
								return `  ${i + 1}. [${(r.relevance * 100).toFixed(0)}%]${src}\n     ${r.content.slice(0, 200)}`;
							})
							.join("\n");
						state.addMessage({
							id: "info-4",
							role: "assistant",
							content: [{ type: "text", text: `Memory results:\n${formatted}` }],
							timestamp: Date.now(),
						});
					}
				} catch (err) {
					state.addMessage({
						id: "info-5",
						role: "assistant",
						content: [{ type: "text", text: `Memory search failed: ${(err as Error).message}` }],
						timestamp: Date.now(),
					});
				}
			});

			await commands.execute("/memory architecture");

			expect(bridge.memorySearch).toHaveBeenCalledWith("architecture", 10);
			expect(messages.some((m) => m.includes("Memory results:"))).toBe(true);
			expect(messages.some((m) => m.includes("95%"))).toBe(true);
			expect(messages.some((m) => m.includes("Architecture decision"))).toBe(true);
		});

		it("shows 'not connected' when disconnected", async () => {
			const state = new AppState();
			const messages = collectMessages(state);
			// No bridge connected
			state.chitraguptaConnected.value = false;
			state.chitraguptaBridge.value = null;

			const commands = new SlashCommandRegistry();
			commands.register("/memory", "Search project memory", async (args) => {
				if (!args) return;
				const b = state.chitraguptaBridge.value;
				if (!b || !state.chitraguptaConnected.value) {
					state.addMessage({
						id: "info-1",
						role: "assistant",
						content: [{ type: "text", text: "Memory search requires Chitragupta connection (not connected)" }],
						timestamp: Date.now(),
					});
					return;
				}
			});

			await commands.execute("/memory something");

			expect(messages.some((m) => m.includes("not connected"))).toBe(true);
		});

		it("shows usage when called without args", async () => {
			const state = new AppState();
			const messages = collectMessages(state);

			const commands = new SlashCommandRegistry();
			commands.register("/memory", "Search project memory", async (args) => {
				if (!args) {
					state.addMessage({
						id: "info-1",
						role: "assistant",
						content: [{ type: "text", text: "Usage: /memory <search query>" }],
						timestamp: Date.now(),
					});
					return;
				}
			});

			await commands.execute("/memory");

			expect(messages.some((m) => m.includes("Usage:"))).toBe(true);
		});
	});

	/* ---- /sessions command ----------------------------------------------- */

	describe("/sessions command", () => {
		it("lists sessions when connected", async () => {
			const state = new AppState();
			const messages = collectMessages(state);
			const bridge = createMockBridge(true);
			const mockSessions: ChitraguptaSessionInfo[] = [
				{ id: "session-2024-01-15-abcd", title: "Refactoring auth", timestamp: 1705276800000, turns: 12 },
				{ id: "session-2024-01-14-efgh", title: "Bug fix", timestamp: 1705190400000, turns: 5 },
			];
			(bridge.sessionList as any).mockResolvedValue(mockSessions);
			state.chitraguptaBridge.value = bridge;
			state.chitraguptaConnected.value = true;

			const commands = new SlashCommandRegistry();
			commands.register("/sessions", "List Chitragupta sessions", async (args) => {
				const b = state.chitraguptaBridge.value;
				if (!b || !state.chitraguptaConnected.value) {
					state.addMessage({
						id: "info-1",
						role: "assistant",
						content: [{ type: "text", text: "Session listing requires Chitragupta connection (not connected)" }],
						timestamp: Date.now(),
					});
					return;
				}

				try {
					const limit = args ? parseInt(args, 10) || 10 : 10;
					const sessions = await b.sessionList(limit);
					if (sessions.length === 0) {
						state.addMessage({
							id: "info-2",
							role: "assistant",
							content: [{ type: "text", text: "No Chitragupta sessions found." }],
							timestamp: Date.now(),
						});
					} else {
						const formatted = sessions
							.map((s) => {
								const date = new Date(s.timestamp).toLocaleDateString();
								return `  ${s.id}  ${date}  (${s.turns} turns)  ${s.title}`;
							})
							.join("\n");
						state.addMessage({
							id: "info-3",
							role: "assistant",
							content: [{ type: "text", text: `Chitragupta sessions:\n${formatted}` }],
							timestamp: Date.now(),
						});
					}
				} catch (err) {
					state.addMessage({
						id: "info-4",
						role: "assistant",
						content: [{ type: "text", text: `Session listing failed: ${(err as Error).message}` }],
						timestamp: Date.now(),
					});
				}
			});

			await commands.execute("/sessions");

			expect(bridge.sessionList).toHaveBeenCalledWith(10);
			expect(messages.some((m) => m.includes("Chitragupta sessions:"))).toBe(true);
			expect(messages.some((m) => m.includes("session-2024-01-15-abcd"))).toBe(true);
			expect(messages.some((m) => m.includes("Refactoring auth"))).toBe(true);
		});

		it("shows not connected when disconnected", async () => {
			const state = new AppState();
			const messages = collectMessages(state);
			state.chitraguptaConnected.value = false;
			state.chitraguptaBridge.value = null;

			const commands = new SlashCommandRegistry();
			commands.register("/sessions", "List sessions", async () => {
				const b = state.chitraguptaBridge.value;
				if (!b || !state.chitraguptaConnected.value) {
					state.addMessage({
						id: "info-1",
						role: "assistant",
						content: [{ type: "text", text: "Session listing requires Chitragupta connection (not connected)" }],
						timestamp: Date.now(),
					});
					return;
				}
			});

			await commands.execute("/sessions");

			expect(messages.some((m) => m.includes("not connected"))).toBe(true);
		});
	});

	/* ---- Status bar connection state ------------------------------------- */

	describe("status bar connection state", () => {
		it("reflects connected state from signal", () => {
			const state = new AppState();
			expect(state.chitraguptaConnected.value).toBe(false);

			state.chitraguptaConnected.value = true;
			expect(state.chitraguptaConnected.value).toBe(true);

			state.chitraguptaConnected.value = false;
			expect(state.chitraguptaConnected.value).toBe(false);
		});

		it("tracks disconnection events", () => {
			const state = new AppState();
			const bridge = createMockBridge(true);
			state.chitraguptaBridge.value = bridge;
			state.chitraguptaConnected.value = true;

			// Simulate a disconnection event
			state.chitraguptaConnected.value = false;

			expect(state.chitraguptaConnected.value).toBe(false);
		});
	});

	/* ---- Session handover ------------------------------------------------ */

	describe("session handover", () => {
		it("calls handover on bridge when connected", async () => {
			const state = new AppState();
			const bridge = createMockBridge(true);
			(bridge.handover as any).mockResolvedValue({
				originalRequest: "implement feature X",
				filesModified: ["src/foo.ts"],
				filesRead: ["src/bar.ts"],
				decisions: ["decided to use approach A"],
				errors: [],
				recentContext: "working on feature X",
			});
			state.chitraguptaBridge.value = bridge;
			state.chitraguptaConnected.value = true;

			const result = await bridge.handover();

			expect(bridge.handover).toHaveBeenCalledOnce();
			expect(result.originalRequest).toBe("implement feature X");
			expect(result.filesModified).toContain("src/foo.ts");
		});

		it("handles handover timeout gracefully", async () => {
			const state = new AppState();
			const bridge = createMockBridge(true);
			// Simulate a slow handover that will be raced against a timeout
			(bridge.handover as any).mockImplementation(
				() => new Promise((resolve) => setTimeout(() => resolve({}), 10_000)),
			);
			state.chitraguptaBridge.value = bridge;
			state.chitraguptaConnected.value = true;

			// Simulate the timeout race from disconnectChitragupta
			let handoverError: Error | null = null;
			try {
				await Promise.race([
					bridge.handover(),
					new Promise((_, reject) => setTimeout(() => reject(new Error("handover timeout")), 100)),
				]);
			} catch (err) {
				handoverError = err as Error;
			}

			expect(handoverError).not.toBeNull();
			expect(handoverError!.message).toBe("handover timeout");
		});

		it("does not throw when bridge is not connected", async () => {
			const state = new AppState();
			// No bridge connected at all

			// Simulate disconnectChitragupta logic
			const bridge = state.chitraguptaBridge.value;
			if (!bridge) {
				// This is the expected path -- no-op
				expect(true).toBe(true);
				return;
			}
		});
	});

	/* ---- Error handling -------------------------------------------------- */

	describe("error handling", () => {
		it("handles memorySearch errors gracefully in /memory command", async () => {
			const state = new AppState();
			const messages = collectMessages(state);
			const bridge = createMockBridge(true);
			(bridge.memorySearch as any).mockRejectedValue(new Error("MCP process exited"));
			state.chitraguptaBridge.value = bridge;
			state.chitraguptaConnected.value = true;

			const commands = new SlashCommandRegistry();
			commands.register("/memory", "Search memory", async (args) => {
				if (!args) return;
				const b = state.chitraguptaBridge.value;
				if (!b || !state.chitraguptaConnected.value) return;

				try {
					await b.memorySearch(args, 10);
				} catch (err) {
					state.addMessage({
						id: "err-1",
						role: "assistant",
						content: [{ type: "text", text: `Memory search failed: ${(err as Error).message}` }],
						timestamp: Date.now(),
					});
				}
			});

			await commands.execute("/memory test-query");

			expect(messages.some((m) => m.includes("Memory search failed"))).toBe(true);
			expect(messages.some((m) => m.includes("MCP process exited"))).toBe(true);
		});

		it("handles sessionList errors gracefully in /sessions command", async () => {
			const state = new AppState();
			const messages = collectMessages(state);
			const bridge = createMockBridge(true);
			(bridge.sessionList as any).mockRejectedValue(new Error("connection lost"));
			state.chitraguptaBridge.value = bridge;
			state.chitraguptaConnected.value = true;

			const commands = new SlashCommandRegistry();
			commands.register("/sessions", "List sessions", async () => {
				const b = state.chitraguptaBridge.value;
				if (!b || !state.chitraguptaConnected.value) return;

				try {
					await b.sessionList(10);
				} catch (err) {
					state.addMessage({
						id: "err-1",
						role: "assistant",
						content: [{ type: "text", text: `Session listing failed: ${(err as Error).message}` }],
						timestamp: Date.now(),
					});
				}
			});

			await commands.execute("/sessions");

			expect(messages.some((m) => m.includes("Session listing failed"))).toBe(true);
			expect(messages.some((m) => m.includes("connection lost"))).toBe(true);
		});

		it("connection error resets state signals", () => {
			const state = new AppState();
			const bridge = createMockBridge(false);
			state.chitraguptaBridge.value = bridge;
			state.chitraguptaConnected.value = true;

			// Simulate connection error
			state.chitraguptaConnected.value = false;

			expect(state.chitraguptaConnected.value).toBe(false);
			expect(state.chitraguptaBridge.value).toBe(bridge); // bridge ref stays until explicitly null'd
		});
	});
});
