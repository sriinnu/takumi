import type { Message } from "@takumi/core";
import { describe, expect, it, vi } from "vitest";
import { loadExtensionFromFactory } from "../src/extensions/extension-loader.js";
import type { ExtensionAPIActions, ExtensionContextActions } from "../src/extensions/extension-runner.js";
import { ExtensionRunner } from "../src/extensions/extension-runner.js";
import type { ExtensionFactory, ExtensionToolDefinition, LoadedExtension } from "../src/extensions/extension-types.js";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function makeExtension(overrides?: Partial<LoadedExtension>): LoadedExtension {
	return {
		path: "<test>",
		resolvedPath: "<test>",
		handlers: new Map(),
		tools: new Map(),
		commands: new Map(),
		shortcuts: new Map(),
		...overrides,
	};
}

function mockContextActions(): ExtensionContextActions {
	return {
		getModel: () => "gpt-4o",
		getSessionId: () => "sess-1",
		getCwd: () => "/tmp/test",
		isIdle: () => true,
		abort: vi.fn(),
		getContextUsage: () => ({ tokens: 100, contextWindow: 1000, percent: 10 }),
		getSystemPrompt: () => "You are helpful.",
		compact: vi.fn(),
		shutdown: vi.fn(),
	};
}

function mockAPIActions(): ExtensionAPIActions {
	return {
		sendUserMessage: vi.fn(),
		getActiveTools: () => ["read", "write"],
		setActiveTools: vi.fn(),
		exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
	};
}

function boundRunner(extensions: LoadedExtension[]): ExtensionRunner {
	const runner = new ExtensionRunner(extensions);
	runner.bindActions(mockContextActions(), mockAPIActions());
	return runner;
}

/* ── Loader (loadExtensionFromFactory) ──────────────────────────────────── */

describe("loadExtensionFromFactory", () => {
	it("creates extension with registered handlers", async () => {
		const factory: ExtensionFactory = (api) => {
			api.on("session_start", async () => {});
			api.on("agent_start", async () => {});
		};
		const ext = await loadExtensionFromFactory(factory, "/tmp");
		expect(ext.handlers.get("session_start")).toHaveLength(1);
		expect(ext.handlers.get("agent_start")).toHaveLength(1);
	});

	it("creates extension with registered tool", async () => {
		const factory: ExtensionFactory = (api) => {
			api.registerTool({
				name: "my_tool",
				description: "Test tool",
				inputSchema: { type: "object", properties: {} },
				requiresPermission: false,
				category: "read",
				execute: async () => ({ output: "done", isError: false }),
			} as ExtensionToolDefinition);
		};
		const ext = await loadExtensionFromFactory(factory, "/tmp");
		expect(ext.tools.has("my_tool")).toBe(true);
	});

	it("creates extension with command", async () => {
		const factory: ExtensionFactory = (api) => {
			api.registerCommand("hello", {
				description: "Say hello",
				handler: async () => {},
			});
		};
		const ext = await loadExtensionFromFactory(factory, "/tmp");
		expect(ext.commands.has("hello")).toBe(true);
		expect(ext.commands.get("hello")?.name).toBe("hello");
	});

	it("creates extension with shortcut", async () => {
		const factory: ExtensionFactory = (api) => {
			api.registerShortcut("ctrl+k", {
				description: "Quick action",
				handler: async () => {},
			});
		};
		const ext = await loadExtensionFromFactory(factory, "/tmp");
		expect(ext.shortcuts.has("ctrl+k")).toBe(true);
	});

	it("stubs throw during loading", async () => {
		const factory: ExtensionFactory = (api) => {
			expect(() => api.sendUserMessage("hi")).toThrow(/not available during extension loading/);
			expect(() => api.getActiveTools()).toThrow(/not available during extension loading/);
			expect(() => api.setActiveTools([])).toThrow(/not available during extension loading/);
		};
		await loadExtensionFromFactory(factory, "/tmp");
	});

	it("supports multiple handlers for same event", async () => {
		const factory: ExtensionFactory = (api) => {
			api.on("turn_start", async () => {});
			api.on("turn_start", async () => {});
			api.on("turn_start", async () => {});
		};
		const ext = await loadExtensionFromFactory(factory, "/tmp");
		expect(ext.handlers.get("turn_start")).toHaveLength(3);
	});
});

/* ── ExtensionRunner ────────────────────────────────────────────────────── */

describe("ExtensionRunner", () => {
	/* ---- Construction & Binding ───────────────────────────────────────── */

	describe("construction", () => {
		it("creates with empty extensions", () => {
			const runner = new ExtensionRunner([]);
			expect(runner.getExtensionPaths()).toEqual([]);
		});

		it("tracks extension paths", () => {
			const ext = makeExtension({ path: "ext-a" });
			const runner = new ExtensionRunner([ext]);
			expect(runner.getExtensionPaths()).toEqual(["ext-a"]);
		});
	});

	describe("createContext", () => {
		it("resolves values from bound actions", () => {
			const runner = boundRunner([]);
			const ctx = runner.createContext();
			expect(ctx.cwd).toBe("/tmp/test");
			expect(ctx.model).toBe("gpt-4o");
			expect(ctx.sessionId).toBe("sess-1");
			expect(ctx.isIdle()).toBe(true);
			expect(ctx.getSystemPrompt()).toBe("You are helpful.");
			expect(ctx.getContextUsage()).toEqual({ tokens: 100, contextWindow: 1000, percent: 10 });
		});
	});

	/* ── hasHandlers ────────────────────────────────────────────────────── */

	describe("hasHandlers", () => {
		it("returns false for unregistered events", () => {
			const runner = boundRunner([makeExtension()]);
			expect(runner.hasHandlers("session_start")).toBe(false);
		});

		it("returns true when handler exists", () => {
			const ext = makeExtension();
			ext.handlers.set("session_start", [async () => {}]);
			const runner = boundRunner([ext]);
			expect(runner.hasHandlers("session_start")).toBe(true);
		});
	});

	/* ── getAllTools / getAllCommands / getAllShortcuts ───────────────────── */

	describe("aggregation queries", () => {
		it("getAllTools merges from multiple extensions (first wins)", () => {
			const ext1 = makeExtension({ path: "ext-1" });
			ext1.tools.set("tool_a", { name: "tool_a" } as any);
			const ext2 = makeExtension({ path: "ext-2" });
			ext2.tools.set("tool_a", { name: "tool_a_dup" } as any);
			ext2.tools.set("tool_b", { name: "tool_b" } as any);

			const runner = boundRunner([ext1, ext2]);
			const tools = runner.getAllTools();
			expect(tools.size).toBe(2);
			expect(tools.get("tool_a")?.extensionPath).toBe("ext-1");
		});

		it("getAllCommands merges from multiple extensions", () => {
			const ext1 = makeExtension({ path: "ext-1" });
			ext1.commands.set("cmd", { name: "cmd", handler: async () => {} } as any);
			const ext2 = makeExtension({ path: "ext-2" });
			ext2.commands.set("cmd", { name: "cmd2", handler: async () => {} } as any);

			const runner = boundRunner([ext1, ext2]);
			expect(runner.getAllCommands().size).toBe(1);
			expect(runner.getAllCommands().get("cmd")?.extensionPath).toBe("ext-1");
		});

		it("getAllShortcuts deduplicates by key", () => {
			const ext1 = makeExtension();
			ext1.shortcuts.set("ctrl+k", { key: "ctrl+k" } as any);
			const ext2 = makeExtension();
			ext2.shortcuts.set("ctrl+k", { key: "ctrl+k+2" } as any);

			const runner = boundRunner([ext1, ext2]);
			expect(runner.getAllShortcuts().size).toBe(1);
		});
	});

	/* ── emit (fire-and-forget) ─────────────────────────────────────────── */

	describe("emit", () => {
		it("calls handlers for matching event type", async () => {
			const handler = vi.fn();
			const ext = makeExtension();
			ext.handlers.set("session_start", [handler]);

			const runner = boundRunner([ext]);
			await runner.emit({ type: "session_start", sessionId: "s1" });
			expect(handler).toHaveBeenCalledOnce();
			expect(handler.mock.calls[0]![0]).toEqual({ type: "session_start", sessionId: "s1" });
		});

		it("isolates errors per handler", async () => {
			const errorSpy = vi.fn();
			const ext = makeExtension({ path: "err-ext" });
			ext.handlers.set("session_start", [
				async () => {
					throw new Error("boom");
				},
			]);

			const runner = boundRunner([ext]);
			runner.onError(errorSpy);
			await runner.emit({ type: "session_start", sessionId: "s1" });
			expect(errorSpy).toHaveBeenCalledOnce();
			expect(errorSpy.mock.calls[0]![0].error).toBe("boom");
			expect(errorSpy.mock.calls[0]![0].extensionPath).toBe("err-ext");
		});

		it("does not call handlers for non-matching event type", async () => {
			const handler = vi.fn();
			const ext = makeExtension();
			ext.handlers.set("agent_start", [handler]);

			const runner = boundRunner([ext]);
			await runner.emit({ type: "session_start", sessionId: "s1" });
			expect(handler).not.toHaveBeenCalled();
		});
	});

	/* ── emitCancellable ────────────────────────────────────────────────── */

	describe("emitCancellable", () => {
		it("returns undefined when no handler cancels", async () => {
			const ext = makeExtension();
			ext.handlers.set("session_before_switch", [async () => ({ cancel: false })]);
			const runner = boundRunner([ext]);
			const result = await runner.emitCancellable({
				type: "session_before_switch",
				reason: "new",
			});
			expect(result).toBeUndefined();
		});

		it("returns cancel result from first cancelling handler", async () => {
			const ext = makeExtension();
			ext.handlers.set("session_before_switch", [async () => ({ cancel: true }), async () => ({ cancel: true })]);
			const runner = boundRunner([ext]);
			const result = await runner.emitCancellable({
				type: "session_before_switch",
				reason: "new",
			});
			expect(result?.cancel).toBe(true);
		});
	});

	/* ── emitContext ─────────────────────────────────────────────────────── */

	describe("emitContext", () => {
		it("returns original messages when no handlers", async () => {
			const runner = boundRunner([makeExtension()]);
			const msgs: Message[] = [{ role: "user", content: [{ type: "text", text: "hello" }] }];
			const result = await runner.emitContext(msgs);
			expect(result).toEqual(msgs);
		});

		it("chains message transforms across handlers", async () => {
			const ext = makeExtension();
			ext.handlers.set("context", [
				// First handler appends a system message
				async (event: any) => ({
					messages: [...event.messages, { role: "assistant", content: [{ type: "text", text: "injected" }] }],
				}),
				// Second handler sees the injected message
				async (event: any) => {
					expect(event.messages).toHaveLength(2);
					return { messages: event.messages };
				},
			]);
			const runner = boundRunner([ext]);
			const msgs: Message[] = [{ role: "user", content: [{ type: "text", text: "hello" }] }];
			const result = await runner.emitContext(msgs);
			expect(result).toHaveLength(2);
		});

		it("does not mutate original messages", async () => {
			const ext = makeExtension();
			ext.handlers.set("context", [
				async (event: any) => ({
					messages: [...event.messages, { role: "assistant", content: [{ type: "text", text: "new" }] }],
				}),
			]);
			const runner = boundRunner([ext]);
			const original: Message[] = [{ role: "user", content: [{ type: "text", text: "hello" }] }];
			await runner.emitContext(original);
			expect(original).toHaveLength(1);
		});
	});

	/* ── emitBeforeAgentStart ───────────────────────────────────────────── */

	describe("emitBeforeAgentStart", () => {
		it("returns undefined when no handlers modify", async () => {
			const runner = boundRunner([makeExtension()]);
			const result = await runner.emitBeforeAgentStart("hello", "You are helpful.");
			expect(result).toBeUndefined();
		});

		it("collects system prompt override", async () => {
			const ext = makeExtension();
			ext.handlers.set("before_agent_start", [async () => ({ systemPrompt: "Custom prompt" })]);
			const runner = boundRunner([ext]);
			const result = await runner.emitBeforeAgentStart("hello", "Original");
			expect(result?.systemPrompt).toBe("Custom prompt");
		});

		it("collects injected messages from multiple handlers", async () => {
			const ext = makeExtension();
			ext.handlers.set("before_agent_start", [
				async () => ({ injectMessage: { content: "msg1" } }),
				async () => ({ injectMessage: { content: "msg2" } }),
			]);
			const runner = boundRunner([ext]);
			const result = await runner.emitBeforeAgentStart("hello", "sys");
			expect(result?.injectedMessages).toHaveLength(2);
		});
	});

	/* ── emitToolCall ───────────────────────────────────────────────────── */

	describe("emitToolCall", () => {
		it("returns undefined when no handler blocks", async () => {
			const runner = boundRunner([makeExtension()]);
			const result = await runner.emitToolCall({
				type: "tool_call",
				toolCallId: "tc1",
				toolName: "read",
				args: {},
			});
			expect(result).toBeUndefined();
		});

		it("returns block result from first blocking handler", async () => {
			const ext = makeExtension();
			ext.handlers.set("tool_call", [async () => ({ block: true, reason: "forbidden" })]);
			const runner = boundRunner([ext]);
			const result = await runner.emitToolCall({
				type: "tool_call",
				toolCallId: "tc1",
				toolName: "write",
				args: { path: "/etc/passwd" },
			});
			expect(result?.block).toBe(true);
			expect(result?.reason).toBe("forbidden");
		});
	});

	/* ── emitToolResult ─────────────────────────────────────────────────── */

	describe("emitToolResult", () => {
		it("returns undefined when no handler modifies", async () => {
			const runner = boundRunner([makeExtension()]);
			const result = await runner.emitToolResult({
				type: "tool_result",
				toolCallId: "tc1",
				toolName: "read",
				result: { output: "data", isError: false },
				isError: false,
			});
			expect(result).toBeUndefined();
		});

		it("chains output modifications", async () => {
			const ext = makeExtension();
			ext.handlers.set("tool_result", [
				async () => ({ output: "modified-output" }),
				async (event: any) => ({ output: `${event.result.output}-again` }),
			]);
			const runner = boundRunner([ext]);
			const result = await runner.emitToolResult({
				type: "tool_result",
				toolCallId: "tc1",
				toolName: "read",
				result: { output: "original", isError: false },
				isError: false,
			});
			expect(result?.output).toBe("modified-output-again");
		});
	});

	/* ── emitInput ──────────────────────────────────────────────────────── */

	describe("emitInput", () => {
		it("returns continue when no handlers", async () => {
			const runner = boundRunner([makeExtension()]);
			const result = await runner.emitInput("hello", "interactive");
			expect(result).toEqual({ action: "continue" });
		});

		it("chains text transforms", async () => {
			const ext = makeExtension();
			ext.handlers.set("input", [async (event: any) => ({ action: "transform", text: event.text.toUpperCase() })]);
			const runner = boundRunner([ext]);
			const result = await runner.emitInput("hello", "interactive");
			expect(result).toEqual({ action: "transform", text: "HELLO" });
		});

		it("short-circuits on handled", async () => {
			const secondHandler = vi.fn();
			const ext = makeExtension();
			ext.handlers.set("input", [async () => ({ action: "handled" as const }), secondHandler]);
			const runner = boundRunner([ext]);
			const result = await runner.emitInput("hello", "interactive");
			expect(result).toEqual({ action: "handled" });
			expect(secondHandler).not.toHaveBeenCalled();
		});
	});

	/* ── Error handling ─────────────────────────────────────────────────── */

	describe("error handling", () => {
		it("onError unsubscribe works", async () => {
			const listener = vi.fn();
			const ext = makeExtension();
			ext.handlers.set("session_start", [
				async () => {
					throw new Error("oops");
				},
			]);

			const runner = boundRunner([ext]);
			const unsub = runner.onError(listener);
			await runner.emit({ type: "session_start", sessionId: "s1" });
			expect(listener).toHaveBeenCalledOnce();

			unsub();
			await runner.emit({ type: "session_start", sessionId: "s1" });
			// Still only called once — listener was removed
			expect(listener).toHaveBeenCalledOnce();
		});

		it("errors include extension path and event type", async () => {
			const listener = vi.fn();
			const ext = makeExtension({ path: "/my/ext.ts" });
			ext.handlers.set("turn_start", [
				async () => {
					throw new Error("bad handler");
				},
			]);

			const runner = boundRunner([ext]);
			runner.onError(listener);
			await runner.emit({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });

			const err = listener.mock.calls[0]![0];
			expect(err.extensionPath).toBe("/my/ext.ts");
			expect(err.event).toBe("turn_start");
			expect(err.error).toBe("bad handler");
			expect(err.stack).toBeDefined();
		});

		it("continues dispatching after error in one handler", async () => {
			const secondHandler = vi.fn();
			const ext = makeExtension();
			ext.handlers.set("session_start", [
				async () => {
					throw new Error("first fails");
				},
				secondHandler,
			]);

			const runner = boundRunner([ext]);
			runner.onError(() => {}); // suppress warning
			await runner.emit({ type: "session_start", sessionId: "s1" });
			expect(secondHandler).toHaveBeenCalledOnce();
		});
	});
});
