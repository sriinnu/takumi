import { KEY_CODES } from "@takumi/core";
import { describe, expect, it } from "vitest";
import { ExtensionPromptDialog } from "../src/dialogs/extension-prompt.js";

describe("ExtensionPromptDialog", () => {
	it("resolves confirm prompts on enter", () => {
		const dialog = new ExtensionPromptDialog();
		dialog.open({
			id: "confirm-1",
			kind: "confirm",
			title: "Confirm",
			message: "Proceed?",
			resolve: () => undefined,
			fallbackValue: false,
		});

		const outcome = dialog.handleKey({
			key: "enter",
			ctrl: false,
			alt: false,
			shift: false,
			meta: false,
			raw: KEY_CODES.ENTER,
		});

		expect(outcome).toEqual({ kind: "resolve", value: true });
		expect(dialog.isOpen).toBe(false);
	});

	it("filters and selects pick items", () => {
		const dialog = new ExtensionPromptDialog();
		dialog.open({
			id: "pick-1",
			kind: "pick",
			title: "Pick",
			message: "Choose",
			items: [
				{ label: "Alpha", value: "a" },
				{ label: "Beta", value: "b", description: "Second" },
				{ label: "Gamma", value: "g" },
			],
			resolve: () => undefined,
			fallbackValue: undefined,
		});

		dialog.handleKey({ key: "b", ctrl: false, alt: false, shift: false, meta: false, raw: "b" });
		expect(dialog.getPickItems().map((item) => item.label)).toEqual(["Beta"]);

		const outcome = dialog.handleKey({
			key: "enter",
			ctrl: false,
			alt: false,
			shift: false,
			meta: false,
			raw: KEY_CODES.ENTER,
		});

		expect(outcome).toEqual({ kind: "resolve", value: "b" });
	});
});
