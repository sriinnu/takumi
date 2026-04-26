import { KEY_CODES } from "@takumi/core";
import { Screen } from "@takumi/render";
import { describe, expect, it, vi } from "vitest";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { ExtensionUiStore } from "../src/extension-ui-store.js";
import { KeyBindingRegistry } from "../src/input/keybinds.js";
import { DialogOverlay } from "../src/panels/dialog-overlay.js";
import { AppState } from "../src/state.js";

function readRow(screen: Screen, row: number): string {
	let text = "";
	for (let col = 0; col < screen.width; col++) {
		text += screen.get(row, col).char;
	}
	return text.trimEnd();
}

describe("DialogOverlay", () => {
	it("renders the model picker when the dialog is active", () => {
		const state = new AppState();
		state.provider.value = "anthropic";
		state.model.value = "claude-sonnet-4-20250514";
		state.pushDialog("model-picker");

		const overlay = new DialogOverlay({ state });
		const screen = new Screen(80, 24);
		overlay.render(screen, { x: 0, y: 0, width: 80, height: 24 });

		const rows = Array.from({ length: 24 }, (_, row) => readRow(screen, row)).join("\n");
		expect(rows).toContain("Model Picker");
		expect(rows).toContain("claude-sonnet-4-20250514");
	});

	it("renders dynamic provider models in the model picker", () => {
		const state = new AppState();
		state.setAvailableProviderModels({ moonshot: ["kimi-k2.5", "kimi-k2"] });
		state.provider.value = "moonshot";
		state.model.value = "kimi-k2.5";
		state.pushDialog("model-picker");

		const overlay = new DialogOverlay({ state });
		const screen = new Screen(80, 24);
		overlay.render(screen, { x: 0, y: 0, width: 80, height: 24 });

		const rows = Array.from({ length: 24 }, (_, row) => readRow(screen, row)).join("\n");
		expect(rows).toContain("kimi-k2.5");
		expect(rows).toContain("kimi-k2");
	});

	it("does not activate or consume keys for permission prompts (handled inline now)", () => {
		// Permission rendering moved out of the modal layer into the message
		// list (panels/permission-card.ts) and key handling moved into the
		// input handler. The overlay must stay inert for permission state so
		// the chat keeps drawing and decision keys reach the input pipeline.
		const state = new AppState();
		const resolve = vi.fn();
		state.pendingPermission.value = {
			approvalId: "ap-test",
			tool: "read_file",
			args: { filePath: "README.md" },
			resolve,
		};

		const overlay = new DialogOverlay({ state });
		expect(overlay.active).toBe(false);

		const consumed = overlay.handleKey({
			key: "enter",
			ctrl: false,
			alt: false,
			shift: false,
			meta: false,
			raw: KEY_CODES.ENTER,
		});
		expect(consumed).toBe(false);
		expect(resolve).not.toHaveBeenCalled();
		expect(state.pendingPermission.value).not.toBeNull();
	});

	it("executes command palette keybind items and closes the dialog", () => {
		const state = new AppState();
		const commands = new SlashCommandRegistry();
		const keybinds = new KeyBindingRegistry();
		const handler = vi.fn();
		keybinds.register("ctrl+k", "Command palette", handler);
		state.pushDialog("command-palette");

		const overlay = new DialogOverlay({ state, commands, keybinds });
		const consumed = overlay.handleKey({
			key: "enter",
			ctrl: false,
			alt: false,
			shift: false,
			meta: false,
			raw: KEY_CODES.ENTER,
		});

		expect(consumed).toBe(true);
		expect(handler).toHaveBeenCalledOnce();
		expect(state.topDialog).toBeNull();
	});

	it("renders grouped command-palette sections with a detail block on tall terminals", () => {
		const state = new AppState();
		const commands = new SlashCommandRegistry();
		const keybinds = new KeyBindingRegistry();
		commands.register("/model", "Change model", vi.fn());
		commands.register("/review", "Run review", vi.fn());
		keybinds.register("ctrl+k", "Command palette", vi.fn(), { id: "app.command-palette.toggle" });
		state.pushDialog("command-palette");

		const overlay = new DialogOverlay({ state, commands, keybinds });
		const screen = new Screen(100, 40);
		overlay.render(screen, { x: 0, y: 0, width: 100, height: 40 });

		const rows = Array.from({ length: 40 }, (_, row) => readRow(screen, row)).join("\n");
		expect(rows).toContain("Command Palette");
		expect(rows).toContain("Runtime");
		expect(rows).toContain("Review");
		expect(rows).toContain("Details");
	});

	it("renders extension confirm prompts ahead of normal dialogs", () => {
		const state = new AppState();
		const extensionUiStore = new ExtensionUiStore();
		state.pushDialog("model-picker");
		void extensionUiStore.requestConfirm("Proceed with extension?");

		const overlay = new DialogOverlay({ state, extensionUiStore });
		const screen = new Screen(80, 24);
		overlay.render(screen, { x: 0, y: 0, width: 80, height: 24 });

		const rows = Array.from({ length: 24 }, (_, row) => readRow(screen, row)).join("\n");
		expect(rows).toContain("Proceed with extension?");
		expect(rows).not.toContain("Model Picker");
	});

	it("resolves extension pick prompts from keyboard navigation", async () => {
		const state = new AppState();
		const extensionUiStore = new ExtensionUiStore();
		const result = extensionUiStore.requestPick(
			[
				{ label: "Alpha", value: "a" },
				{ label: "Beta", value: "b" },
			],
			"Select item",
		);
		const overlay = new DialogOverlay({ state, extensionUiStore });

		overlay.handleKey({
			key: "down",
			ctrl: false,
			alt: false,
			shift: false,
			meta: false,
			raw: KEY_CODES.DOWN,
		});
		overlay.handleKey({
			key: "enter",
			ctrl: false,
			alt: false,
			shift: false,
			meta: false,
			raw: KEY_CODES.ENTER,
		});

		await expect(result).resolves.toBe("b");
		expect(extensionUiStore.activePrompt.value).toBeNull();
	});
});
