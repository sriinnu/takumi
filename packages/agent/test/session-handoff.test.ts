import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChitraguptaBridge } from "@takumi/bridge";
import {
	ArtifactStore,
	type HandoffPayload,
	loadSession,
	resetHandoffCounter,
	type SessionData,
	saveSession,
} from "@takumi/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { routeResolveMock } = vi.hoisted(() => ({
	routeResolveMock: vi.fn(),
}));

vi.mock("@takumi/bridge", () => ({
	routeResolve: routeResolveMock,
}));

import { HandoffManager } from "../src/session-handoff.js";

function makeSession(id: string, model = "claude-sonnet-4"): SessionData {
	const now = Date.now();
	return {
		id,
		title: `Session ${id}`,
		createdAt: now,
		updatedAt: now,
		model,
		messages: [
			{
				id: `msg-${id}`,
				role: "user",
				content: [{ type: "text", text: `Continue ${id}` }],
				timestamp: now,
			},
		],
		tokenUsage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
	};
}

describe("HandoffManager", () => {
	let rootDir: string;
	let sessionsDir: string;
	let artifactsDir: string;

	beforeEach(async () => {
		resetHandoffCounter();
		routeResolveMock.mockReset();
		rootDir = await mkdtemp(join(tmpdir(), "takumi-handoff-agent-"));
		sessionsDir = join(rootDir, "sessions");
		artifactsDir = join(rootDir, "artifacts");
	});

	afterEach(async () => {
		await rm(rootDir, { recursive: true, force: true });
	});

	it("creates a persisted handoff artifact and captures route binding", async () => {
		routeResolveMock.mockResolvedValue({
			selected: {
				providerFamily: "anthropic",
				metadata: { modelId: "claude-opus-4" },
			},
			fallbackChain: ["adapter.local"],
			degraded: false,
			reason: "matched",
		});

		const store = new ArtifactStore({ baseDir: artifactsDir });
		const bridge = {
			isConnected: true,
			daemonSocket: "/tmp/ch.sock",
			isSocketMode: true,
			sessionCreate: vi.fn(),
		} as unknown as ChitraguptaBridge;
		const manager = new HandoffManager({ bridge, artifactStore: store, sessionsDir });

		const payload = await manager.createHandoff({
			sessionId: "session-src",
			model: "claude-sonnet-4",
			provider: "anthropic",
			daemonSessionId: "daemon-src",
			target: { kind: "new-session", id: null, label: "Fresh lane" },
			workState: {
				objective: "Finish structured handoff flow",
				decisions: ["Use route.resolve to capture the binding."],
				filesChanged: [],
				filesRead: ["packages/agent/src/session-handoff.ts"],
				blockers: [],
				validationStatus: "partial",
				nextAction: "Add TUI wiring and tests.",
			},
			routeClass: "coding.deep-reasoning",
		});

		expect(payload.routeBinding).toEqual({
			routeClass: "coding.deep-reasoning",
			providerFamily: "anthropic",
			modelId: "claude-opus-4",
			fallbackChain: ["adapter.local"],
			degraded: false,
		});

		const artifacts = await store.query({ kind: "handoff" });
		expect(artifacts).toHaveLength(1);
		expect(artifacts[0].body).toContain(payload.handoffId);
		expect(routeResolveMock).toHaveBeenCalledOnce();
	});

	it("reattaches a branch-target handoff into the existing branch session", async () => {
		const store = new ArtifactStore({ baseDir: artifactsDir });
		const manager = new HandoffManager({ artifactStore: store, sessionsDir });
		await saveSession(makeSession("branch-session", "old-model"), sessionsDir);

		const payload: HandoffPayload = {
			version: 1,
			handoffId: "hoff-branch-001",
			createdAt: new Date().toISOString(),
			source: {
				sessionId: "session-src",
				branch: "main",
				model: "claude-sonnet-4",
				provider: "anthropic",
			},
			target: { kind: "branch", id: "branch-session", label: "review" },
			workState: {
				objective: "Continue in the review branch",
				decisions: ["Branch target should reuse the prepared branch session."],
				filesChanged: [{ path: "packages/tui/src/app-commands-handoff.ts", status: "added" }],
				filesRead: ["packages/tui/src/app.ts"],
				blockers: [],
				validationStatus: "not-run",
				nextAction: "Validate the reattached branch session.",
			},
			routeBinding: {
				routeClass: "coding.patch-cheap",
				providerFamily: "anthropic",
				modelId: "claude-haiku-4",
				fallbackChain: [],
				degraded: false,
			},
			artifacts: [],
		};

		const result = await manager.reattach(payload);
		expect(result.sessionId).toBe("branch-session");
		expect(result.model).toBe("claude-sonnet-4");
		expect(result.warnings).toContain("Chitragupta daemon unavailable — using source model as fallback.");

		const session = await loadSession("branch-session", sessionsDir);
		expect(session).not.toBeNull();
		expect(session?.messages).toHaveLength(2);
		const handoffMessage = session?.messages[1]?.content[0];
		expect(handoffMessage?.type).toBe("text");
		if (handoffMessage?.type === "text") {
			expect(handoffMessage.text).toContain("## Handoff Context");
			expect(handoffMessage.text).toContain("Continue in the review branch");
			expect(handoffMessage.text).toContain("packages/tui/src/app-commands-handoff.ts");
		}
	});
});
