import type { TakumiConfig } from "@takumi/core";
import { Screen } from "@takumi/render";
import { describe, expect, it } from "vitest";
import { StatusBarPanel } from "../src/panels/status-bar.js";
import { AppState } from "../src/state.js";

/** Helper to extract text from a screen row */
function getLineText(screen: Screen, row: number): string {
	let text = "";
	for (let col = 0; col < screen.width; col++) {
		const cell = screen.get(row, col);
		text += cell.char;
	}
	return text;
}

describe("StatusBarPanel — Context Pressure (Phase 20.4)", () => {
	const createStatusBar = (config?: Partial<TakumiConfig>): { panel: StatusBarPanel; state: AppState } => {
		const state = new AppState();
		const fullConfig: TakumiConfig = {
			sessionFile: "",
			projectRoot: "",
			model: "claude-sonnet-4",
			provider: "anthropic",
			theme: "default",
			statusBar: config?.statusBar || {
				left: ["model"],
				center: ["status"],
				right: ["context", "metrics"],
			},
			...config,
		};
		const panel = new StatusBarPanel({ state, config: fullConfig });
		return { panel, state };
	};

	describe("context widget", () => {
		it("does not render when context percent is 0", () => {
			const { panel, state } = createStatusBar();
			state.contextPercent.value = 0;
			state.contextPressure.value = "normal";

			const screen = new Screen(80, 1);
			panel.render(screen, { x: 0, y: 0, width: 80, height: 1 });

			const text = getLineText(screen, 0);
			expect(text).not.toContain("0%");
		});

		it("renders green checkmark for normal pressure (<85%)", () => {
			const { panel, state } = createStatusBar();
			state.contextPercent.value = 50;
			state.contextPressure.value = "normal";

			const screen = new Screen(80, 1);
			panel.render(screen, { x: 0, y: 0, width: 80, height: 1 });

			const text = getLineText(screen, 0);
			expect(text).toContain("50%");
			expect(text).toContain("✓");
		});

		it("renders yellow warning for approaching_limit (85-95%)", () => {
			const { panel, state } = createStatusBar();
			state.contextPercent.value = 87;
			state.contextPressure.value = "approaching_limit";

			const screen = new Screen(80, 1);
			panel.render(screen, { x: 0, y: 0, width: 80, height: 1 });

			const text = getLineText(screen, 0);
			expect(text).toContain("87%");
			expect(text).toContain("⚠");
		});

		it("renders orange diamond for near_limit (95-100%)", () => {
			const { panel, state } = createStatusBar();
			state.contextPercent.value = 97;
			state.contextPressure.value = "near_limit";

			const screen = new Screen(80, 1);
			panel.render(screen, { x: 0, y: 0, width: 80, height: 1 });

			const text = getLineText(screen, 0);
			expect(text).toContain("97%");
			expect(text).toContain("◆");
		});

		it("renders red circle for at_limit (≥100%)", () => {
			const { panel, state } = createStatusBar();
			state.contextPercent.value = 102;
			state.contextPressure.value = "at_limit";

			const screen = new Screen(80, 1);
			panel.render(screen, { x: 0, y: 0, width: 80, height: 1 });

			const text = getLineText(screen, 0);
			expect(text).toContain("102%");
			expect(text).toContain("⬤");
		});

		it("rounds percentage to nearest integer", () => {
			const { panel, state } = createStatusBar();
			state.contextPercent.value = 73.8;
			state.contextPressure.value = "normal";

			const screen = new Screen(80, 1);
			panel.render(screen, { x: 0, y: 0, width: 80, height: 1 });

			const text = getLineText(screen, 0);
			expect(text).toContain("74%"); // Rounded
			expect(text).not.toContain("73.8%");
		});

		it("updates when context pressure changes", () => {
			const { panel, state } = createStatusBar();

			// Start at normal
			state.contextPercent.value = 50;
			state.contextPressure.value = "normal";

			const screen1 = new Screen(80, 1);
			panel.render(screen1, { x: 0, y: 0, width: 80, height: 1 });
			const text1 = getLineText(screen1, 0);
			expect(text1).toContain("50%");
			expect(text1).toContain("✓");

			// Update to near_limit
			state.contextPercent.value = 96;
			state.contextPressure.value = "near_limit";

			const screen2 = new Screen(80, 1);
			panel.render(screen2, { x: 0, y: 0, width: 80, height: 1 });
			const text2 = getLineText(screen2, 0);
			expect(text2).toContain("96%");
			expect(text2).toContain("◆");
		});

		it("is bold when pressure is not normal", () => {
			const { panel, state } = createStatusBar();
			state.contextPercent.value = 90;
			state.contextPressure.value = "approaching_limit";

			const screen = new Screen(80, 1);
			panel.render(screen, { x: 0, y: 0, width: 80, height: 1 });

			// Check for bold style by reading cell attributes
			const text = getLineText(screen, 0);
			expect(text).toContain("90%");

			// Find a cell with the percentage text and check if it's bold
			let foundBold = false;
			for (let col = 0; col < screen.width; col++) {
				const cell = screen.get(0, col);
				if (cell.char === "9" || cell.char === "0" || cell.char === "%") {
					if (cell.bold) foundBold = true;
				}
			}
			expect(foundBold).toBe(true);
		});
	});

	describe("context state initialization", () => {
		it("initializes with default values", () => {
			const state = new AppState();

			expect(state.contextPercent.value).toBe(0);
			expect(state.contextPressure.value).toBe("normal");
			expect(state.contextTokens.value).toBe(0);
			expect(state.contextWindow.value).toBe(200000);
		});

		it("resets context values on state.reset()", () => {
			const state = new AppState();

			// Set non-default values
			state.contextPercent.value = 85;
			state.contextPressure.value = "approaching_limit";
			state.contextTokens.value = 170000;
			state.contextWindow.value = 128000;

			// Reset
			state.reset();

			// Should return to defaults
			expect(state.contextPercent.value).toBe(0);
			expect(state.contextPressure.value).toBe("normal");
			expect(state.contextTokens.value).toBe(0);
			expect(state.contextWindow.value).toBe(200000);
		});
	});

	describe("widget configuration", () => {
		it("renders Scarlett widget when configured", () => {
			const { panel, state } = createStatusBar({
				statusBar: {
					left: ["scarlett", "model"],
					center: ["status"],
					right: ["metrics"],
				},
			});
			state.chitraguptaConnected.value = false;

			const screen = new Screen(80, 1);
			panel.render(screen, { x: 0, y: 0, width: 80, height: 1 });

			const text = getLineText(screen, 0);
			expect(text).toContain("crit");
		});

		it("includes context widget in right section by default", () => {
			const { panel, state } = createStatusBar();
			state.contextPercent.value = 75;
			state.contextPressure.value = "normal";

			const screen = new Screen(80, 1);
			panel.render(screen, { x: 0, y: 0, width: 80, height: 1 });

			const text = getLineText(screen, 0);
			// Context widget should appear on the right side
			expect(text).toContain("75%");
		});

		it("can be placed in left section", () => {
			const { panel, state } = createStatusBar({
				statusBar: {
					left: ["context", "model"],
					center: ["status"],
					right: ["metrics"],
				},
			});
			state.contextPercent.value = 60;
			state.contextPressure.value = "normal";

			const screen = new Screen(80, 1);
			panel.render(screen, { x: 0, y: 0, width: 80, height: 1 });

			const text = getLineText(screen, 0);
			expect(text).toContain("60%");
		});

		it("can be placed in center section", () => {
			const { panel, state } = createStatusBar({
				statusBar: {
					left: ["model"],
					center: ["context"],
					right: ["metrics"],
				},
			});
			state.contextPercent.value = 45;
			state.contextPressure.value = "normal";

			const screen = new Screen(80, 1);
			panel.render(screen, { x: 0, y: 0, width: 80, height: 1 });

			const text = getLineText(screen, 0);
			expect(text).toContain("45%");
		});
	});

	describe("edge cases", () => {
		it("handles context percent > 100%", () => {
			const { panel, state } = createStatusBar();
			state.contextPercent.value = 125;
			state.contextPressure.value = "at_limit";

			const screen = new Screen(80, 1);
			panel.render(screen, { x: 0, y: 0, width: 80, height: 1 });

			const text = getLineText(screen, 0);
			expect(text).toContain("125%");
			expect(text).toContain("⬤");
		});

		it("handles very small widths gracefully", () => {
			const { panel, state } = createStatusBar();
			state.contextPercent.value = 88;
			state.contextPressure.value = "approaching_limit";

			const screen = new Screen(20, 1);
			panel.render(screen, { x: 0, y: 0, width: 20, height: 1 });

			// Should not throw, text may be truncated
			const text = getLineText(screen, 0);
			expect(text.length).toBeLessThanOrEqual(20);
		});

		it("handles unknown pressure values", () => {
			const { panel, state } = createStatusBar();
			state.contextPercent.value = 50;
			state.contextPressure.value = "unknown_pressure" as any;

			const screen = new Screen(80, 1);
			expect(() => {
				panel.render(screen, { x: 0, y: 0, width: 80, height: 1 });
			}).not.toThrow();

			// Should render with a default icon
			const text = getLineText(screen, 0);
			expect(text).toContain("50%");
		});
	});
});
