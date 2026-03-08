import { describe, expect, it } from "vitest";
import { resetRecentDirectiveHistory, wasRecentlyHandled } from "../src/chitragupta-runtime-helpers.js";

describe("chitragupta-runtime-helpers", () => {
	it("clears directive dedupe history when reset", () => {
		const key = `prediction:router:${Date.now()}`;

		expect(wasRecentlyHandled(key, 60_000)).toBe(false);
		expect(wasRecentlyHandled(key, 60_000)).toBe(true);

		resetRecentDirectiveHistory();

		expect(wasRecentlyHandled(key, 60_000)).toBe(false);
	});
});
