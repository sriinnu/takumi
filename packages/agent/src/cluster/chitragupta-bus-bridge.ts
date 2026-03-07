/**
 * ChitraguptaBusBridge — connects the AgentBus to ChitraguptaBridge.
 *
 * Subscribes to the shared agent bus and deposits semantically important
 * messages (task requests, results, capability queries) into Chitragupta's
 * Akasha long-term memory so future AI sessions can recall cross-agent work.
 *
 * Design:
 * - Non-blocking: Akasha deposits are fire-and-forget, errors are swallowed.
 * - Priority-filtered: LOW-priority chatter (heartbeats, misc shares) skipped.
 * - Scarlett-observable: exposes `stats` for integrity / health reporting.
 * - Lifecycle-safe: `attach()` / `detach()` are idempotent.
 */

import type { ChitraguptaBridge } from "@takumi/bridge";
import { createLogger } from "@takumi/core";
import type { AgentBus } from "./agent-bus.js";
import {
	type AgentCapabilityQuery,
	type AgentCapabilityResponse,
	AgentMessagePriority,
	type AgentTaskRequest,
	type AgentTaskResult,
} from "./types.js";

const log = createLogger("chitragupta-bus-bridge");

// ── Options & Stats ──────────────────────────────────────────────────────────

export interface ChitraguptaBusBridgeOptions {
	/**
	 * Only deposit messages at or above this priority.
	 * Defaults to NORMAL (1) — LOW heartbeats and discovery shares are skipped.
	 */
	minPriority?: AgentMessagePriority;
}

export interface BusBridgeStats {
	depositCount: number;
	errorCount: number;
	attached: boolean;
}

// ── ChitraguptaBusBridge ─────────────────────────────────────────────────────

export class ChitraguptaBusBridge {
	private readonly chitragupta: ChitraguptaBridge;
	private readonly bus: AgentBus;
	private readonly minPriority: AgentMessagePriority;
	private depositCount = 0;
	private errorCount = 0;
	private readonly subs: Array<{ unsubscribe(): void }> = [];
	private attached = false;

	constructor(bus: AgentBus, chitragupta: ChitraguptaBridge, options?: ChitraguptaBusBridgeOptions) {
		this.bus = bus;
		this.chitragupta = chitragupta;
		this.minPriority = options?.minPriority ?? AgentMessagePriority.NORMAL;
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────

	/** Attach subscribers — starts persisting bus events to Akasha. */
	attach(): void {
		if (this.attached) return;
		this.attached = true;

		this.subs.push(
			this.bus.on("task_request", null, (msg) => void this.depositRequest(msg)),
			this.bus.on("task_result", null, (msg) => void this.depositResult(msg)),
			this.bus.on("capability_query", null, (msg) => void this.depositCapabilityQuery(msg)),
			this.bus.on("capability_response", null, (msg) => void this.depositCapabilityResponse(msg)),
		);

		log.info("ChitraguptaBusBridge attached");
	}

	/** Detach all subscribers — stops persisting events. Idempotent. */
	detach(): void {
		if (!this.attached) return;
		for (const sub of this.subs) sub.unsubscribe();
		this.subs.length = 0;
		this.attached = false;
		log.info("ChitraguptaBusBridge detached");
	}

	/** Diagnostic stats — exposed for Scarlett integrity reporting. */
	get stats(): BusBridgeStats {
		return {
			depositCount: this.depositCount,
			errorCount: this.errorCount,
			attached: this.attached,
		};
	}

	// ── Deposit Helpers ──────────────────────────────────────────────────────

	private async depositRequest(msg: AgentTaskRequest): Promise<void> {
		if (msg.priority < this.minPriority) return;

		const parts = [
			`[bus:task_request] from=${msg.from} to=${msg.to ?? "broadcast"}`,
			`priority=${AgentMessagePriority[msg.priority]}`,
			`description=${msg.description}`,
		];
		if (msg.constraints) parts.push(`constraints=${JSON.stringify(msg.constraints)}`);

		const topics = ["agent-bus", "task-request", `from:${msg.from}`];
		if (msg.to) topics.push(`to:${msg.to}`);

		await this.deposit(parts.join(" | "), "agent_task_request", topics);
	}

	private async depositResult(msg: AgentTaskResult): Promise<void> {
		const parts = [`[bus:task_result] from=${msg.from} success=${msg.success}`, `summary=${msg.summary}`];
		if (msg.metrics) {
			parts.push(`duration=${msg.metrics.durationMs}ms tokens=${msg.metrics.tokensUsed}`);
		}

		const topics = ["agent-bus", "task-result", `from:${msg.from}`, msg.success ? "success" : "failure"];

		await this.deposit(parts.join(" | "), "agent_task_result", topics);
	}

	private async depositCapabilityQuery(msg: AgentCapabilityQuery): Promise<void> {
		const content = `[bus:capability_query] from=${msg.from} querying=${msg.capability}`;
		await this.deposit(content, "agent_capability_query", ["agent-bus", "capability", msg.capability]);
	}

	private async depositCapabilityResponse(msg: AgentCapabilityResponse): Promise<void> {
		const content = [
			`[bus:capability_response] from=${msg.from} confidence=${msg.confidence.toFixed(2)}`,
			`capabilities=${msg.capabilities.join(",")}`,
		].join(" | ");

		await this.deposit(content, "agent_capability_response", ["agent-bus", "capability", `from:${msg.from}`]);
	}

	private async deposit(content: string, type: string, topics: string[]): Promise<void> {
		try {
			await this.chitragupta.akashaDeposit(content, type, topics);
			this.depositCount++;
		} catch (err) {
			this.errorCount++;
			log.warn(`Failed to deposit ${type} to Akasha`, err);
		}
	}
}
