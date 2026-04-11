import type { RoutingDecision } from "@takumi/bridge";
import { summarizeDegradedExecutionContext } from "./degraded-execution-context.js";
import type { AppState } from "./state.js";

const FG_ENGINE = 46;
const FG_FALLBACK = 214;
const FG_DEGRADED = 196;
const FG_WARNING = 214;
const FG_OK = 2;
const FG_DIM = 8;

type SyncStatus = "idle" | "pending" | "syncing" | "ready" | "failed";

export interface OperatorSurfaceLine {
	text: string;
	fg: number;
	bold: boolean;
	dim: boolean;
}

export interface OperatorRouteSummary {
	authority: "engine" | "takumi-fallback";
	enforcement: "same-provider" | "capability-only";
	degraded: boolean;
	sessionDegraded: boolean;
	icon: string;
	fg: number;
	capability: string;
	target: string;
}

export interface OperatorSyncSummary {
	status: SyncStatus;
	canonicalSessionId: string | null;
	pendingCount: number;
	detail: string | null;
	lastError: string | null;
	degradedHistory: boolean;
}

/**
 * Summarize the latest route authority so transcript and status surfaces speak
 * the same operator language as the route sidebar.
 */
export function getLatestRouteSummary(state: AppState): OperatorRouteSummary | null {
	const decision = state.routingDecisions.value.at(-1);
	if (!decision) return null;
	const degradedExecution = summarizeDegradedExecutionContext(state);

	const authority = decision.selected ? "engine" : "takumi-fallback";
	const degraded = decision.degraded === true;
	const icon = degraded ? "⚠" : authority === "engine" ? "✦" : "↩";
	const fg = degraded ? FG_DEGRADED : authority === "engine" ? FG_ENGINE : FG_FALLBACK;

	return {
		authority,
		enforcement: decision.selected ? "same-provider" : "capability-only",
		degraded,
		sessionDegraded: degradedExecution?.active ?? degraded,
		icon,
		fg,
		capability: stripAnsi(decision.request?.capability ?? "unknown"),
		target: formatRouteTarget(decision),
	};
}

/**
 * Derive a stable replay summary from live state so `/context`, transcript
 * lines, and status widgets all agree on what is mirrored, pending, or stalled.
 */
export function summarizeChitraguptaSync(state: AppState): OperatorSyncSummary {
	const sessionTurns = state.messages.value.filter((message) => message.sessionTurn === true);
	const lastSyncedId = state.chitraguptaSync.value.lastSyncedMessageId;
	const lastSyncedIndex = lastSyncedId ? sessionTurns.findIndex((message) => message.id === lastSyncedId) : -1;
	const pendingCount = lastSyncedIndex >= 0 ? sessionTurns.slice(lastSyncedIndex + 1).length : sessionTurns.length;
	const canonicalSessionId = state.canonicalSessionId.value || null;
	const rawStatus = (state.chitraguptaSync.value.status ?? "idle") as SyncStatus;
	const status = rawStatus === "idle" && canonicalSessionId && pendingCount === 0 ? "ready" : rawStatus;
	const degradedHistory = summarizeDegradedExecutionContext(state)?.sync?.failed === true;

	if (status === "failed") {
		return {
			status,
			canonicalSessionId,
			pendingCount,
			detail: state.chitraguptaSync.value.lastFailedMessageId
				? `stalled on ${state.chitraguptaSync.value.lastFailedMessageId}`
				: null,
			lastError: state.chitraguptaSync.value.lastError ?? null,
			degradedHistory,
		};
	}

	if (status === "syncing") {
		return {
			status,
			canonicalSessionId,
			pendingCount,
			detail: state.chitraguptaSync.value.lastAttemptedMessageId
				? `replaying ${state.chitraguptaSync.value.lastAttemptedMessageId}`
				: null,
			lastError: state.chitraguptaSync.value.lastError ?? null,
			degradedHistory,
		};
	}

	if (status === "ready") {
		return {
			status,
			canonicalSessionId,
			pendingCount,
			detail: state.chitraguptaSync.value.lastSyncedMessageId
				? `mirrored ${state.chitraguptaSync.value.lastSyncedMessageId}`
				: null,
			lastError: state.chitraguptaSync.value.lastError ?? null,
			degradedHistory,
		};
	}

	return {
		status,
		canonicalSessionId,
		pendingCount,
		detail: !canonicalSessionId && pendingCount > 0 ? "waiting for canonical binding" : null,
		lastError: state.chitraguptaSync.value.lastError ?? null,
		degradedHistory,
	};
}

/** Format the verbose sync line used by `/context`. */
export function formatChitraguptaSyncLine(state: AppState): string {
	const summary = summarizeChitraguptaSync(state);
	if (summary.status === "failed") {
		const error = summary.lastError ? `: ${summary.lastError}` : "";
		return `failed${formatPendingSuffix(summary.pendingCount, summary.detail ?? undefined)}${error}`;
	}
	if (summary.status === "ready" && state.chitraguptaSync.value.lastSyncedAt) {
		const degradedHistory = summary.degradedHistory ? " (degraded history)" : "";
		return `ready${formatPendingSuffix(summary.pendingCount)}${degradedHistory}`;
	}
	if (summary.status === "syncing") {
		return `syncing${formatPendingSuffix(summary.pendingCount, summary.detail ?? undefined)}`;
	}
	if (summary.canonicalSessionId && summary.pendingCount === 0) {
		return summary.degradedHistory ? "ready (degraded history)" : "ready";
	}
	const degradedHistory = summary.degradedHistory ? " (degraded history)" : "";
	return `${summary.status}${formatPendingSuffix(summary.pendingCount, summary.detail ?? undefined)}${degradedHistory}`;
}

/** Build the transcript line that makes route authority visible in-chat. */
export function formatInlineRouteSurface(state: AppState): OperatorSurfaceLine | null {
	const summary = getLatestRouteSummary(state);
	if (!summary) return null;

	const degraded = summary.degraded ? " • degraded" : "";
	const sessionDegraded = summary.sessionDegraded && !summary.degraded ? " • degraded-run" : "";
	return {
		text: `↳ route: ${state.provider.value} / ${state.model.value} • ${summary.icon} ${summary.authority} • ${summary.capability} → ${summary.target}${degraded}${sessionDegraded}`,
		fg: summary.fg,
		bold: summary.degraded,
		dim: !summary.degraded,
	};
}

/** Build the transcript line that exposes canonical binding + replay state inline. */
export function formatInlineSyncSurface(state: AppState): OperatorSurfaceLine | null {
	const summary = summarizeChitraguptaSync(state);
	const shouldRender = Boolean(
		summary.canonicalSessionId || summary.pendingCount > 0 || summary.status !== "idle" || summary.lastError,
	);
	if (!shouldRender) return null;

	const parts = [`↳ session: ${summary.canonicalSessionId ?? "unbound"}`, summary.status];
	if (summary.pendingCount > 0) {
		parts.push(`${summary.pendingCount} pending`);
	}
	if (summary.detail) {
		parts.push(summary.detail);
	}
	if (summary.degradedHistory && summary.status !== "failed") {
		parts.push("degraded history");
	}
	if (summary.status === "failed" && summary.lastError) {
		parts.push(summary.lastError);
	}

	const fg =
		summary.status === "failed"
			? FG_DEGRADED
			: summary.status === "syncing" || summary.pendingCount > 0
				? FG_WARNING
				: summary.canonicalSessionId
					? FG_OK
					: FG_DIM;

	return {
		text: parts.join(" • "),
		fg,
		bold: summary.status === "failed" || summary.status === "syncing",
		dim: fg === FG_DIM,
	};
}

/**
 * Compact authority widget for the status bar.
 * The transcript lines carry the detail; this stays intentionally terse.
 */
export function formatCompactAuthorityWidget(state: AppState): OperatorSurfaceLine {
	const route = getLatestRouteSummary(state);
	const sync = summarizeChitraguptaSync(state);
	const degradedExecution = summarizeDegradedExecutionContext(state);
	const isDegraded = degradedExecution?.active ?? route?.degraded ?? sync.status === "failed";
	const icon = isDegraded ? "⚠" : (route?.icon ?? "◌");
	const label =
		route?.authority === "engine" ? "engine" : route?.authority === "takumi-fallback" ? "fallback" : "local";
	const syncLabel = formatCompactSyncLabel(sync);
	const fg = isDegraded
		? FG_DEGRADED
		: route?.authority === "takumi-fallback"
			? FG_FALLBACK
			: sync.status === "syncing" || sync.pendingCount > 0
				? FG_WARNING
				: route?.authority === "engine" || sync.canonicalSessionId
					? FG_ENGINE
					: FG_DIM;

	return {
		text: ` ${icon} ${label} ${syncLabel} `,
		fg,
		bold: fg !== FG_DIM,
		dim: fg === FG_DIM,
	};
}

function formatRouteTarget(decision: RoutingDecision): string {
	const label = stripAnsi(decision.selected?.label ?? "");
	if (label) return label;

	const metadata = decision.selected?.metadata as Record<string, unknown> | undefined;
	const model =
		typeof metadata?.model === "string"
			? metadata.model
			: typeof metadata?.modelId === "string"
				? metadata.modelId
				: undefined;
	const provider = decision.selected?.providerFamily;
	if (provider && provider !== "openai-compat" && model) {
		return `${provider} / ${model}`;
	}
	if (model) return model;
	return stripAnsi(decision.selected?.id ?? "local fallback");
}

function formatCompactSyncLabel(summary: OperatorSyncSummary): string {
	if (summary.status === "failed") return "stall";
	if (summary.status === "syncing") {
		return summary.pendingCount > 0 ? `↺${summary.pendingCount}` : "↺";
	}
	if (summary.pendingCount > 0) {
		return `+${summary.pendingCount}`;
	}
	if (summary.canonicalSessionId || summary.status === "ready") {
		return "ok";
	}
	return "idle";
}

function formatPendingSuffix(pendingCount: number, detail?: string): string {
	if (pendingCount > 0 && detail) {
		return ` (${pendingCount} pending, ${detail})`;
	}
	if (pendingCount > 0) {
		return ` (${pendingCount} pending)`;
	}
	if (detail) {
		return ` (${detail})`;
	}
	return "";
}

function stripAnsi(value: string): string {
	return value.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}
