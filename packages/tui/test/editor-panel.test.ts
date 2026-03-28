import type { KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import { describe, expect, it, vi } from "vitest";
import { EditorPanel } from "../src/panels/editor.js";

/**
 * Build a raw key event for editor panel tests.
 */
function rawKey(raw: string, overrides: Partial<KeyEvent> = {}): KeyEvent {
	return {
		key: raw,
		ctrl: false,
		alt: false,
		shift: false,
		meta: false,
		raw,
		...overrides,
	};
}

describe("EditorPanel", () => {
	it("lets me insert a newline with Ctrl+J", () => {
		const panel = new EditorPanel({ onSubmit: () => true });
		panel.setValue("hello");

		const handled = panel.handleKey(rawKey("\n", { key: "j", ctrl: true }));

		expect(handled).toBe(true);
		expect(panel.getValue()).toBe("hello\n");
	});

	it("clears the composer only after a successful submit", () => {
		const onSubmit = vi.fn(() => true);
		const panel = new EditorPanel({ onSubmit });
		panel.setValue("ship it");

		const handled = panel.handleKey(rawKey(KEY_CODES.ENTER, { key: "return" }));

		expect(handled).toBe(true);
		expect(onSubmit).toHaveBeenCalledWith("ship it");
		expect(panel.getValue()).toBe("");
	});

	it("keeps the draft when submit is rejected", () => {
		const onSubmit = vi.fn(() => false);
		const panel = new EditorPanel({ onSubmit });
		panel.setValue("keep me");

		const handled = panel.handleKey(rawKey(KEY_CODES.ENTER, { key: "return" }));

		expect(handled).toBe(true);
		expect(onSubmit).toHaveBeenCalledWith("keep me");
		expect(panel.getValue()).toBe("keep me");
	});

	it("grows the preferred height with multiline input and caps it", () => {
		const panel = new EditorPanel({ onSubmit: () => true });
		panel.setValue(Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"));

		expect(panel.getPreferredHeight()).toBe(8);
	});

	it("recalls submitted drafts with Alt+Up and restores the in-progress draft with Alt+Down", () => {
		const onSubmit = vi.fn(() => true);
		const panel = new EditorPanel({ onSubmit });
		panel.setValue("first draft");
		panel.handleKey(rawKey(KEY_CODES.ENTER, { key: "return" }));
		panel.setValue("second draft");
		panel.handleKey(rawKey(KEY_CODES.ENTER, { key: "return" }));
		panel.setValue("working draft");

		const handledUp = panel.handleKey(rawKey(KEY_CODES.ALT_UP));
		expect(handledUp).toBe(true);
		expect(panel.getValue()).toBe("second draft");

		panel.handleKey(rawKey(KEY_CODES.ALT_UP));
		expect(panel.getValue()).toBe("first draft");

		const handledDown = panel.handleKey(rawKey(KEY_CODES.ALT_DOWN));
		expect(handledDown).toBe(true);
		expect(panel.getValue()).toBe("second draft");

		panel.handleKey(rawKey(KEY_CODES.ALT_DOWN));
		expect(panel.getValue()).toBe("working draft");
	});

	it("does not record duplicate consecutive submitted drafts", () => {
		const onSubmit = vi.fn(() => true);
		const panel = new EditorPanel({ onSubmit });
		panel.setValue("same draft");
		panel.handleKey(rawKey(KEY_CODES.ENTER, { key: "return" }));
		panel.setValue("same draft");
		panel.handleKey(rawKey(KEY_CODES.ENTER, { key: "return" }));

		panel.handleKey(rawKey(KEY_CODES.ALT_UP));
		expect(panel.getValue()).toBe("same draft");

		panel.handleKey(rawKey(KEY_CODES.ALT_UP));
		expect(panel.getValue()).toBe("same draft");
	});
});
