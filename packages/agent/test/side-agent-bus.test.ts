import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentBus } from "../src/cluster/agent-bus.js";
import type { AgentMessage } from "../src/cluster/types.js";
import { AgentMessagePriority } from "../src/cluster/types.js";
import {
	agentBusPublishDefinition,
	createAgentBusPublishHandler,
	registerSideAgentBusTools,
} from "../src/tools/side-agent-bus.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDeps(overrides: { agentId?: string } = {}) {
	const bus = new AgentBus({ maxHistory: 50 });
	const publishSpy = vi.spyOn(bus, "publish");
	return { bus, publishSpy, deps: { bus, ...overrides } };
}

// ── Tool definition ───────────────────────────────────────────────────────────

describe("agentBusPublishDefinition", () => {
	it("has the correct tool name", () => {
		expect(agentBusPublishDefinition.name).toBe("takumi_agent_bus_publish");
	});

	it("requires type and description", () => {
		expect(agentBusPublishDefinition.inputSchema.required).toEqual(["type", "description"]);
	});

	it("does not require permission", () => {
		expect(agentBusPublishDefinition.requiresPermission).toBe(false);
	});
});

// ── createAgentBusPublishHandler ──────────────────────────────────────────────

describe("createAgentBusPublishHandler", () => {
	let bus: AgentBus;
	let publishSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		const setup = makeDeps();
		bus = setup.bus;
		publishSpy = setup.publishSpy;
	});

	// ── Validation ────────────────────────────────────────────────────────

	it("returns an error when description is missing", async () => {
		const handler = createAgentBusPublishHandler({ bus });
		const result = await handler({ type: "task_request", description: "" });
		expect(result.isError).toBe(true);
		expect(result.output).toContain("description is required");
		expect(publishSpy).not.toHaveBeenCalled();
	});

	it("returns an error for an unknown message type", async () => {
		const handler = createAgentBusPublishHandler({ bus });
		const result = await handler({ type: "unknown_type", description: "something" });
		expect(result.isError).toBe(true);
		expect(result.output).toContain("unknown message type");
		expect(publishSpy).not.toHaveBeenCalled();
	});

	// ── Default from field ────────────────────────────────────────────────

	it('uses "main" as the from field when agentId is not set', async () => {
		const handler = createAgentBusPublishHandler({ bus });
		await handler({ type: "task_request", description: "do the thing" });
		expect(publishSpy).toHaveBeenCalledOnce();
		const msg = publishSpy.mock.calls[0][0] as AgentMessage;
		expect(msg.from).toBe("main");
	});

	it("uses the provided agentId as the from field", async () => {
		const handler = createAgentBusPublishHandler({ bus, agentId: "worker-1" });
		await handler({ type: "task_request", description: "do the thing" });
		const msg = publishSpy.mock.calls[0][0] as AgentMessage;
		expect(msg.from).toBe("worker-1");
	});

	// ── task_request ──────────────────────────────────────────────────────

	describe("task_request", () => {
		it("publishes a task_request message and returns success", async () => {
			const handler = createAgentBusPublishHandler({ bus });
			const result = await handler({ type: "task_request", description: "analyse the diff" });
			expect(result.isError).toBe(false);
			expect(publishSpy).toHaveBeenCalledOnce();
			const msg = publishSpy.mock.calls[0][0] as AgentMessage;
			expect(msg.type).toBe("task_request");
		});

		it("sets the to field from input", async () => {
			const handler = createAgentBusPublishHandler({ bus });
			await handler({ type: "task_request", description: "help", to: "agent-2" });
			const msg = publishSpy.mock.calls[0][0] as { to: string | null };
			expect(msg.to).toBe("agent-2");
		});

		it("defaults to null (broadcast) when to is omitted", async () => {
			const handler = createAgentBusPublishHandler({ bus });
			await handler({ type: "task_request", description: "help" });
			const msg = publishSpy.mock.calls[0][0] as { to: string | null };
			expect(msg.to).toBeNull();
		});

		it("maps priority string HIGH to AgentMessagePriority.HIGH", async () => {
			const handler = createAgentBusPublishHandler({ bus });
			await handler({ type: "task_request", description: "urgent", priority: "HIGH" });
			const msg = publishSpy.mock.calls[0][0] as { priority: AgentMessagePriority };
			expect(msg.priority).toBe(AgentMessagePriority.HIGH);
		});

		it("maps priority string CRITICAL to AgentMessagePriority.CRITICAL", async () => {
			const handler = createAgentBusPublishHandler({ bus });
			await handler({ type: "task_request", description: "critical", priority: "CRITICAL" });
			const msg = publishSpy.mock.calls[0][0] as { priority: AgentMessagePriority };
			expect(msg.priority).toBe(AgentMessagePriority.CRITICAL);
		});

		it("defaults to NORMAL priority when priority is omitted", async () => {
			const handler = createAgentBusPublishHandler({ bus });
			await handler({ type: "task_request", description: "normal task" });
			const msg = publishSpy.mock.calls[0][0] as { priority: AgentMessagePriority };
			expect(msg.priority).toBe(AgentMessagePriority.NORMAL);
		});

		it("defaults to NORMAL priority for an unrecognised priority string", async () => {
			const handler = createAgentBusPublishHandler({ bus });
			await handler({ type: "task_request", description: "task", priority: "TURBO" });
			const msg = publishSpy.mock.calls[0][0] as { priority: AgentMessagePriority };
			expect(msg.priority).toBe(AgentMessagePriority.NORMAL);
		});

		it("includes the published id in the output JSON", async () => {
			const handler = createAgentBusPublishHandler({ bus });
			const result = await handler({ type: "task_request", description: "check this" });
			const parsed = JSON.parse(result.output) as { published: boolean; id: string };
			expect(parsed.published).toBe(true);
			expect(typeof parsed.id).toBe("string");
		});
	});

	// ── discovery_share ───────────────────────────────────────────────────

	describe("discovery_share", () => {
		it("publishes a discovery_share message", async () => {
			const handler = createAgentBusPublishHandler({ bus });
			const result = await handler({
				type: "discovery_share",
				description: "found a security issue",
				topic: "security",
			});
			expect(result.isError).toBe(false);
			expect(publishSpy).toHaveBeenCalledOnce();
			const msg = publishSpy.mock.calls[0][0] as AgentMessage;
			expect(msg.type).toBe("discovery_share");
		});

		it("uses the topic from input", async () => {
			const handler = createAgentBusPublishHandler({ bus });
			await handler({ type: "discovery_share", description: "finding", topic: "performance" });
			const msg = publishSpy.mock.calls[0][0] as { topic: string };
			expect(msg.topic).toBe("performance");
		});

		it('defaults topic to "general" when omitted', async () => {
			const handler = createAgentBusPublishHandler({ bus });
			await handler({ type: "discovery_share", description: "finding" });
			const msg = publishSpy.mock.calls[0][0] as { topic: string };
			expect(msg.topic).toBe("general");
		});

		it("uses the payload from input", async () => {
			const handler = createAgentBusPublishHandler({ bus });
			const payload = { lines: 42, file: "foo.ts" };
			await handler({ type: "discovery_share", description: "finding", payload });
			const msg = publishSpy.mock.calls[0][0] as { payload: unknown };
			expect(msg.payload).toEqual(payload);
		});

		it("defaults payload to { summary: description } when omitted", async () => {
			const handler = createAgentBusPublishHandler({ bus });
			await handler({ type: "discovery_share", description: "no payload here" });
			const msg = publishSpy.mock.calls[0][0] as { payload: { summary: string } };
			expect(msg.payload).toEqual({ summary: "no payload here" });
		});
	});

	// ── help_request ──────────────────────────────────────────────────────

	describe("help_request", () => {
		it("publishes a help_request message", async () => {
			const handler = createAgentBusPublishHandler({ bus });
			const result = await handler({
				type: "help_request",
				description: "need help with types",
				requiredCapabilities: ["typescript"],
			});
			expect(result.isError).toBe(false);
			expect(publishSpy).toHaveBeenCalledOnce();
			const msg = publishSpy.mock.calls[0][0] as AgentMessage;
			expect(msg.type).toBe("help_request");
		});

		it("includes requiredCapabilities in the message", async () => {
			const handler = createAgentBusPublishHandler({ bus });
			await handler({
				type: "help_request",
				description: "help",
				requiredCapabilities: ["typescript", "testing"],
			});
			const msg = publishSpy.mock.calls[0][0] as { requiredCapabilities: string[] };
			expect(msg.requiredCapabilities).toEqual(["typescript", "testing"]);
		});

		it("defaults requiredCapabilities to [] when omitted", async () => {
			const handler = createAgentBusPublishHandler({ bus });
			await handler({ type: "help_request", description: "generic help" });
			const msg = publishSpy.mock.calls[0][0] as { requiredCapabilities: string[] };
			expect(msg.requiredCapabilities).toEqual([]);
		});

		it("includes the description in the message", async () => {
			const handler = createAgentBusPublishHandler({ bus });
			await handler({ type: "help_request", description: "stuck on async" });
			const msg = publishSpy.mock.calls[0][0] as { description: string };
			expect(msg.description).toBe("stuck on async");
		});
	});

	// ── Bus delivery ──────────────────────────────────────────────────────

	it("actually delivers the message to bus subscribers", async () => {
		const received: AgentMessage[] = [];
		bus.subscribe(
			null,
			() => true,
			(msg) => received.push(msg),
		);

		const handler = createAgentBusPublishHandler({ bus });
		await handler({ type: "task_request", description: "end-to-end check" });

		expect(received).toHaveLength(1);
		expect(received[0].type).toBe("task_request");
	});
});

// ── registerSideAgentBusTools ─────────────────────────────────────────────────

describe("registerSideAgentBusTools", () => {
	it("registers takumi_agent_bus_publish in the registry", () => {
		const { bus } = makeDeps();
		const registered = new Map<string, unknown>();
		const registry = {
			register: vi.fn((def: { name: string }, handler: unknown) => {
				registered.set(def.name, handler);
			}),
		};

		registerSideAgentBusTools(registry as never, { bus });

		expect(registry.register).toHaveBeenCalledOnce();
		expect(registered.has("takumi_agent_bus_publish")).toBe(true);
	});
});
