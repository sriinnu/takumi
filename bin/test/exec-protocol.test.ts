import { describe, expect, it } from "vitest";
import {
	EXEC_EXIT_CODES,
	createAgentEventEnvelope,
	createBootstrapStatusEvent,
	createRunCompletedEvent,
	createRunFailedEvent,
	sanitizeAgentEvent,
} from "../cli/exec-protocol.js";

describe("exec protocol", () => {
	it("sanitizes agent error events for NDJSON output", () => {
		const event = sanitizeAgentEvent({
			type: "error",
			error: new TypeError("boom"),
		});

		expect(event.type).toBe("error");
		expect(event.error).toMatchObject({ name: "TypeError", message: "boom" });
	});

	it("wraps agent events in the exec envelope", () => {
		const envelope = createAgentEventEnvelope("exec-123", {
			type: "tool_result",
			id: "tool-1",
			name: "read_file",
			output: "done",
			isError: false,
		});

		expect(envelope.protocol).toBe("takumi.exec.v1");
		expect(envelope.kind).toBe("agent_event");
		expect(envelope.event).toMatchObject({ type: "tool_result", name: "read_file" });
	});

	it("creates bootstrap status events with serialized errors", () => {
		const envelope = createBootstrapStatusEvent({
			runId: "exec-123",
			bootstrap: {
				connected: false,
				degraded: true,
				transport: "unavailable",
				memoryEntries: 0,
				vasanaCount: 0,
				hasHealth: false,
				summary: "offline",
				sideAgents: {
					enabled: false,
					degraded: true,
					reason: "tmux_unavailable",
					summary: "tmux is unavailable",
				},
				error: new Error("socket missing"),
			},
		});

		expect(envelope.bootstrap.error).toMatchObject({ message: "socket missing" });
		expect(envelope.bootstrap.sideAgents).toMatchObject({ reason: "tmux_unavailable" });
	});

	it("creates a stable completion envelope", () => {
		const envelope = createRunCompletedEvent({
			runId: "exec-123",
			durationMs: 1250,
			stopReason: "end_turn",
			stats: { textChars: 42, toolCalls: 2, toolErrors: 1 },
			bootstrapConnected: true,
			usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
			session: { projectPath: "/tmp/project", canonicalSessionId: "cg-123" },
			routing: { capability: "coding.exec.oneshot", authority: "takumi-fallback", enforcement: "capability-only" },
			artifacts: [{ type: "exec-result", summary: "done" }],
			filesChanged: ["src/index.ts"],
		});

		expect(envelope.kind).toBe("run_completed");
		expect(envelope.exitCode).toBe(EXEC_EXIT_CODES.OK);
		expect(envelope.stats.toolErrors).toBe(1);
		expect(envelope.bootstrapConnected).toBe(true);
		expect(envelope.session?.canonicalSessionId).toBe("cg-123");
		expect(envelope.artifacts).toHaveLength(1);
		expect(envelope.filesChanged).toEqual(["src/index.ts"]);
	});

	it("creates a stable failure envelope", () => {
		const envelope = createRunFailedEvent({
			runId: "exec-123",
			exitCode: EXEC_EXIT_CODES.CONFIG,
			phase: "config",
			error: new Error("missing auth"),
			session: { projectPath: "/tmp/project" },
			routing: { capability: "coding.exec.oneshot", authority: "takumi-fallback", enforcement: "capability-only" },
		});

		expect(envelope.kind).toBe("run_failed");
		expect(envelope.exitCode).toBe(EXEC_EXIT_CODES.CONFIG);
		expect(envelope.category).toBe("config");
		expect(envelope.error.message).toBe("missing auth");
	});
});
