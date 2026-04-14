import { randomUUID } from "node:crypto";

/** I represent the lifecycle states of a dispatched agent task. */
export enum DispatchStatus {
	PENDING = "pending",
	NOTIFIED = "notified",
	DELIVERED = "delivered",
	FAILED = "failed",
}

/** I describe a single dispatch record tracking a message between agents. */
export interface DispatchRecord {
	id: string;
	from: string;
	to: string;
	payload: unknown;
	status: DispatchStatus;
	channel?: string;
	createdAt: number;
	updatedAt: number;
	deliveredAt?: number;
	failedAt?: number;
	failReason?: string;
}

export type DispatchErrorCode = "invalid_transition" | "not_found" | "already_terminal";

/** I signal dispatch state-machine violations. */
export class DispatchError extends Error {
	readonly code: DispatchErrorCode;
	constructor(code: DispatchErrorCode, message: string) {
		super(message);
		this.name = "DispatchError";
		this.code = code;
	}
}

const TERMINAL = new Set<DispatchStatus>([DispatchStatus.DELIVERED, DispatchStatus.FAILED]);

/**
 * I am a formal dispatch log that tracks the lifecycle of messages sent between
 * agents in a cluster. Each record follows a strict state machine:
 * `Pending → Notified → Delivered → Failed`. Invalid transitions are rejected.
 */
export class DispatchLog {
	private readonly records = new Map<string, DispatchRecord>();

	/** I queue a new dispatch record and return it in `pending` state. */
	queue(from: string, to: string, payload: unknown): DispatchRecord {
		const now = Date.now();
		const record: DispatchRecord = {
			id: randomUUID(),
			from,
			to,
			payload,
			status: DispatchStatus.PENDING,
			createdAt: now,
			updatedAt: now,
		};
		this.records.set(record.id, record);
		return record;
	}

	/** I mark a pending record as notified via a specific channel. Throws on invalid transition. */
	markNotified(id: string, channel: string): DispatchRecord {
		const record = this.resolve(id);
		if (record.status !== DispatchStatus.PENDING) {
			throw new DispatchError("invalid_transition", `Cannot transition from '${record.status}' to 'notified'`);
		}
		record.status = DispatchStatus.NOTIFIED;
		record.channel = channel;
		record.updatedAt = Date.now();
		return record;
	}

	/** I mark a notified record as delivered. Throws on invalid transition. */
	markDelivered(id: string): DispatchRecord {
		const record = this.resolve(id);
		if (record.status !== DispatchStatus.NOTIFIED) {
			throw new DispatchError("invalid_transition", `Cannot transition from '${record.status}' to 'delivered'`);
		}
		const now = Date.now();
		record.status = DispatchStatus.DELIVERED;
		record.deliveredAt = now;
		record.updatedAt = now;
		return record;
	}

	/** I mark a record as failed. Can transition from pending or notified. Throws if already terminal. */
	markFailed(id: string, reason: string): DispatchRecord {
		const record = this.resolve(id);
		if (TERMINAL.has(record.status)) {
			throw new DispatchError("already_terminal", `Record '${id}' is already in terminal state '${record.status}'`);
		}
		const now = Date.now();
		record.status = DispatchStatus.FAILED;
		record.failReason = reason;
		record.failedAt = now;
		record.updatedAt = now;
		return record;
	}

	/** I retrieve a record by ID. Returns null if not found. */
	get(id: string): DispatchRecord | null {
		return this.records.get(id) ?? null;
	}

	/** I return all records matching an optional filter on from, to, or status. */
	query(filter?: { from?: string; to?: string; status?: DispatchStatus }): DispatchRecord[] {
		if (!filter) return [...this.records.values()];
		const out: DispatchRecord[] = [];
		for (const r of this.records.values()) {
			if (filter.from && r.from !== filter.from) continue;
			if (filter.to && r.to !== filter.to) continue;
			if (filter.status && r.status !== filter.status) continue;
			out.push(r);
		}
		return out;
	}

	/** I return counts by status. */
	stats(): Record<DispatchStatus, number> {
		const counts = {
			[DispatchStatus.PENDING]: 0,
			[DispatchStatus.NOTIFIED]: 0,
			[DispatchStatus.DELIVERED]: 0,
			[DispatchStatus.FAILED]: 0,
		};
		for (const r of this.records.values()) counts[r.status]++;
		return counts;
	}

	/** I clear all terminal records (delivered + failed) older than maxAgeMs. Returns count cleared. */
	prune(maxAgeMs: number): number {
		const cutoff = Date.now() - maxAgeMs;
		let cleared = 0;
		for (const [id, r] of this.records) {
			if (TERMINAL.has(r.status) && r.updatedAt < cutoff) {
				this.records.delete(id);
				cleared++;
			}
		}
		return cleared;
	}

	/** I return the total number of tracked records. */
	get size(): number {
		return this.records.size;
	}

	/** I resolve a record by ID, throwing if it doesn't exist. */
	private resolve(id: string): DispatchRecord {
		const record = this.records.get(id);
		if (!record) throw new DispatchError("not_found", `Dispatch record '${id}' not found`);
		return record;
	}
}
