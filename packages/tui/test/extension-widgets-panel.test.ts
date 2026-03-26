import { Screen } from "@takumi/render";
import { describe, expect, it } from "vitest";
import { ExtensionUiStore } from "../src/extension-ui-store.js";
import { ExtensionWidgetsPanel } from "../src/panels/extension-widgets-panel.js";

function readRow(screen: Screen, row: number): string {
	let text = "";
	for (let col = 0; col < screen.width; col++) {
		text += screen.get(row, col).char;
	}
	return text.trimEnd();
}

describe("ExtensionWidgetsPanel", () => {
	it("measures and renders extension widgets", () => {
		const store = new ExtensionUiStore();
		store.setWidget("status_bar", () => ["alpha", "beta"]);

		const panel = new ExtensionWidgetsPanel({ extensionUiStore: store });
		expect(panel.measure(20)).toBe(4);

		const screen = new Screen(30, 10);
		panel.render(screen, { x: 0, y: 0, width: 20, height: 10 });

		const rows = Array.from({ length: 5 }, (_, row) => readRow(screen, row)).join("\n");
		expect(rows).toContain("EXTENSIONS");
		expect(rows).toContain("status bar");
		expect(rows).toContain("alpha");
		expect(rows).toContain("beta");
	});

	it("contains widget failures instead of throwing during render", () => {
		const store = new ExtensionUiStore();
		store.setWidget("broken", () => {
			throw new Error("boom");
		});

		const panel = new ExtensionWidgetsPanel({ extensionUiStore: store });
		const screen = new Screen(40, 10);
		panel.render(screen, { x: 0, y: 0, width: 30, height: 10 });

		const rows = Array.from({ length: 4 }, (_, row) => readRow(screen, row)).join("\n");
		expect(rows).toContain("Widget failed: boom");
	});
});
