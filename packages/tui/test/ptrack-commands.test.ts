import type { RoutingDecision } from "@takumi/bridge";
import { ApprovalQueue, type Message } from "@takumi/core";
import { describe, expect, it, vi } from "vitest";
import { registerPTrackCommands } from "../src/commands/app-commands-ptrack.js";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { AppState } from "../src/state.js";

function lastInfoText(state: AppState): string {
	const message = [...state.messages.value].reverse().find((entry) => entry.id.startsWith("info-"));
	if (!message) return "";
	const block = message.content.find((item) => item.type === "text");
	return block?.type === "text" ? block.text : "";
}

function createContext() {
	const commands = new SlashCommandRegistry();
	const state = new AppState();
	state.approvalQueue = new ApprovalQueue({
		auditDir: `/tmp/takumi-approval-tests-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	});
	state.sessionId.value = "sess-1";
	state.provider.value = "anthropic";
	state.model.value = "claude-sonnet-4-20250514";

	const ctx = {
		commands,
		state,
		agentRunner: null,
		config: {} as never,
		autoPr: false,
		autoShip: false,
		addInfoMessage: (text: string) => {
			const message: Message = {
				id: `info-${Date.now()}`,
				role: "assistant",
				content: [{ type: "text", text }],
				timestamp: Date.now(),
			};
			state.addMessage(message);
		},
		buildSessionData: vi.fn(),
		startAutoSaver: vi.fn(),
		quit: vi.fn(),
		getActiveCoder: vi.fn().mockReturnValue(null),
		setActiveCoder: vi.fn(),
		getActiveAutocycle: vi.fn().mockReturnValue(null),
		setActiveAutocycle: vi.fn(),
	};

	registerPTrackCommands(ctx as never);
	return { commands, state };
}

async function seedApprovals(state: AppState) {
	const shellApproval = await state.approvalQueue.request("shell", "git push origin main", "sess-1");
	await state.approvalQueue.request("read_file", "src/app.ts", "sess-2");
	return { shellApproval };
}

describe("p-track slash commands", () => {
	it("shows shared runtime alerts in the fleet summary", async () => {
		const { commands, state } = createContext();
		state.contextPercent.value = 92;
		state.pendingPermission.value = {
			tool: "shell",
			args: { command: "git push" },
			resolve: () => undefined,
		};
		state.chitraguptaSync.value = {
			status: "failed",
			lastSyncedMessageId: "assistant-1",
			lastSyncedMessageTimestamp: 2000,
			lastAttemptedMessageId: "user-2",
			lastAttemptedMessageTimestamp: 3000,
			lastFailedMessageId: "user-2",
			lastFailedMessageTimestamp: 3000,
			lastSyncedAt: 2500,
			lastError: "bridge unavailable during replay",
		};
		state.setCostSnapshot({
			totalUsd: 0.12,
			totalInputTokens: 1000,
			totalOutputTokens: 500,
			turns: [],
			ratePerMinute: 0.15,
			projectedUsd: 1.62,
			budgetFraction: 0.92,
			alertLevel: "critical",
			avgCostPerTurn: 0.12,
			elapsedSeconds: 45,
		});

		await commands.execute("/fleet");

		const output = lastInfoText(state);
		expect(output).toContain("## Fleet Summary");
		expect(output).toContain("waiting_input");
		expect(output).toContain("[approval_pressure]");
		expect(output).toContain("[sync_failure]");
		expect(output).toContain("[cost_spike]");
	});

	it("acknowledges shared operator alerts", async () => {
		const { commands, state } = createContext();
		state.pendingPermission.value = {
			tool: "shell",
			args: { command: "git status" },
			resolve: () => undefined,
		};

		await commands.execute("/fleet ack approval-pending");
		expect(lastInfoText(state)).toContain("acknowledged");

		await commands.execute("/fleet alerts");
		expect(lastInfoText(state)).toBe("No active alerts.");
	});

	it("renders degraded routing history from routing decisions", async () => {
		const { commands, state } = createContext();
		state.routingDecisions.value = [
			{
				request: { consumer: "takumi", sessionId: "sess-1", capability: "coding.patch-cheap" },
				selected: {
					id: "lane-fallback",
					label: "fallback lane",
					providerFamily: "openai",
					metadata: { model: "gpt-4.1-mini" },
				} as never,
				reason: "Budget guard forced fallback",
				fallbackChain: ["anthropic-main", "openai-fallback"],
				policyTrace: ["budget guard", "selected fallback lane"],
				degraded: true,
			} satisfies RoutingDecision,
		];

		await commands.execute("/fleet degraded");

		const output = lastInfoText(state);
		expect(output).toContain("## Degraded Routes (1)");
		expect(output).toContain("coding.patch-cheap");
		expect(output).toContain("anthropic-main → openai-fallback");
		expect(output).toContain("Budget guard forced fallback");
	});

	it("shows review-grade approvals list and inspect drill-down", async () => {
		const { commands, state } = createContext();
		const { shellApproval } = await seedApprovals(state);
		state.pendingPermission.value = {
			approvalId: shellApproval.id,
			tool: shellApproval.tool,
			args: { command: "git push origin main" },
			resolve: () => undefined,
		};

		await commands.execute("/approvals");

		const listOutput = lastInfoText(state);
		expect(listOutput).toContain("## Approvals (2 total, 2 pending)");
		expect(listOutput).toContain("HIGH");
		expect(listOutput).toContain("shell");
		expect(listOutput).toContain("sess-1");
		expect(listOutput).toContain("Active prompt marker: *");

		await commands.execute(`/approvals inspect ${shellApproval.id}`);

		const detailOutput = lastInfoText(state);
		expect(detailOutput).toContain("## Approval Review");
		expect(detailOutput).toContain(`ID: ${shellApproval.id}`);
		expect(detailOutput).toContain("Risk: high");
		expect(detailOutput).toContain("Active prompt: yes");
		expect(detailOutput).toContain(`Actions: /approvals approve ${shellApproval.id}`);
	});

	it("accepts ordinal approval targets for decisions", async () => {
		const { commands, state } = createContext();
		const { shellApproval } = await seedApprovals(state);

		await commands.execute("/approvals approve 2");

		expect(lastInfoText(state)).toContain(`${shellApproval.id} → approved`);
		expect(state.approvalQueue.find(shellApproval.id)?.status).toBe("approved");
	});
});
