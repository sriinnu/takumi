/**
 * Approval + Audit Trail types — P-Track 1.
 *
 * Product-grade trust model for tool approvals.  Every permission
 * decision is recorded as an immutable AuditRecord and exported as
 * JSONL / CSV for compliance.
 */

// ── Approval status ───────────────────────────────────────────────────────────

export type ApprovalStatus = "pending" | "approved" | "denied" | "escalated" | "expired";

export type ApprovalActor = "user" | "operator" | "policy" | "auto";

// ── Core record ───────────────────────────────────────────────────────────────

export interface ApprovalRecord {
	/** Unique record ID. */
	id: string;
	/** Tool that triggered the approval. */
	tool: string;
	/** Serialised summary of tool arguments (never raw secrets). */
	argsSummary: string;
	/** Current decision state. */
	status: ApprovalStatus;
	/** Who made the decision. */
	actor: ApprovalActor;
	/** Permission lane (session / project / global). */
	lane: "session" | "project" | "global";
	/** Human-readable reason for the decision. */
	reason?: string;
	/** Unix timestamp (ms) when the request was created. */
	createdAt: number;
	/** Unix timestamp (ms) when the decision was made. */
	decidedAt?: number;
	/** Session ID where the approval originated. */
	sessionId?: string;
}

// ── Queue ─────────────────────────────────────────────────────────────────────

export interface ApprovalQueueSnapshot {
	pending: ApprovalRecord[];
	recent: ApprovalRecord[];
	total: number;
	deniedCount: number;
	escalatedCount: number;
}

// ── Export ─────────────────────────────────────────────────────────────────────

export type AuditExportFormat = "jsonl" | "csv";

export interface AuditExportOptions {
	format: AuditExportFormat;
	/** Limit to records after this timestamp (ms). */
	since?: number;
	/** Limit to records before this timestamp (ms). */
	until?: number;
	/** Filter by status. */
	status?: ApprovalStatus;
	/** Maximum records to export. */
	limit?: number;
}

// ── Factory helpers ───────────────────────────────────────────────────────────

let approvalCounter = 0;

export function createApprovalId(now = Date.now()): string {
	approvalCounter += 1;
	return `apr-${now.toString(36)}-${approvalCounter.toString(36).padStart(4, "0")}`;
}

/** Reset counter — tests only. */
export function resetApprovalCounter(): void {
	approvalCounter = 0;
}

export function createApprovalRecord(input: {
	tool: string;
	argsSummary: string;
	lane?: "session" | "project" | "global";
	sessionId?: string;
}): ApprovalRecord {
	return {
		id: createApprovalId(),
		tool: input.tool,
		argsSummary: input.argsSummary.slice(0, 500),
		status: "pending",
		actor: "user",
		lane: input.lane ?? "session",
		createdAt: Date.now(),
		sessionId: input.sessionId,
	};
}
