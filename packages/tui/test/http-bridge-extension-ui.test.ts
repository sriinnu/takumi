import { describe, expect, it } from "vitest";
import { ExtensionUiStore } from "../src/extension-ui-store.js";
import {
	buildExtensionUiSnapshot,
	resolveExtensionPromptResponse,
} from "../src/http-bridge/http-bridge-extension-ui.js";

describe("http-bridge-extension-ui", () => {
	it("builds indexed pick option snapshots", () => {
		const store = new ExtensionUiStore();
		void store.requestPick(
			[
				{ label: "Alpha", value: { id: "a" } },
				{ label: "Beta", value: { id: "b" }, description: "Second" },
			],
			"Choose",
		);

		const snapshot = buildExtensionUiSnapshot(store);
		expect(snapshot?.prompt).toMatchObject({
			kind: "pick",
			optionCount: 2,
			options: [
				{ index: 0, label: "Alpha" },
				{ index: 1, label: "Beta", description: "Second" },
			],
		});
	});

	it("resolves pick responses by stable option index", async () => {
		const store = new ExtensionUiStore();
		const result = store.requestPick(
			[
				{ label: "Alpha", value: { id: "a" } },
				{ label: "Beta", value: { id: "b" } },
			],
			"Choose",
		);

		expect(resolveExtensionPromptResponse(store, { action: "pick", index: 1 })).toEqual({ success: true });
		await expect(result).resolves.toEqual({ id: "b" });
	});
});
