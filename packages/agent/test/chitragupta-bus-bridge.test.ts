import type { ChitraguptaBridge } from "@takumi/bridge";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentBus, buildTaskRequest, buildTaskResult } from "../src/cluster/agent-bus.js";
import { ChitraguptaBusBridge } from "../src/cluster/chitragupta-bus-bridge.js";
import { AgentMessagePriority } from "../src/cluster/types.js";

// ── Mock ChitraguptaBridge ───────────────────────────────────────────────────

function makeChitragupta(): ChitraguptaBridge {
	return {
		akashaDeposit: vi.fn().mockResolvedValue(undefined),
		telemetryHeartbeat: vi.fn().mockResolvedValue(undefined),
	} as unknown as ChitraguptaBridge;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ChitraguptaBusBridge", () => {
	let bus: AgentBus;
	let chitragupta: ChitraguptaBridge;
	let bridge: ChitraguptaBusBridge;

	beforeEach(() => {
		bus = new AgentBus();
		chitragupta = makeChitragupta();
		bridge = new ChitraguptaBusBridge(bus, chitragupta);
	});

	// ── Lifecycle ────────────────────────────────────────────────────────────

	describe("attach / detach", () => {
		it("starts detached", () => {
			expect(bridge.stats.attached).toBe(false);
		});

		it("attach() marks as attached", () => {
			bridge.attach();
			expect(bridge.stats.attached).toBe(true);
		});

		it("attach() is idempotent", () => {
			bridge.attach();
			bridge.attach();
			expect(bridge.stats.attached).toBe(true);
		});

		it("detach() marks as detached", () => {
			bridge.attach();
			bridge.detach();
			expect(bridge.stats.attached).toBe(false);
		});

		it("detach() is idempotent", () => {
			bridge.detach(); // detach without attach — should not throw
			bridge.detach();
			expect(bridge.stats.attached).toBe(false);
		});
	});

	// ── Deposit on task_request ──────────────────────────────────────────────

	describe("task_request deposits", () => {
		it("deposits a NORMAL-priority task_request to Akasha", async () => {
			bridge.attach();
			const req = buildTaskRequest("orchestrator", "worker-1", "fix the bug");
			bus.publish(req);

			// akashaDeposit is fire-and-forget — await microtask flush
			await vi.waitFor(() =>
				expect(chitragupta.akashaDeposit).toHaveBeenCalledWith(
					expect.stringContaining("task_request"),
					"agent_task_request",
					expect.arrayContaining(["agent-bus", "task-request", "from:orchestrator", "to:worker-1"]),
				),
			);
			expect(bridge.stats.depositCount).toBe(1);
		});

		it("skips LOW-priority task_requests by default", async () => {
			bridge.attach();
			const req = buildTaskRequest("a", "b", "low-pri task", {
				priority: AgentMessagePriority.LOW,
			});
			bus.publish(req);
			await new Promise((r) => setTimeout(r, 20));
			expect(chitragupta.akashaDeposit).not.toHaveBeenCalled();
		});

		it("deposits HIGH-priority task_requests", async () => {
			bridge.attach();
			const req = buildTaskRequest("a", "b", "urgent", {
				priority: AgentMessagePriority.HIGH,
			});
			bus.publish(req);
			await vi.waitFor(() => expect(chitragupta.akashaDeposit).toHaveBeenCalled());
		});

		it("includes constraints in the deposit content when present", async () => {
			bridge.attach();
			const req = buildTaskRequest("a", "b", "task with constraints", {
				constraints: { maxTokens: 500 },
			});
			bus.publish(req);
			await vi.waitFor(() =>
				expect(chitragupta.akashaDeposit).toHaveBeenCalledWith(
					expect.stringContaining("maxTokens"),
					expect.anything(),
					expect.anything(),
				),
			);
		});
	});

	// ── Deposit on task_result ───────────────────────────────────────────────

	describe("task_result deposits", () => {
		it("deposits a task_result to Akasha", async () => {
			bridge.attach();
			const result = buildTaskResult("worker-1", "req-1", true, "tests written", {
				metrics: { durationMs: 800, tokensUsed: 200 },
			});
			bus.publish(result);

			await vi.waitFor(() =>
				expect(chitragupta.akashaDeposit).toHaveBeenCalledWith(
					expect.stringContaining("task_result"),
					"agent_task_result",
					expect.arrayContaining(["success"]),
				),
			);
		});

		it("includes failure tag for unsuccessful results", async () => {
			bridge.attach();
			bus.publish(buildTaskResult("w", "r", false, "it failed"));

			await vi.waitFor(() =>
				expect(chitragupta.akashaDeposit).toHaveBeenCalledWith(
					expect.anything(),
					"agent_task_result",
					expect.arrayContaining(["failure"]),
				),
			);
		});

		it("includes metrics in the deposit content when present", async () => {
			bridge.attach();
			bus.publish(buildTaskResult("w", "r", true, "done", { metrics: { durationMs: 1200, tokensUsed: 600 } }));
			await vi.waitFor(() =>
				expect(chitragupta.akashaDeposit).toHaveBeenCalledWith(
					expect.stringContaining("1200ms"),
					expect.anything(),
					expect.anything(),
				),
			);
		});
	});

	// ── Capability events ────────────────────────────────────────────────────

	describe("capability_query / capability_response deposits", () => {
		it("deposits a capability_query", async () => {
			bridge.attach();
			bus.publish({
				type: "capability_query",
				id: "capq-1",
				from: "orch",
				capability: "typescript",
				timestamp: Date.now(),
			});
			await vi.waitFor(() =>
				expect(chitragupta.akashaDeposit).toHaveBeenCalledWith(
					expect.stringContaining("typescript"),
					"agent_capability_query",
					expect.arrayContaining(["capability", "typescript"]),
				),
			);
		});

		it("deposits a capability_response", async () => {
			bridge.attach();
			bus.publish({
				type: "capability_response",
				id: "capr-1",
				from: "worker-1",
				queryId: "capq-1",
				capabilities: ["typescript", "testing"],
				confidence: 0.9,
				timestamp: Date.now(),
			});
			await vi.waitFor(() =>
				expect(chitragupta.akashaDeposit).toHaveBeenCalledWith(
					expect.stringContaining("0.90"),
					"agent_capability_response",
					expect.arrayContaining(["from:worker-1"]),
				),
			);
		});
	});

	// ── Detach stops deposits ────────────────────────────────────────────────

	describe("detach stops deposits", () => {
		it("stops depositing after detach()", async () => {
			bridge.attach();
			bridge.detach();

			bus.publish(buildTaskRequest("a", "b", "task after detach"));
			await new Promise((r) => setTimeout(r, 20));
			expect(chitragupta.akashaDeposit).not.toHaveBeenCalled();
		});
	});

	// ── Error resilience ─────────────────────────────────────────────────────

	describe("error resilience", () => {
		it("increments errorCount when akashaDeposit throws", async () => {
			vi.mocked(chitragupta.akashaDeposit).mockRejectedValue(new Error("oops"));
			bridge.attach();
			bus.publish(buildTaskRequest("a", "b", "failing deposit"));

			await vi.waitFor(() => expect(bridge.stats.errorCount).toBe(1));
			expect(bridge.stats.depositCount).toBe(0);
		});

		it("continues processing after an Akasha error", async () => {
			vi.mocked(chitragupta.akashaDeposit).mockRejectedValueOnce(new Error("transient")).mockResolvedValue(undefined);

			bridge.attach();
			bus.publish(buildTaskRequest("a", "b", "first"));
			bus.publish(buildTaskRequest("a", "b", "second"));

			await vi.waitFor(() => expect(bridge.stats.depositCount).toBe(1));
			await vi.waitFor(() => expect(bridge.stats.errorCount).toBe(1));
		});
	});

	// ── Stats ────────────────────────────────────────────────────────────────

	describe("stats", () => {
		it("reports correct deposit counts", async () => {
			bridge.attach();
			bus.publish(buildTaskRequest("a", "b", "t1"));
			bus.publish(buildTaskResult("b", "x", true, "done"));

			await vi.waitFor(() => expect(bridge.stats.depositCount).toBe(2));
		});
	});

	// ── minPriority option ───────────────────────────────────────────────────

	describe("minPriority option", () => {
		it("deposits LOW priority messages when minPriority is LOW", async () => {
			const lowBridge = new ChitraguptaBusBridge(bus, chitragupta, {
				minPriority: AgentMessagePriority.LOW,
			});
			lowBridge.attach();

			bus.publish(buildTaskRequest("a", "b", "low-pri", { priority: AgentMessagePriority.LOW }));
			await vi.waitFor(() => expect(chitragupta.akashaDeposit).toHaveBeenCalled());
			lowBridge.detach();
		});

		it("skips NORMAL messages when minPriority is HIGH", async () => {
			const highBridge = new ChitraguptaBusBridge(bus, chitragupta, {
				minPriority: AgentMessagePriority.HIGH,
			});
			highBridge.attach();

			bus.publish(buildTaskRequest("a", "b", "normal-pri")); // NORMAL priority
			await new Promise((r) => setTimeout(r, 20));
			expect(chitragupta.akashaDeposit).not.toHaveBeenCalled();
			highBridge.detach();
		});
	});
});
