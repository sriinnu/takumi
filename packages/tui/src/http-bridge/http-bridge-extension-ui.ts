/**
 * HTTP bridge extension UI snapshots.
 *
 * I convert live extension prompt/widget host state into a structured snapshot
 * so desktop and future device clients can inspect it without depending on TUI
 * internals or executable widget functions.
 */

import type { AgentStateSnapshot } from "@takumi/bridge";
import type { ExtensionUiStore, ExtensionWidgetEntry } from "../extension-ui-store.js";

const PREVIEW_WIDTH = 32;
const MAX_WIDGET_PREVIEW_LINES = 4;
const MAX_PICK_OPTIONS = 8;

type ExtensionUiSnapshot = NonNullable<AgentStateSnapshot["extensionUi"]>;
export type BridgeExtensionPromptResponse =
	| { action: "confirm" }
	| { action: "cancel" }
	| { action: "pick"; index: number };

function previewWidget(entry: ExtensionWidgetEntry): ExtensionUiSnapshot["widgets"][number] {
	try {
		const rawLines = entry.renderer(PREVIEW_WIDTH);
		const truncated = rawLines.length > MAX_WIDGET_PREVIEW_LINES;
		const previewLines = truncated ? rawLines.slice(0, MAX_WIDGET_PREVIEW_LINES) : rawLines;
		return { key: entry.key, previewLines, truncated };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { key: entry.key, previewLines: [`Widget failed: ${message}`], truncated: false };
	}
}

/** Build a transport-safe snapshot of active extension prompt/widget state. */
export function buildExtensionUiSnapshot(
	extensionUiStore: ExtensionUiStore | null | undefined,
): AgentStateSnapshot["extensionUi"] {
	if (!extensionUiStore) return null;
	const activePrompt = extensionUiStore.activePrompt.value;
	const prompt =
		activePrompt?.kind === "pick"
			? {
					kind: activePrompt.kind,
					title: activePrompt.title,
					message: activePrompt.message,
					optionCount: activePrompt.items.length,
					options: activePrompt.items.slice(0, MAX_PICK_OPTIONS).map((item, index) => ({
						index,
						label: item.label,
						description: item.description,
					})),
				}
			: activePrompt
				? {
						kind: activePrompt.kind,
						title: activePrompt.title,
						message: activePrompt.message,
					}
				: null;
	const widgets = extensionUiStore.widgets.value.map(previewWidget);
	if (!prompt && widgets.length === 0) return null;
	return { prompt, widgets };
}

/** Apply a remote operator response to the active extension prompt. */
export function resolveExtensionPromptResponse(
	extensionUiStore: ExtensionUiStore | null | undefined,
	response: BridgeExtensionPromptResponse,
): { success: boolean; error?: string } {
	if (!extensionUiStore) {
		return { success: false, error: "Extension UI not configured" };
	}
	const prompt = extensionUiStore.activePrompt.value;
	if (!prompt) {
		return { success: false, error: "No active extension prompt" };
	}
	if (response.action === "cancel") {
		extensionUiStore.cancelActivePrompt();
		return { success: true };
	}
	if (response.action === "confirm") {
		if (prompt.kind !== "confirm") {
			return { success: false, error: "Active prompt is not a confirm prompt" };
		}
		extensionUiStore.resolveActivePrompt(true);
		return { success: true };
	}
	if (prompt.kind !== "pick") {
		return { success: false, error: "Active prompt is not a pick prompt" };
	}
	const item = prompt.items[response.index];
	if (!item) {
		return { success: false, error: "Pick option index is out of range" };
	}
	extensionUiStore.resolveActivePrompt(item.value);
	return { success: true };
}
