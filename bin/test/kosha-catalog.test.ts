import { describe, expect, it } from "vitest";
import { unionPerProvider } from "../cli/kosha-catalog.js";

describe("unionPerProvider", () => {
	it("returns the base catalog when overlay is empty", () => {
		const base = { anthropic: ["claude-a", "claude-b"] };
		expect(unionPerProvider(base, {})).toEqual(base);
	});

	it("returns the overlay catalog when base is empty", () => {
		const overlay = { openai: ["gpt-4", "gpt-5"] };
		expect(unionPerProvider({}, overlay)).toEqual(overlay);
	});

	it("places overlay models first, base-only models appended", () => {
		const base = { minimax: ["MiniMax-M2", "MiniMax-M2-Stable"] };
		const overlay = { minimax: ["MiniMax-M2.7", "MiniMax-M2.5"] };
		expect(unionPerProvider(base, overlay)).toEqual({
			minimax: ["MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2", "MiniMax-M2-Stable"],
		});
	});

	it("dedupes entries that appear in both sides", () => {
		const base = { zai: ["glm-4.5", "glm-4.5-flash"] };
		const overlay = { zai: ["glm-4.7-flash", "glm-4.5-flash"] };
		expect(unionPerProvider(base, overlay)).toEqual({
			zai: ["glm-4.7-flash", "glm-4.5-flash", "glm-4.5"],
		});
	});

	it("merges providers that appear on only one side", () => {
		const base = { anthropic: ["claude-a"] };
		const overlay = { openai: ["gpt-5"], moonshot: ["kimi-k2"] };
		expect(unionPerProvider(base, overlay)).toEqual({
			anthropic: ["claude-a"],
			openai: ["gpt-5"],
			moonshot: ["kimi-k2"],
		});
	});

	it("drops providers whose merged list is empty", () => {
		expect(unionPerProvider({ ghost: [] }, { ghost: [] })).toEqual({});
	});

	it("preserves overlay order within a provider", () => {
		const overlay = { x: ["c", "a", "b"] };
		expect(unionPerProvider({}, overlay).x).toEqual(["c", "a", "b"]);
	});

	it("does not mutate either input", () => {
		const base = { p: ["a"] };
		const overlay = { p: ["b"] };
		unionPerProvider(base, overlay);
		expect(base).toEqual({ p: ["a"] });
		expect(overlay).toEqual({ p: ["b"] });
	});
});
