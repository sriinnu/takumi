/**
 * Approval queue and audit log persistence.
 *
 * Records are append-only JSONL files stored at
 * `~/.config/takumi/audit/`.  The queue is an in-memory view over
 * the most recent records, with disk-backed durability.
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ApprovalActor, ApprovalQueueSnapshot, ApprovalRecord, AuditExportOptions } from "./approval-types.js";
import { createApprovalRecord } from "./approval-types.js";

// ── Paths ─────────────────────────────────────────────────────────────────────

function defaultAuditDir(): string {
	return join(homedir(), ".config", "takumi", "audit");
}

async function ensureAuditDir(dir?: string): Promise<string> {
	const d = dir ?? defaultAuditDir();
	await mkdir(d, { recursive: true });
	return d;
}

function auditLogPath(dir: string): string {
	return join(dir, "audit.jsonl");
}

// ── Queue ─────────────────────────────────────────────────────────────────────

export class ApprovalQueue {
	private records: ApprovalRecord[] = [];
	private readonly auditDir: string | undefined;
	private readonly maxRecent: number;

	constructor(options?: { auditDir?: string; maxRecent?: number }) {
		this.auditDir = options?.auditDir;
		this.maxRecent = options?.maxRecent ?? 200;
	}

	/** Create a new pending approval and persist it. */
	async request(tool: string, argsSummary: string, sessionId?: string): Promise<ApprovalRecord> {
		const record = createApprovalRecord({ tool, argsSummary, sessionId });
		this.records.push(record);
		this.trimRecent();
		await this.appendToDisk(record);
		return record;
	}

	/** Decide a pending record. */
	async decide(
		id: string,
		status: "approved" | "denied" | "escalated",
		actor: ApprovalActor,
		reason?: string,
	): Promise<ApprovalRecord | null> {
		const record = this.records.find((r) => r.id === id && r.status === "pending");
		if (!record) return null;
		record.status = status;
		record.actor = actor;
		record.decidedAt = Date.now();
		record.reason = reason;
		await this.appendToDisk(record);
		return record;
	}

	/** Get current snapshot. */
	snapshot(): ApprovalQueueSnapshot {
		const pending = this.records.filter((r) => r.status === "pending");
		const recent = this.records.slice(-50);
		return {
			pending,
			recent,
			total: this.records.length,
			deniedCount: this.records.filter((r) => r.status === "denied").length,
			escalatedCount: this.records.filter((r) => r.status === "escalated").length,
		};
	}

	/** Find a record by ID. */
	find(id: string): ApprovalRecord | undefined {
		return this.records.find((r) => r.id === id);
	}

	/** Pending records. */
	pending(): ApprovalRecord[] {
		return this.records.filter((r) => r.status === "pending");
	}

	/** Export audit log in JSONL or CSV format. */
	async exportLog(options: AuditExportOptions): Promise<string> {
		const filtered = this.filterRecords(options);
		if (options.format === "csv") return this.toCsv(filtered);
		return filtered.map((r) => JSON.stringify(r)).join("\n");
	}

	/** Load records from disk (for session restore). */
	async loadFromDisk(): Promise<void> {
		try {
			const dir = await ensureAuditDir(this.auditDir);
			const raw = await readFile(auditLogPath(dir), "utf-8");
			const lines = raw.split("\n").filter(Boolean);
			const seen = new Map<string, ApprovalRecord>();
			for (const line of lines) {
				const record = JSON.parse(line) as ApprovalRecord;
				if (record.id) seen.set(record.id, record);
			}
			this.records = [...seen.values()];
			this.trimRecent();
		} catch {
			// No existing log — start fresh.
		}
	}

	// ── Private ─────────────────────────────────────────────────────────────

	private async appendToDisk(record: ApprovalRecord): Promise<void> {
		try {
			const dir = await ensureAuditDir(this.auditDir);
			await appendFile(auditLogPath(dir), `${JSON.stringify(record)}\n`, "utf-8");
		} catch {
			// Non-fatal — in-memory queue still works.
		}
	}

	private trimRecent(): void {
		if (this.records.length > this.maxRecent) {
			this.records = this.records.slice(-this.maxRecent);
		}
	}

	private filterRecords(options: AuditExportOptions): ApprovalRecord[] {
		let list = this.records;
		if (options.since) list = list.filter((r) => r.createdAt >= options.since!);
		if (options.until) list = list.filter((r) => r.createdAt <= options.until!);
		if (options.status) list = list.filter((r) => r.status === options.status);
		if (options.limit) list = list.slice(-options.limit);
		return list;
	}

	private toCsv(records: ApprovalRecord[]): string {
		const header = "id,tool,status,actor,lane,reason,createdAt,decidedAt,sessionId";
		const rows = records.map(
			(r) =>
				`${r.id},${esc(r.tool)},${r.status},${r.actor},${r.lane},${esc(r.reason ?? "")},${r.createdAt},${r.decidedAt ?? ""},${r.sessionId ?? ""}`,
		);
		return [header, ...rows].join("\n");
	}
}

/** Escape a CSV field value. */
function esc(value: string): string {
	if (value.includes(",") || value.includes('"') || value.includes("\n")) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

// ── Standalone audit file writer ──────────────────────────────────────────────

/** Write a full export to a file. */
export async function writeAuditExport(records: string, filename: string, auditDir?: string): Promise<string> {
	const dir = await ensureAuditDir(auditDir);
	const filePath = join(dir, filename);
	await writeFile(filePath, records, "utf-8");
	return filePath;
}
