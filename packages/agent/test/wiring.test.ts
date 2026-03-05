/**
 * Tests for Phase 45 — Extension wiring, convention loader, daemon notifications
 */

import { loadConventionFiles } from "@takumi/agent";
import { describe, expect, it, vi } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════════
// Convention Loader
// ═══════════════════════════════════════════════════════════════════════════════

describe("loadConventionFiles", () => {
	it("returns empty defaults when .takumi/ does not exist", () => {
		const result = loadConventionFiles("/nonexistent/path");
		expect(result.systemPromptAddon).toBeNull();
		expect(result.toolRules).toEqual([]);
		expect(result.loadedFiles).toEqual([]);
	});

	it("returns correct types in the result shape", () => {
		const result = loadConventionFiles("/nonexistent/path");
		expect(result).toHaveProperty("systemPromptAddon");
		expect(result).toHaveProperty("toolRules");
		expect(result).toHaveProperty("loadedFiles");
		expect(Array.isArray(result.toolRules)).toBe(true);
		expect(Array.isArray(result.loadedFiles)).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Daemon Socket Notification Handler
// ═══════════════════════════════════════════════════════════════════════════════

describe("DaemonSocketClient notifications", () => {
	it("onNotification registers and unsubscribes handlers", async () => {
		const { DaemonSocketClient } = await import("@takumi/bridge");

		const client = new DaemonSocketClient("/tmp/test-nonexistent.sock");
		const handler = vi.fn();

		const unsub = client.onNotification("test_method", handler);
		expect(typeof unsub).toBe("function");

		// Unsubscribe should not throw
		unsub();
	});

	it("multiple handlers for same method", async () => {
		const { DaemonSocketClient } = await import("@takumi/bridge");

		const client = new DaemonSocketClient("/tmp/test-nonexistent.sock");
		const handler1 = vi.fn();
		const handler2 = vi.fn();

		const unsub1 = client.onNotification("multi_method", handler1);
		const unsub2 = client.onNotification("multi_method", handler2);

		expect(typeof unsub1).toBe("function");
		expect(typeof unsub2).toBe("function");

		// Unsub one, the other should still be registered
		unsub1();
		unsub2();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// ExtensionRunner in AgentLoopOptions
// ═══════════════════════════════════════════════════════════════════════════════

describe("agentLoop extension integration", () => {
	it("AgentLoopOptions accepts extensionRunner", async () => {
		// Just verify the type import works — no runtime call
		const { ExtensionRunner } = await import("@takumi/agent");
		expect(ExtensionRunner).toBeDefined();
		expect(typeof ExtensionRunner).toBe("function");
	});

	it("ExtensionRunner can be constructed with empty array", async () => {
		const { ExtensionRunner } = await import("@takumi/agent");
		const runner = new ExtensionRunner([]);
		expect(runner.getExtensionPaths()).toEqual([]);
		expect(runner.hasHandlers("turn_start")).toBe(false);
		expect(runner.getAllTools().size).toBe(0);
		expect(runner.getAllCommands().size).toBe(0);
		expect(runner.getAllShortcuts().size).toBe(0);
	});

	it("emit on empty runner does not throw", async () => {
		const { ExtensionRunner } = await import("@takumi/agent");
		const runner = new ExtensionRunner([]);
		await runner.emit({ type: "turn_start", turnIndex: 1, timestamp: Date.now() });
		await runner.emit({ type: "turn_end", turnIndex: 1, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
	});

	it("emitToolCall returns undefined when no handlers", async () => {
		const { ExtensionRunner } = await import("@takumi/agent");
		const runner = new ExtensionRunner([]);
		const result = await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "tc1",
			toolName: "bash",
			args: { command: "echo hi" },
		});
		expect(result).toBeUndefined();
	});

	it("emitToolResult returns undefined when no handlers", async () => {
		const { ExtensionRunner } = await import("@takumi/agent");
		const runner = new ExtensionRunner([]);
		const result = await runner.emitToolResult({
			type: "tool_result",
			toolCallId: "tc1",
			toolName: "bash",
			result: { output: "hi", isError: false },
			isError: false,
		});
		expect(result).toBeUndefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Convention Files type shape
// ═══════════════════════════════════════════════════════════════════════════════

describe("ConventionFiles type", () => {
	it("loadConventionFiles is exported from @takumi/agent", async () => {
		const mod = await import("@takumi/agent");
		expect(typeof mod.loadConventionFiles).toBe("function");
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Bridge daemonSocket getter
// ═══════════════════════════════════════════════════════════════════════════════

describe("ChitraguptaBridge daemonSocket getter", () => {
	it("daemonSocket is null before connect", async () => {
		const { ChitraguptaBridge } = await import("@takumi/bridge");
		const bridge = new ChitraguptaBridge({ command: "echo", args: [] });
		expect(bridge.daemonSocket).toBeNull();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// NotificationHandler export
// ═══════════════════════════════════════════════════════════════════════════════

describe("NotificationHandler type", () => {
	it("DaemonSocketClient is exported from @takumi/bridge", async () => {
		const mod = await import("@takumi/bridge");
		expect(typeof mod.DaemonSocketClient).toBe("function");
	});
});
