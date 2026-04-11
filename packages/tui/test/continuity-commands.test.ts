import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionData, TakumiConfig } from "@takumi/core";
import { loadSession } from "@takumi/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppCommandContext } from "../src/commands/app-command-context.js";
import { registerContinuityCommands } from "../src/commands/app-commands-continuity.js";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { buildPersistedContinuityState } from "../src/continuity/continuity-persistence.js";
import { AppState } from "../src/state.js";

function makeConfig(): TakumiConfig {
	return {
		provider: "anthropic",
		model: "claude-sonnet-4",
		theme: "default",
		thinking: false,
		thinkingBudget: 0,
		workingDirectory: process.cwd(),
	} as TakumiConfig;
}

function makeContext(state: AppState, commands: SlashCommandRegistry): AppCommandContext {
	const addInfoMessage = (text: string) => {
		state.addMessage({
			id: `info-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			role: "assistant",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		});
	};

	return {
		commands,
		state,
		agentRunner: null,
		config: makeConfig(),
		autoPr: false,
		autoShip: false,
		addInfoMessage,
		buildSessionData: () => {
			const continuity = buildPersistedContinuityState(state);
			return {
				id: state.sessionId.value,
				title: "Continuity test session",
				createdAt: state.messages.value[0]?.timestamp ?? Date.now(),
				updatedAt: Date.now(),
				messages: state.messages.value,
				model: state.model.value,
				tokenUsage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
				controlPlane: {
					canonicalSessionId: state.canonicalSessionId.value || undefined,
					...(continuity ? { continuity } : {}),
				},
			} satisfies SessionData;
		},
		startAutoSaver: () => {},
		quit: async () => {},
		getActiveCoder: () => null,
		setActiveCoder: () => {},
		getActiveAutocycle: () => null,
		setActiveAutocycle: () => {},
	};
}

function lastInfo(state: AppState): string {
	const last = state.messages.value.at(-1);
	const block = last?.content.find((item) => item.type === "text");
	return block?.type === "text" ? block.text : "";
}

describe("continuity slash commands", () => {
	let originalHome: string | undefined;
	let tempHome: string;

	beforeEach(async () => {
		originalHome = process.env.HOME;
		tempHome = await mkdtemp(join(tmpdir(), "takumi-continuity-tui-"));
		process.env.HOME = tempHome;
		delete process.env.TAKUMI_BRIDGE_PUBLIC_URL;
		process.env.TAKUMI_BRIDGE_PORT = "4310";
	});

	afterEach(async () => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		delete process.env.TAKUMI_BRIDGE_PUBLIC_URL;
		delete process.env.TAKUMI_BRIDGE_PORT;
		await rm(tempHome, { recursive: true, force: true });
	});

	it("creates and persists a mobile continuity grant", async () => {
		const state = new AppState();
		const commands = new SlashCommandRegistry();
		const ctx = makeContext(state, commands);
		state.sessionId.value = "session-continuity";
		state.canonicalSessionId.value = "canon-continuity";
		state.model.value = "claude-sonnet-4";
		state.messages.value = [
			{
				id: "user-1",
				role: "user",
				content: [{ type: "text", text: "Pair to my phone" }],
				timestamp: Date.now(),
			},
		];

		registerContinuityCommands(ctx);
		await commands.execute("/pair mobile 15");

		expect(state.continuityGrants.value).toHaveLength(1);
		const grant = state.continuityGrants.value[0];
		expect(grant.canonicalSessionId).toBe("canon-continuity");
		expect(grant.kind).toBe("phone");
		expect(grant.initialRole).toBe("observer");
		expect(grant.transportRef).toBe("http://127.0.0.1:4310/continuity/redeem");
		expect(lastInfo(state)).toContain("Companion continuity grant created.");
		expect(lastInfo(state)).toContain('"redeemUrl":"http://127.0.0.1:4310/continuity/redeem"');

		const persisted = await loadSession("session-continuity");
		expect(persisted?.controlPlane?.continuity?.grants).toHaveLength(1);
		expect(persisted?.controlPlane?.continuity?.grants?.[0]?.grantId).toBe(grant.grantId);
		expect(persisted?.controlPlane?.continuity?.events?.[0]?.kind).toBe("grant-issued");
	});

	it("reports continuity state and supports the /drift alias", async () => {
		const state = new AppState();
		const commands = new SlashCommandRegistry();
		const ctx = makeContext(state, commands);
		state.sessionId.value = "session-drift";
		state.messages.value = [
			{
				id: "user-1",
				role: "user",
				content: [{ type: "text", text: "Need a companion" }],
				timestamp: Date.now(),
			},
		];

		registerContinuityCommands(ctx);
		await commands.execute("/drift 5");
		expect(state.continuityGrants.value).toHaveLength(1);

		await commands.execute("/continuity");
		expect(lastInfo(state)).toContain("Continuity state:");
		expect(lastInfo(state)).toContain("Grants           : 1");
		expect(lastInfo(state)).toContain("Recent events:");
	});

	it("revokes and clears persisted continuity grants", async () => {
		const state = new AppState();
		const commands = new SlashCommandRegistry();
		const ctx = makeContext(state, commands);
		state.sessionId.value = "session-admin";
		state.canonicalSessionId.value = "canon-admin";
		state.messages.value = [
			{
				id: "user-1",
				role: "user",
				content: [{ type: "text", text: "Let me manage those grants" }],
				timestamp: Date.now(),
			},
		];

		registerContinuityCommands(ctx);
		await commands.execute("/pair mobile 5");
		const revokedGrantId = state.continuityGrants.value[0]?.grantId;
		expect(revokedGrantId).toBeTruthy();

		await commands.execute("/pair mobile 10");
		expect(state.continuityGrants.value).toHaveLength(2);

		await commands.execute(`/continuity revoke ${revokedGrantId}`);
		expect(lastInfo(state)).toContain(`Revoked continuity grant ${revokedGrantId}.`);
		expect(state.continuityGrants.value).toHaveLength(1);
		expect(state.continuityGrants.value.some((grant) => grant.grantId === revokedGrantId)).toBe(false);

		let persisted = await loadSession("session-admin");
		expect(persisted?.controlPlane?.continuity?.grants).toHaveLength(1);
		expect(persisted?.controlPlane?.continuity?.grants?.some((grant) => grant.grantId === revokedGrantId)).toBe(false);

		await commands.execute("/continuity clear-grants");
		expect(lastInfo(state)).toContain("Cleared 1 continuity grant.");
		expect(state.continuityGrants.value).toHaveLength(0);

		persisted = await loadSession("session-admin");
		expect(persisted?.controlPlane?.continuity?.grants).toBeUndefined();
		expect(persisted?.controlPlane?.continuity?.events?.length).toBeGreaterThan(0);
	});
});
