/**
 * AppState — centralized reactive application state using signals.
 * All UI components observe these signals and re-render when they change.
 */

import type { Message, Usage, Size, PermissionDecision } from "@takumi/core";
import { signal, computed } from "@takumi/render";
import type { Signal, ReadonlySignal } from "@takumi/render";
import type { ChitraguptaBridge } from "@takumi/bridge";

export class AppState {
	// ── Conversation ──────────────────────────────────────────────────────────
	readonly messages: Signal<Message[]> = signal<Message[]>([]);
	readonly isStreaming: Signal<boolean> = signal(false);
	readonly streamingText: Signal<string> = signal("");
	readonly thinkingText: Signal<string> = signal("");

	// ── Usage tracking ────────────────────────────────────────────────────────
	readonly totalInputTokens: Signal<number> = signal(0);
	readonly totalOutputTokens: Signal<number> = signal(0);
	readonly totalCost: Signal<number> = signal(0);
	readonly turnCount: Signal<number> = signal(0);

	// ── Session ───────────────────────────────────────────────────────────────
	readonly sessionId: Signal<string> = signal("");
	readonly model: Signal<string> = signal("claude-sonnet-4-20250514");
	readonly theme: Signal<string> = signal("default");

	// ── UI state ──────────────────────────────────────────────────────────────
	readonly focusedPanel: Signal<string> = signal("input");
	readonly sidebarVisible: Signal<boolean> = signal(false);
	readonly terminalSize: Signal<Size> = signal({ width: 80, height: 24 });
	readonly showThinking: Signal<boolean> = signal(true);
	readonly activeDialog: Signal<string | null> = signal(null);

	// ── Tool execution ────────────────────────────────────────────────────────
	readonly activeTool: Signal<string | null> = signal(null);
	readonly toolOutput: Signal<string> = signal("");

	// ── Permissions ───────────────────────────────────────────────────────────
	readonly pendingPermission: Signal<{
		tool: string;
		args: Record<string, unknown>;
		resolve: (decision: PermissionDecision) => void;
	} | null> = signal(null);

	// ── File tracking ─────────────────────────────────────────────────────────
	readonly modifiedFiles: Signal<string[]> = signal<string[]>([]);

	// ── Coding agent ──────────────────────────────────────────────────────────
	readonly codingPhase: Signal<string> = signal("idle");

	// ── Chitragupta integration ───────────────────────────────────────────────
	readonly chitraguptaConnected: Signal<boolean> = signal(false);
	readonly chitraguptaBridge: Signal<ChitraguptaBridge | null> = signal(null);

	// ── Computed values ───────────────────────────────────────────────────────

	readonly messageCount: ReadonlySignal<number> = computed(() => this.messages.value.length);

	readonly totalTokens: ReadonlySignal<number> = computed(
		() => this.totalInputTokens.value + this.totalOutputTokens.value,
	);

	readonly formattedCost: ReadonlySignal<string> = computed(() => {
		const cost = this.totalCost.value;
		if (cost < 0.01) return `$${cost.toFixed(4)}`;
		return `$${cost.toFixed(2)}`;
	});

	readonly statusText: ReadonlySignal<string> = computed(() => {
		if (this.isStreaming.value) {
			const tool = this.activeTool.value;
			return tool ? `Running: ${tool}` : "Thinking...";
		}
		return `${this.turnCount.value} turns | ${this.totalTokens.value} tokens | ${this.formattedCost.value}`;
	});

	// ── Methods ───────────────────────────────────────────────────────────────

	/** Add a message to the conversation. */
	addMessage(message: Message): void {
		this.messages.value = [...this.messages.value, message];
	}

	/** Update usage counters from an API response. */
	updateUsage(usage: Usage): void {
		this.totalInputTokens.value += usage.inputTokens;
		this.totalOutputTokens.value += usage.outputTokens;
		// Rough cost estimation (Sonnet pricing)
		const inputCost = usage.inputTokens * 3 / 1_000_000;
		const outputCost = usage.outputTokens * 15 / 1_000_000;
		const cacheReadDiscount = usage.cacheReadTokens * 2.7 / 1_000_000; // 90% discount
		this.totalCost.value += inputCost + outputCost - cacheReadDiscount;
	}

	/** Reset all state for a new session. */
	reset(): void {
		this.messages.value = [];
		this.isStreaming.value = false;
		this.streamingText.value = "";
		this.thinkingText.value = "";
		this.totalInputTokens.value = 0;
		this.totalOutputTokens.value = 0;
		this.totalCost.value = 0;
		this.turnCount.value = 0;
		this.activeTool.value = null;
		this.toolOutput.value = "";
		this.pendingPermission.value = null;
		this.modifiedFiles.value = [];
		this.codingPhase.value = "idle";
		this.chitraguptaConnected.value = false;
		this.chitraguptaBridge.value = null;
	}
}
