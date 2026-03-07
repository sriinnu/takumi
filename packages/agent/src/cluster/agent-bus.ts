/**
 * Agent Message Bus — structured inter-agent communication.
 *
 * Replaces the linear context pipeline (planner→worker→validator) with a
 * typed publish/subscribe bus so agents can exchange structured messages.
 *
 * Design:
 * - Topic-based: subscribers filter by `AgentMessageType` or custom topic.
 * - Request/response: `request()` sends a message and awaits a correlated reply.
 * - Inbox per agent: unread messages queue when no subscriber is active.
 * - History: all messages retained for replay/checkpoint serialization.
 * - Bounded: configurable max history to prevent unbounded memory growth.
 */

import { createLogger } from "@takumi/core";
import {
	type AgentCapabilityQuery,
	type AgentCapabilityResponse,
	type AgentMessage,
	AgentMessagePriority,
	type AgentMessageType,
	type AgentTaskRequest,
	type AgentTaskResult,
} from "./types.js";

const log = createLogger("agent-bus");

// ── Subscriber & Filter ──────────────────────────────────────────────────────

/** Filter predicate for bus subscriptions. */
export type MessageFilter = (msg: AgentMessage) => boolean;

/** A subscription handle — call `unsubscribe()` to detach. */
export interface Subscription {
	unsubscribe: () => void;
}

/** Internal subscriber record. */
interface SubscriberRecord {
	id: string;
	agentId: string | null;
	filter: MessageFilter;
	callback: (msg: AgentMessage) => void;
}

// ── Bus Configuration ────────────────────────────────────────────────────────

export interface AgentBusOptions {
	/** Maximum messages retained in history (default 10 000). */
	maxHistory?: number;
	/** Request timeout in ms (default 30 000). */
	requestTimeoutMs?: number;
}

const DEFAULT_MAX_HISTORY = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

// ── AgentBus ─────────────────────────────────────────────────────────────────

export class AgentBus {
	private readonly maxHistory: number;
	private readonly requestTimeoutMs: number;
	private readonly subscribers = new Map<string, SubscriberRecord>();
	private readonly inboxes = new Map<string, AgentMessage[]>();
	private readonly history: AgentMessage[] = [];
	private subIdCounter = 0;

	constructor(options?: AgentBusOptions) {
		this.maxHistory = options?.maxHistory ?? DEFAULT_MAX_HISTORY;
		this.requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	}

	// ── Publish ───────────────────────────────────────────────────────────────

	/** Publish a message to all matching subscribers. */
	publish(msg: AgentMessage): void {
		this.history.push(msg);
		if (this.history.length > this.maxHistory) {
			this.history.splice(0, this.history.length - this.maxHistory);
		}

		// Route to "to" agent inbox if the message has a target
		const target = "to" in msg && typeof msg.to === "string" ? msg.to : null;
		if (target) {
			const inbox = this.inboxes.get(target);
			if (inbox) inbox.push(msg);
		}

		let delivered = 0;
		for (const sub of this.subscribers.values()) {
			if (sub.agentId && target && sub.agentId !== target && sub.agentId !== msg.from) continue;
			try {
				if (sub.filter(msg)) {
					sub.callback(msg);
					delivered++;
				}
			} catch (err) {
				log.error(`Subscriber ${sub.id} threw on message ${msg.type}`, err);
			}
		}

		log.debug(`Published ${msg.type} from=${msg.from} → ${delivered} subscribers`);
	}

	// ── Subscribe ─────────────────────────────────────────────────────────────

	/**
	 * Subscribe to messages matching a filter.
	 * @param agentId  If provided, only messages targeted at this agent (or
	 *                 broadcast) are delivered.
	 * @param filter   Predicate — receives every candidate message.
	 * @param callback Invoked synchronously for each matching message.
	 */
	subscribe(agentId: string | null, filter: MessageFilter, callback: (msg: AgentMessage) => void): Subscription {
		const id = `sub-${++this.subIdCounter}`;
		this.subscribers.set(id, { id, agentId, filter, callback });

		if (agentId && !this.inboxes.has(agentId)) {
			this.inboxes.set(agentId, []);
		}

		return {
			unsubscribe: () => {
				this.subscribers.delete(id);
			},
		};
	}

	/**
	 * Subscribe to a specific message type.
	 * Convenience wrapper over `subscribe()`.
	 */
	on<T extends AgentMessageType>(
		type: T,
		agentId: string | null,
		callback: (msg: Extract<AgentMessage, { type: T }>) => void,
	): Subscription {
		return this.subscribe(agentId, (msg) => msg.type === type, callback as (msg: AgentMessage) => void);
	}

	// ── Request / Response ────────────────────────────────────────────────────

	/**
	 * Send a message and await a correlated response.
	 * Matches on `taskRequestId` for task results, `queryId` for capability
	 * responses. Times out after `requestTimeoutMs`.
	 */
	async request(msg: AgentTaskRequest | AgentCapabilityQuery, signal?: AbortSignal): Promise<AgentMessage> {
		return new Promise<AgentMessage>((resolve, reject) => {
			let sub: Subscription;
			const timeout = setTimeout(() => {
				sub.unsubscribe();
				reject(new Error(`Bus request ${msg.id} timed out after ${this.requestTimeoutMs}ms`));
			}, this.requestTimeoutMs);

			sub = this.subscribe(
				null,
				(reply) => {
					if (msg.type === "task_request" && reply.type === "task_result") {
						return (reply as AgentTaskResult).taskRequestId === msg.id;
					}
					if (msg.type === "capability_query" && reply.type === "capability_response") {
						return (reply as AgentCapabilityResponse).queryId === msg.id;
					}
					return false;
				},
				(reply) => {
					clearTimeout(timeout);
					sub.unsubscribe();
					resolve(reply);
				},
			);

			signal?.addEventListener(
				"abort",
				() => {
					clearTimeout(timeout);
					sub.unsubscribe();
					reject(new Error("Bus request aborted"));
				},
				{ once: true },
			);

			this.publish(msg);
		});
	}

	// ── Inbox ─────────────────────────────────────────────────────────────────

	/** Drain all unread messages from an agent's inbox. */
	drain(agentId: string): AgentMessage[] {
		const inbox = this.inboxes.get(agentId);
		if (!inbox || inbox.length === 0) return [];
		const messages = [...inbox];
		inbox.length = 0;
		return messages;
	}

	/** Peek at an agent's inbox without consuming. */
	peek(agentId: string): readonly AgentMessage[] {
		return this.inboxes.get(agentId) ?? [];
	}

	// ── History & Query ───────────────────────────────────────────────────────

	/** Get all messages matching a filter. */
	query(filter: MessageFilter): AgentMessage[] {
		return this.history.filter(filter);
	}

	/** Get messages of a specific type. */
	queryByType<T extends AgentMessageType>(type: T): Array<Extract<AgentMessage, { type: T }>> {
		return this.history.filter((m) => m.type === type) as Array<Extract<AgentMessage, { type: T }>>;
	}

	/** Get the last N messages. */
	recent(count: number): AgentMessage[] {
		return this.history.slice(-count);
	}

	/** Total messages published since creation. */
	get messageCount(): number {
		return this.history.length;
	}

	// ── Serialization ─────────────────────────────────────────────────────────

	/** Serialize bus state for checkpointing. */
	toJSON(): { history: AgentMessage[]; inboxes: Record<string, AgentMessage[]> } {
		const inboxes: Record<string, AgentMessage[]> = {};
		for (const [id, msgs] of this.inboxes) {
			if (msgs.length > 0) inboxes[id] = [...msgs];
		}
		return { history: [...this.history], inboxes };
	}

	/** Restore bus state from a checkpoint. */
	static fromJSON(
		data: { history: AgentMessage[]; inboxes?: Record<string, AgentMessage[]> },
		options?: AgentBusOptions,
	): AgentBus {
		const bus = new AgentBus(options);
		bus.history.push(...data.history);
		if (data.inboxes) {
			for (const [id, msgs] of Object.entries(data.inboxes)) {
				bus.inboxes.set(id, [...msgs]);
			}
		}
		return bus;
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	/** Remove all subscribers and clear inboxes. History is preserved. */
	reset(): void {
		this.subscribers.clear();
		for (const inbox of this.inboxes.values()) inbox.length = 0;
	}

	/** Full teardown: clear everything. */
	destroy(): void {
		this.subscribers.clear();
		this.inboxes.clear();
		this.history.length = 0;
	}
}

// ── Helper: create a unique message ID ────────────────────────────────────────

let msgIdCounter = 0;

export function createMessageId(prefix = "msg"): string {
	return `${prefix}-${Date.now()}-${++msgIdCounter}`;
}

// ── Helper: build typed messages ──────────────────────────────────────────────

export function buildTaskRequest(
	from: string,
	to: string | null,
	description: string,
	opts?: Partial<Pick<AgentTaskRequest, "priority" | "constraints" | "parentTaskId" | "deadline">>,
): AgentTaskRequest {
	return {
		type: "task_request",
		id: createMessageId("task"),
		from,
		to,
		priority: opts?.priority ?? AgentMessagePriority.NORMAL,
		description,
		constraints: opts?.constraints,
		parentTaskId: opts?.parentTaskId,
		deadline: opts?.deadline,
		timestamp: Date.now(),
	};
}

export function buildTaskResult(
	from: string,
	taskRequestId: string,
	success: boolean,
	summary: string,
	opts?: Partial<Pick<AgentTaskResult, "artifacts" | "metrics">>,
): AgentTaskResult {
	return {
		type: "task_result",
		id: createMessageId("result"),
		from,
		taskRequestId,
		success,
		summary,
		artifacts: opts?.artifacts,
		metrics: opts?.metrics,
		timestamp: Date.now(),
	};
}

export function buildCapabilityQuery(from: string, capability: string): AgentCapabilityQuery {
	return {
		type: "capability_query",
		id: createMessageId("capq"),
		from,
		capability,
		timestamp: Date.now(),
	};
}
