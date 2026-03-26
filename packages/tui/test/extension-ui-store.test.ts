import { describe, expect, it } from "vitest";
import { ExtensionUiStore } from "../src/extension-ui-store.js";

describe("ExtensionUiStore", () => {
	it("queues prompts and resolves them in order", async () => {
		const store = new ExtensionUiStore();
		const first = store.requestConfirm("First?");
		const second = store.requestConfirm("Second?");

		expect(store.activePrompt.value?.message).toBe("First?");
		store.resolveActivePrompt(true);
		await expect(first).resolves.toBe(true);
		expect(store.activePrompt.value?.message).toBe("Second?");
		store.cancelActivePrompt();
		await expect(second).resolves.toBe(false);
		expect(store.activePrompt.value).toBeNull();
	});

	it("replaces and removes widgets by key", () => {
		const store = new ExtensionUiStore();
		store.setWidget("status", () => ["one"]);
		store.setWidget("status", () => ["two"]);
		store.setWidget("metrics", () => ["three"]);

		expect(store.widgets.value.map((entry) => entry.key)).toEqual(["status", "metrics"]);
		expect(store.widgets.value[0]?.renderer(20)).toEqual(["two"]);

		store.removeWidget("status");
		expect(store.widgets.value.map((entry) => entry.key)).toEqual(["metrics"]);
	});

	it("clears prompts and widgets on session reset", async () => {
		const store = new ExtensionUiStore();
		const pending = store.requestPick([{ label: "A", value: "a" }], "Pick");
		store.setWidget("status", () => ["busy"]);

		store.resetSessionUi();

		await expect(pending).resolves.toBeUndefined();
		expect(store.activePrompt.value).toBeNull();
		expect(store.widgets.value).toEqual([]);
	});
});
