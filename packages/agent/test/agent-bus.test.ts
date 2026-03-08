import { beforeEach, describe, expect, it } from "vitest";
import {
	AgentBus,
	buildCapabilityQuery,
	buildTaskRequest,
	buildTaskResult,
	createMessageId,
} from "../src/cluster/agent-bus.js";
import type {
	AgentCapabilityResponse,
	AgentDiscoveryShare,
	AgentMessage,
	AgentTaskResult,
} from "../src/cluster/types.js";
import { AgentMessagePriority } from "../src/cluster/types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDiscovery(from: string, topic: string): AgentDiscoveryShare {
	return {
		type: "discovery_share",
		id: createMessageId("disc"),
		from,
		topic,
		payload: { info: topic },
		timestamp: Date.now(),
	};
}

function makeCapabilityResponse(from: string, queryId: string): AgentCapabilityResponse {
	return {
		type: "capability_response",
		id: createMessageId("capr"),
		from,
		queryId,
		capabilities: ["typescript", "testing"],
		confidence: 0.9,
		timestamp: Date.now(),
	};
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("AgentBus", () => {
	let bus: AgentBus;

	beforeEach(() => {
		bus = new AgentBus({ maxHistory: 100 });
	});

	// ── Publish / Subscribe ───────────────────────────────────────────────

	describe("publish / subscribe", () => {
		it("delivers messages to matching subscribers", () => {
			const received: AgentMessage[] = [];
			bus.subscribe(
				null,
				() => true,
				(msg) => received.push(msg),
			);

			const msg = makeDiscovery("agent-1", "codebase");
			bus.publish(msg);

			expect(received).toHaveLength(1);
			expect(received[0]).toBe(msg);
		});

		it("filters messages based on predicate", () => {
			const received: AgentMessage[] = [];
			bus.subscribe(
				null,
				(m) => m.type === "discovery_share",
				(msg) => received.push(msg),
			);

			bus.publish(makeDiscovery("agent-1", "codebase"));
			bus.publish(buildTaskRequest("agent-2", "agent-1", "do something"));

			expect(received).toHaveLength(1);
			expect(received[0].type).toBe("discovery_share");
		});

		it("supports multiple subscribers", () => {
			let count1 = 0;
			let count2 = 0;
			bus.subscribe(
				null,
				() => true,
				() => count1++,
			);
			bus.subscribe(
				null,
				() => true,
				() => count2++,
			);

			bus.publish(makeDiscovery("agent-1", "test"));

			expect(count1).toBe(1);
			expect(count2).toBe(1);
		});

		it("does not deliver after unsubscribe", () => {
			let count = 0;
			const sub = bus.subscribe(
				null,
				() => true,
				() => count++,
			);

			bus.publish(makeDiscovery("agent-1", "a"));
			expect(count).toBe(1);

			sub.unsubscribe();
			bus.publish(makeDiscovery("agent-1", "b"));
			expect(count).toBe(1);
		});

		it("swallows subscriber errors without crashing", () => {
			bus.subscribe(
				null,
				() => true,
				() => {
					throw new Error("boom");
				},
			);

			expect(() => bus.publish(makeDiscovery("agent-1", "x"))).not.toThrow();
		});
	});

	// ── Type-filtered on() ────────────────────────────────────────────────

	describe("on()", () => {
		it("only fires for the specified message type", () => {
			const results: AgentTaskResult[] = [];
			bus.on("task_result", null, (msg) => results.push(msg));

			bus.publish(makeDiscovery("a", "noise"));
			bus.publish(buildTaskResult("a", "req-1", true, "done"));
			bus.publish(makeDiscovery("b", "more noise"));

			expect(results).toHaveLength(1);
			expect(results[0].type).toBe("task_result");
			expect(results[0].summary).toBe("done");
		});
	});

	// ── Inbox management ──────────────────────────────────────────────────

	describe("inbox", () => {
		it("queues messages targeted at an agent", () => {
			bus.subscribe(
				"agent-1",
				() => false,
				() => {},
			); // register inbox

			const req = buildTaskRequest("agent-2", "agent-1", "handle this");
			bus.publish(req);

			const inbox = bus.peek("agent-1");
			expect(inbox).toHaveLength(1);
			expect(inbox[0]).toBe(req);
		});

		it("drain() returns and clears inbox", () => {
			bus.subscribe(
				"agent-1",
				() => false,
				() => {},
			);

			bus.publish(buildTaskRequest("x", "agent-1", "task 1"));
			bus.publish(buildTaskRequest("x", "agent-1", "task 2"));

			const drained = bus.drain("agent-1");
			expect(drained).toHaveLength(2);
			expect(bus.peek("agent-1")).toHaveLength(0);
		});

		it("drain() returns empty for unknown agent", () => {
			expect(bus.drain("nobody")).toEqual([]);
		});
	});

	// ── History / Query ───────────────────────────────────────────────────

	describe("history", () => {
		it("retains published messages", () => {
			bus.publish(makeDiscovery("a", "t1"));
			bus.publish(makeDiscovery("b", "t2"));

			expect(bus.messageCount).toBe(2);
		});

		it("trims to maxHistory", () => {
			const small = new AgentBus({ maxHistory: 3 });
			for (let i = 0; i < 5; i++) {
				small.publish(makeDiscovery("a", `topic-${i}`));
			}
			expect(small.messageCount).toBe(3);
			expect(small.recent(10).map((m) => (m as AgentDiscoveryShare).topic)).toEqual(["topic-2", "topic-3", "topic-4"]);
		});

		it("queryByType returns only matching type", () => {
			bus.publish(makeDiscovery("a", "disc"));
			bus.publish(buildTaskRequest("a", "b", "req"));
			bus.publish(makeDiscovery("a", "disc2"));

			const discoveries = bus.queryByType("discovery_share");
			expect(discoveries).toHaveLength(2);
		});

		it("recent() returns the last N messages", () => {
			for (let i = 0; i < 10; i++) {
				bus.publish(makeDiscovery("a", `t-${i}`));
			}
			const last3 = bus.recent(3);
			expect(last3).toHaveLength(3);
			expect((last3[0] as AgentDiscoveryShare).topic).toBe("t-7");
		});

		it("query() with custom filter", () => {
			bus.publish(makeDiscovery("a", "security"));
			bus.publish(makeDiscovery("b", "testing"));
			bus.publish(makeDiscovery("a", "performance"));

			const fromA = bus.query((m) => m.from === "a");
			expect(fromA).toHaveLength(2);
		});
	});

	// ── Request / Response ────────────────────────────────────────────────

	describe("request()", () => {
		it("resolves when a correlated task_result arrives", async () => {
			const req = buildTaskRequest("orchestrator", "worker-1", "write tests");

			// Simulate a worker responding after a tick
			setTimeout(() => {
				bus.publish(buildTaskResult("worker-1", req.id, true, "tests written"));
			}, 10);

			const reply = await bus.request(req);
			expect(reply.type).toBe("task_result");
			expect((reply as AgentTaskResult).success).toBe(true);
		});

		it("resolves when a correlated capability_response arrives", async () => {
			const query = buildCapabilityQuery("orchestrator", "typescript");

			setTimeout(() => {
				bus.publish(makeCapabilityResponse("worker-1", query.id));
			}, 10);

			const reply = await bus.request(query);
			expect(reply.type).toBe("capability_response");
			expect((reply as AgentCapabilityResponse).capabilities).toContain("typescript");
		});

		it("rejects on timeout", async () => {
			const fastBus = new AgentBus({ requestTimeoutMs: 50 });
			const req = buildTaskRequest("a", "b", "will timeout");

			await expect(fastBus.request(req)).rejects.toThrow(/timed out/);
		});

		it("rejects on abort signal", async () => {
			const controller = new AbortController();
			const req = buildTaskRequest("a", "b", "will abort");

			setTimeout(() => controller.abort(), 10);

			await expect(bus.request(req, controller.signal)).rejects.toThrow(/aborted/);
		});
	});

	// ── Serialization ─────────────────────────────────────────────────────

	describe("serialization", () => {
		it("round-trips via toJSON / fromJSON", () => {
			bus.subscribe(
				"agent-1",
				() => false,
				() => {},
			);
			bus.publish(makeDiscovery("a", "topic-1"));
			bus.publish(buildTaskRequest("b", "agent-1", "queued task"));

			const json = bus.toJSON();
			const restored = AgentBus.fromJSON(json, { maxHistory: 100 });

			expect(restored.messageCount).toBe(2);
			// Inbox should be restored
			expect(restored.peek("agent-1")).toHaveLength(1);
		});

		it("toJSON only includes non-empty inboxes", () => {
			bus.subscribe(
				"agent-1",
				() => false,
				() => {},
			);
			bus.subscribe(
				"agent-2",
				() => false,
				() => {},
			);
			bus.publish(buildTaskRequest("x", "agent-1", "for 1"));

			const json = bus.toJSON();
			expect(Object.keys(json.inboxes)).toEqual(["agent-1"]);
		});
	});

	// ── Lifecycle ─────────────────────────────────────────────────────────

	describe("lifecycle", () => {
		it("reset() clears subscribers and inboxes, keeps history", () => {
			let count = 0;
			bus.subscribe(
				"a",
				() => true,
				() => count++,
			);
			bus.publish(makeDiscovery("x", "t"));
			expect(count).toBe(1);

			bus.reset();
			bus.publish(makeDiscovery("y", "t2"));
			expect(count).toBe(1); // subscriber gone
			expect(bus.messageCount).toBe(2); // history kept
		});

		it("destroy() clears everything", () => {
			bus.publish(makeDiscovery("a", "t"));
			bus.destroy();

			expect(bus.messageCount).toBe(0);
		});
	});

	// ── Message Builders ──────────────────────────────────────────────────

	describe("message builders", () => {
		it("buildTaskRequest creates valid message", () => {
			const req = buildTaskRequest("orch", "worker", "fix bug", {
				priority: AgentMessagePriority.HIGH,
				constraints: { maxTokens: 1000 },
			});

			expect(req.type).toBe("task_request");
			expect(req.from).toBe("orch");
			expect(req.to).toBe("worker");
			expect(req.priority).toBe(AgentMessagePriority.HIGH);
			expect(req.description).toBe("fix bug");
			expect(req.constraints).toEqual({ maxTokens: 1000 });
			expect(req.id).toMatch(/^task-/);
			expect(req.timestamp).toBeGreaterThan(0);
		});

		it("buildTaskResult creates valid message", () => {
			const res = buildTaskResult("worker", "req-123", true, "all good", {
				artifacts: [{ kind: "file", path: "test.ts", content: "// test" }],
				metrics: { durationMs: 500, tokensUsed: 100 },
			});

			expect(res.type).toBe("task_result");
			expect(res.taskRequestId).toBe("req-123");
			expect(res.success).toBe(true);
			expect(res.artifacts).toHaveLength(1);
			expect(res.metrics?.durationMs).toBe(500);
		});

		it("buildCapabilityQuery creates valid message", () => {
			const q = buildCapabilityQuery("orch", "typescript");

			expect(q.type).toBe("capability_query");
			expect(q.from).toBe("orch");
			expect(q.capability).toBe("typescript");
			expect(q.id).toMatch(/^capq-/);
		});

		it("createMessageId produces unique IDs", () => {
			const ids = new Set(Array.from({ length: 100 }, () => createMessageId("test")));
			expect(ids.size).toBe(100);
		});
	});
});
