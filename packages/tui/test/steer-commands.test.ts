/**
 * Tests for Phase 48 — Steering commands (TUI-side).
 */

import { describe, expect, it } from "vitest";
import { registerSteeringCommands } from "../src/app-commands-steer.js";

describe("registerSteeringCommands", () => {
	it("is a function", () => {
		expect(typeof registerSteeringCommands).toBe("function");
	});

	it("registers steer, interrupt, and steerq commands", () => {
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
		expect(registered).toContain("steer");
		expect(registered).toContain("interrupt");
		expect(registered).toContain("steerq");
	});
});
