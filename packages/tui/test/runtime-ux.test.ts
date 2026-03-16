import { describe, expect, it } from "vitest";
import {
	applyThinkingLevel,
	cycleProviderModel,
	cycleThinkingLevel,
	getThinkingLevel,
	normalizeThinkingLevel,
} from "../src/runtime-ux.js";
import { AppState } from "../src/state.js";

describe("runtime-ux", () => {
	it("applies named thinking levels", () => {
		const state = new AppState();
		applyThinkingLevel(state, "deep");
		expect(state.thinking.value).toBe(true);
		expect(state.thinkingBudget.value).toBe(24_000);
		expect(getThinkingLevel(state.thinking.value, state.thinkingBudget.value)).toBe("deep");
	});

	it("cycles thinking levels forward and wraps", () => {
		const state = new AppState();
		expect(cycleThinkingLevel(state, 1)).toBe("brief");
		expect(cycleThinkingLevel(state, -1)).toBe("off");
	});

	it("normalizes valid thinking levels", () => {
		expect(normalizeThinkingLevel("brief")).toBe("brief");
		expect(normalizeThinkingLevel("MAX")).toBe("max");
		expect(normalizeThinkingLevel("wizard")).toBeNull();
	});

	it("cycles provider-scoped models", () => {
		const state = new AppState();
		state.setAvailableProviderModels({ anthropic: ["claude-a", "claude-b", "claude-c"] });
		state.provider.value = "anthropic";
		state.model.value = "claude-a";

		expect(cycleProviderModel(state, 1)).toBe("claude-b");
		expect(cycleProviderModel(state, -1)).toBe("claude-a");
	});
});
