/**
 * Phase 49 — Observation Collector.
 *
 * Accumulates observation events during tool execution and provides a
 * flush-based interface for batch dispatch to Chitragupta.
 *
 * The collector is intentionally decoupled from the bridge —
 * the TUI or CLI layer creates it, passes it into the agent loop, then
 * periodically flushes to ChitraguptaObserver.observeBatch().
 */

import { createHash } from "node:crypto";
import type {
	EditPatternEvent,
	ErrorResolutionEvent,
	ObservationEvent,
	ToolUsageEvent,
	UserCorrectionEvent,
} from "@takumi/bridge";
import { createLogger } from "@takumi/core";

const log = createLogger("observation-collector");

export interface ObservationCollectorConfig {
	/** Session ID to tag all events with. */
	sessionId: string;
	/** Max buffered events before auto-yielding a warning. Default: 500. */
	maxBuffer?: number;
}

export class ObservationCollector {
	private readonly buffer: ObservationEvent[] = [];
	private readonly sessionId: string;
	private readonly maxBuffer: number;

	/** Track last error per tool for error→resolution pairing. */
	private readonly lastErrors = new Map<string, { msg: string; ts: number }>();

	constructor(config: ObservationCollectorConfig) {
		this.sessionId = config.sessionId;
		this.maxBuffer = config.maxBuffer ?? 500;
	}

	/** Record a tool execution. Called from the agent loop after each tool result. */
	recordToolUsage(tool: string, args: Record<string, unknown>, durationMs: number, success: boolean): void {
		const event: ToolUsageEvent = {
			type: "tool_usage",
			tool,
			argsHash: hashArgs(args),
			durationMs,
			success,
			sessionId: this.sessionId,
			timestamp: Date.now(),
		};
		this.push(event);

		// Track errors for resolution pairing
		if (!success) {
			this.lastErrors.set(tool, { msg: String(args._errorHint ?? "error"), ts: Date.now() });
		} else if (this.lastErrors.has(tool)) {
			const prev = this.lastErrors.get(tool)!;
			// Only pair if the error was within the last 60s
			if (Date.now() - prev.ts < 60_000) {
				const resolution: ErrorResolutionEvent = {
					type: "error_resolution",
					tool,
					errorMsg: prev.msg,
					resolution: `retry succeeded with args hash ${hashArgs(args)}`,
					sessionId: this.sessionId,
					timestamp: Date.now(),
				};
				this.push(resolution);
			}
			this.lastErrors.delete(tool);
		}
	}

	/** Record a file edit pattern. */
	recordEdit(files: string[], editType: EditPatternEvent["editType"], coEdited: string[] = []): void {
		const event: EditPatternEvent = {
			type: "edit_pattern",
			files,
			editType,
			coEdited,
			sessionId: this.sessionId,
			timestamp: Date.now(),
		};
		this.push(event);
	}

	/** Record a user correction (undo/override). */
	recordCorrection(originalHash: string, correctedHash: string, context: string): void {
		const event: UserCorrectionEvent = {
			type: "user_correction",
			originalHash,
			correctedHash,
			context,
			sessionId: this.sessionId,
			timestamp: Date.now(),
		};
		this.push(event);
	}

	/** Drain and return all buffered events. Clears the internal buffer. */
	flush(): ObservationEvent[] {
		if (this.buffer.length === 0) return [];
		const events = this.buffer.splice(0);
		log.debug(`Flushed ${events.length} observation events`);
		return events;
	}

	/** Number of buffered events. */
	get pending(): number {
		return this.buffer.length;
	}

	private push(event: ObservationEvent): void {
		this.buffer.push(event);
		if (this.buffer.length > this.maxBuffer) {
			log.warn(`Observation buffer exceeds ${this.maxBuffer} — consider flushing`);
		}
	}
}

/** Deterministic hash of tool args (for dedup/pattern detection). */
function hashArgs(args: Record<string, unknown>): string {
	const sorted = JSON.stringify(args, Object.keys(args).sort());
	return createHash("sha256").update(sorted).digest("hex").slice(0, 12);
}
