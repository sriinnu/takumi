import type { Message } from "@takumi/core";
import { describe, expect, it, vi } from "vitest";
import {
	buildSessionTitle,
	createExtensionSessionActions,
	createExtensionUiActions,
	emitExtensionSessionStart,
	normalizeSessionTitle,
} from "../src/app-extension-runtime.js";
import { ExtensionUiStore } from "../src/extension-ui-store.js";

function userTextMessage(text: string): Message {
	return {
		id: `msg-${text}`,
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

describe("app-extension-runtime", () => {
	it("builds session titles from explicit overrides before message history", () => {
		expect(buildSessionTitle([userTextMessage("derive from me")], "Pinned title")).toBe("Pinned title");
		expect(buildSessionTitle([userTextMessage("derive from me")], null)).toBe("derive from me");
	});

	it("normalizes placeholder titles back to an unset state", () => {
		expect(normalizeSessionTitle("Untitled session")).toBeNull();
		expect(normalizeSessionTitle("  ")).toBeNull();
		expect(normalizeSessionTitle("Pinned")).toBe("Pinned");
	});

	it("creates live session actions backed by current messages and title state", () => {
		let title: string | null = null;
		const messages = [userTextMessage("first"), userTextMessage("second")];
		const actions = createExtensionSessionActions({
			getMessages: () => messages,
			getSessionId: () => "session-1",
			getSessionTitle: () => title,
			setSessionTitle: (next) => {
				title = next;
			},
		});

		expect(actions.getSnapshot()).toMatchObject({
			length: 2,
			sessionId: "session-1",
		});
		expect(actions.getSnapshot().entries[1]?.message).toBe(messages[1]);
		expect(actions.getName()).toBeUndefined();
		actions.setName("Pinned");
		expect(actions.getName()).toBe("Pinned");
		actions.setName("Untitled session");
		expect(actions.getName()).toBeUndefined();
	});

	it("formats notify messages with severity labels", () => {
		const addInfoMessage = vi.fn();
		const ui = createExtensionUiActions({ addInfoMessage, uiStore: new ExtensionUiStore() });
		ui.notify("Heads up", "warning");
		ui.notify("Broken", "error");
		expect(addInfoMessage.mock.calls).toEqual([["WARNING: Heads up"], ["ERROR: Broken"]]);
	});

	it("binds live confirm, pick, and widget actions to the extension UI store", async () => {
		const addInfoMessage = vi.fn();
		const uiStore = new ExtensionUiStore();
		const ui = createExtensionUiActions({ addInfoMessage, uiStore });

		expect(ui.hasUI()).toBe(true);
		const confirmPromise = ui.confirm("Proceed?", "Confirm");
		expect(uiStore.activePrompt.value?.kind).toBe("confirm");
		uiStore.resolveActivePrompt(true);
		await expect(confirmPromise).resolves.toBe(true);

		const pickPromise = ui.pick(
			[
				{ label: "Alpha", value: "a" },
				{ label: "Beta", value: "b" },
			],
			"Select",
		);
		expect(uiStore.activePrompt.value?.kind).toBe("pick");
		uiStore.resolveActivePrompt("b");
		await expect(pickPromise).resolves.toBe("b");

		ui.setWidget("status", () => ["ready"]);
		expect(uiStore.widgets.value.map((entry) => entry.key)).toEqual(["status"]);
		ui.removeWidget("status");
		expect(uiStore.widgets.value).toEqual([]);
	});

	it("emits session_start only when a live session id exists", async () => {
		const emit = vi.fn(async () => undefined);
		await emitExtensionSessionStart({ emit } as any, "");
		await emitExtensionSessionStart({ emit } as any, "session-1");
		expect(emit).toHaveBeenCalledTimes(1);
		expect(emit).toHaveBeenCalledWith({ type: "session_start", sessionId: "session-1" });
	});
});
