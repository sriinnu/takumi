/**
 * Tests for AgentCheckpointManager (Phase 39)
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AgentCheckpointManager } from "../src/checkpoint.js";
import type { MessagePayload } from "../src/loop.js";

function makeMessages(count: number): MessagePayload[] {
	return Array.from({ length: count }, (_, i) => ({
		role: "user" as const,
		content: `Message #${i + 1}`,
	}));
}

describe("AgentCheckpointManager", () => {
	let mgr: AgentCheckpointManager;

	beforeEach(() => {
		mgr = new AgentCheckpointManager({ maxCheckpoints: 3 });
	});

	describe("capture()", () => {
		it("captures a checkpoint with the correct shape", () => {
			const msgs = makeMessages(3);
			const cp = mgr.capture(msgs, 5, { input: 1000, output: 500 }, 0.05, "You are Takumi.", [
				"read_file",
				"write_file",
			]);

			expect(cp.version).toBe(2);
			expect(cp.turn).toBe(5);
			expect(cp.tokens).toEqual({ input: 1000, output: 500 });
			expect(cp.costUsd).toBe(0.05);
			expect(cp.systemPrompt).toBe("You are Takumi.");
			expect(cp.toolNames).toEqual(["read_file", "write_file"]);
			expect(cp.messages).toHaveLength(3);
			expect(cp.createdAt).toBeTruthy();
		});

		it("deep-clones messages by default", () => {
			const msgs = makeMessages(1);
			const cp = mgr.capture(msgs, 1, { input: 0, output: 0 }, 0, "", []);
			msgs[0].content = "MUTATED";
			expect(cp.messages[0].content).toBe("Message #1");
		});

		it("evicts oldest when maxCheckpoints exceeded", () => {
			for (let i = 1; i <= 5; i++) {
				mgr.capture(makeMessages(1), i, { input: 0, output: 0 }, 0, "", []);
			}
			expect(mgr.count).toBe(3);
			expect(mgr.at(0)?.turn).toBe(3);
		});

		it("respects deepClone=false", () => {
			const shallow = new AgentCheckpointManager({ deepClone: false });
			const msgs = makeMessages(1);
			const cp = shallow.capture(msgs, 1, { input: 0, output: 0 }, 0, "", []);
			// Without deep clone, the arrays share references
			expect(cp.messages).toBe(msgs);
		});
	});

	describe("restore()", () => {
		it("returns a fresh deep-clone of checkpoint data", () => {
			const cp = mgr.capture(makeMessages(2), 3, { input: 100, output: 50 }, 0.01, "sys", ["tool"]);
			const restored = mgr.restore(cp);

			expect(restored.turn).toBe(3);
			expect(restored.tokens).toEqual({ input: 100, output: 50 });
			expect(restored.messages).toHaveLength(2);
			expect(restored.messages).not.toBe(cp.messages);
		});
	});

	describe("query methods", () => {
		it("latest() returns null when empty", () => {
			expect(mgr.latest()).toBeNull();
		});

		it("latest() returns the most recently captured", () => {
			mgr.capture(makeMessages(1), 1, { input: 0, output: 0 }, 0, "", []);
			mgr.capture(makeMessages(1), 2, { input: 0, output: 0 }, 0, "", []);
			expect(mgr.latest()?.turn).toBe(2);
		});

		it("at() returns checkpoint by index", () => {
			mgr.capture(makeMessages(1), 10, { input: 0, output: 0 }, 0, "", []);
			expect(mgr.at(0)?.turn).toBe(10);
			expect(mgr.at(99)).toBeNull();
		});

		it("all() returns readonly array", () => {
			mgr.capture(makeMessages(1), 1, { input: 0, output: 0 }, 0, "", []);
			const all = mgr.all();
			expect(all).toHaveLength(1);
		});

		it("clear() empties the store", () => {
			mgr.capture(makeMessages(1), 1, { input: 0, output: 0 }, 0, "", []);
			mgr.clear();
			expect(mgr.count).toBe(0);
		});
	});

	describe("serialisation", () => {
		it("serialise → deserialise round-trip", () => {
			const cp = mgr.capture(makeMessages(2), 7, { input: 200, output: 100 }, 0.03, "sys prompt", ["read", "write"]);
			const json = AgentCheckpointManager.serialise(cp);
			const restored = AgentCheckpointManager.deserialise(json);
			expect(restored).not.toBeNull();
			expect(restored?.turn).toBe(7);
			expect(restored?.messages).toHaveLength(2);
		});

		it("deserialise rejects invalid JSON", () => {
			expect(AgentCheckpointManager.deserialise("not json")).toBeNull();
		});

		it("deserialise rejects wrong version", () => {
			const bad = JSON.stringify({ version: 1, createdAt: "", messages: [] });
			expect(AgentCheckpointManager.deserialise(bad)).toBeNull();
		});

		it("deserialise rejects malformed objects", () => {
			expect(AgentCheckpointManager.deserialise('{"foo": "bar"}')).toBeNull();
		});
	});

	describe("detectToolDrift()", () => {
		it("detects added and removed tools", () => {
			const cp = mgr.capture(makeMessages(1), 1, { input: 0, output: 0 }, 0, "", ["read_file", "write_file", "bash"]);
			const drift = AgentCheckpointManager.detectToolDrift(cp, ["read_file", "grep", "glob"]);
			expect(drift.added).toEqual(["grep", "glob"]);
			expect(drift.removed).toEqual(["write_file", "bash"]);
		});

		it("no drift when tool sets match", () => {
			const cp = mgr.capture(makeMessages(1), 1, { input: 0, output: 0 }, 0, "", ["a", "b"]);
			const drift = AgentCheckpointManager.detectToolDrift(cp, ["a", "b"]);
			expect(drift.added).toEqual([]);
			expect(drift.removed).toEqual([]);
		});
	});
});
