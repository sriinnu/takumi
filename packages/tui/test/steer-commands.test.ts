/**
 * Tests for Phase 48 — Steering commands (TUI-side).
 */

import { SteeringQueue } from "@takumi/agent";
import { describe, expect, it } from "vitest";
import { registerSteeringCommands } from "../src/app-commands-steer.js";

describe("registerSteeringCommands", () => {
	it("is a function", () => {
		expect(typeof registerSteeringCommands).toBe("function");
	});

	it("registers slash-prefixed steer commands", () => {
		const registered: string[] = [];
		const fakeCtx = {
			commands: {
				register: (name: string) => {
					registered.push(name);
				},
			},
			state: { steeringQueue: { size: 0 }, steeringPending: { value: 0 } },
			addInfoMessage: () => {},
		} as never;

		registerSteeringCommands(fakeCtx);
		expect(registered).toContain("/steer");
		expect(registered).toContain("/interrupt");
		expect(registered).toContain("/steerq");
		expect(registered).toContain("/steercancel");
		expect(registered).toContain("/steerclear");
	});

	it("shows queued ids and lets queued directives be canceled or cleared", () => {
		const handlers = new Map<string, (args: string) => void>();
		const messages: string[] = [];
		const state = {
			steeringQueue: new SteeringQueue(),
			steeringPending: { value: 0 },
		};
		const fakeCtx = {
			commands: {
				register: (name: string, _description: string, handler: (args: string) => void) => {
					handlers.set(name, handler);
				},
			},
			state,
			addInfoMessage: (message: string) => {
				messages.push(message);
			},
		} as never;

		registerSteeringCommands(fakeCtx);

		handlers.get("/steer")?.("review queued item");
		const queued = state.steeringQueue.snapshot();
		expect(queued).toHaveLength(1);
		expect(messages.at(-1)).toContain("steer-");

		handlers.get("/steerq")?.("");
		expect(messages.at(-1)).toContain(queued[0].id);

		handlers.get("/steercancel")?.(queued[0].id);
		expect(state.steeringQueue.isEmpty).toBe(true);
		expect(messages.at(-1)).toContain("Canceled queued directive");

		handlers.get("/steer")?.("first queued item");
		handlers.get("/interrupt")?.("urgent queued item");
		expect(state.steeringQueue.size).toBe(2);

		handlers.get("/steerclear")?.("");
		expect(state.steeringQueue.isEmpty).toBe(true);
		expect(messages.at(-1)).toContain("Cleared 2 queued steering directives");
	});
});
