/**
 * OperatorBoardPanel — read-only operator cockpit for the TUI sidebar.
 *
 * I compose the existing route authority, Chitragupta replay state,
 * artifact-promotion status, approvals, and side-lane activity into a single
 * compact board so operators can answer "what needs attention now?" without
 * hopping across three tiny widgets and a prayer.
 */

import type { RoutingDecision } from "@takumi/bridge";
import type { Rect } from "@takumi/core";
import type { Screen } from "@takumi/render";
import { Component, effect } from "@takumi/render";
import { readArtifactPromotionSummary } from "../chitragupta/chitragupta-artifact-promotion.js";
import {
	getLatestRouteSummary,
	type OperatorRouteSummary,
	type OperatorSyncSummary,
	summarizeChitraguptaSync,
} from "../operator-authority.js";
import type { SideLaneSnapshot } from "../side-lane-store.js";
import type { AppState } from "../state.js";

export interface OperatorBoardPanelProps {
	state: AppState;
	maxRecentRoutes?: number;
	maxSideLanes?: number;
}

const HEADER_COLOR = 6;
const LABEL_COLOR = 7;
const META_COLOR = 8;
const SUCCESS_COLOR = 46;
const WARNING_COLOR = 214;
const ERROR_COLOR = 196;
const DEFAULT_ROUTE_ROWS = 2;
const DEFAULT_SIDE_LANES = 2;

interface OperatorBoardLine {
	text: string;
	fg: number;
	bold?: boolean;
	dim?: boolean;
}

/**
 * I render the highest-signal operator state into one ordered list of rows.
 * Keeping this pure makes the panel easy to test and harder to lie with.
 */
export function buildOperatorBoardLines(
	state: AppState,
	options: { maxRecentRoutes?: number; maxSideLanes?: number } = {},
): OperatorBoardLine[] {
	const route = getLatestRouteSummary(state);
	const sync = summarizeChitraguptaSync(state);
	const artifacts = readArtifactPromotionSummary(state);
	const approval = state.pendingPermission.value;
	const recentRoutes = state.routingDecisions.value.slice(-(options.maxRecentRoutes ?? DEFAULT_ROUTE_ROWS)).reverse();
	const sideLanes = state.sideLanes.list(options.maxSideLanes ?? DEFAULT_SIDE_LANES);
	const hasRenderableState = Boolean(
		route ||
			sync.canonicalSessionId ||
			sync.pendingCount > 0 ||
			sync.status !== "idle" ||
			sync.lastError ||
			artifacts.pendingArtifactIds.length > 0 ||
			artifacts.importedArtifactIds.length > 0 ||
			artifacts.status !== "idle" ||
			artifacts.lastError ||
			approval ||
			sideLanes.length > 0,
	);
	if (!hasRenderableState) return [];

	const lines: OperatorBoardLine[] = [buildAttentionLine(route, sync, artifacts, approval !== null, sideLanes)];
	if (route) {
		lines.push(buildRouteLine(route));
	}
	if (shouldRenderSyncLine(sync)) {
		lines.push(buildSyncLine(sync));
	}
	if (shouldRenderReviewLine(artifacts)) {
		lines.push(buildReviewLine(artifacts));
	}
	if (approval) {
		lines.push({
			text: `approval ${approval.tool}${formatApprovalHint(approval.args)}`,
			fg: WARNING_COLOR,
			bold: true,
		});
	}

	for (const [index, decision] of recentRoutes.entries()) {
		lines.push(buildRecentRouteLine(decision, index === 0));
	}
	for (const lane of sideLanes) {
		lines.push(buildSideLaneLine(lane));
	}
	const drilldown = buildDrilldownLine(route, sync, artifacts, approval !== null, sideLanes.length > 0);
	if (drilldown) {
		lines.push(drilldown);
	}
	return lines;
}

export class OperatorBoardPanel extends Component {
	private readonly state: AppState;
	private readonly maxRecentRoutes: number;
	private readonly maxSideLanes: number;
	private _disposeEffect: (() => void) | null = null;

	constructor(props: OperatorBoardPanelProps) {
		super();
		this.state = props.state;
		this.maxRecentRoutes = props.maxRecentRoutes ?? DEFAULT_ROUTE_ROWS;
		this.maxSideLanes = props.maxSideLanes ?? DEFAULT_SIDE_LANES;

		this._disposeEffect = effect(() => {
			void this.state.routingDecisions.value;
			void this.state.chitraguptaSync.value;
			void this.state.canonicalSessionId.value;
			void this.state.artifactPromotion.value;
			void this.state.pendingPermission.value;
			void this.state.sideLanes.entries.value;
			this.markDirty();
			return undefined;
		});
	}

	onUnmount(): void {
		this._disposeEffect?.();
		super.onUnmount();
	}

	/** I need one header row plus however many operator rows currently matter. */
	get height(): number {
		const lines = buildOperatorBoardLines(this.state, {
			maxRecentRoutes: this.maxRecentRoutes,
			maxSideLanes: this.maxSideLanes,
		});
		return lines.length > 0 ? 1 + lines.length : 0;
	}

	render(screen: Screen, rect: Rect): void {
		const lines = buildOperatorBoardLines(this.state, {
			maxRecentRoutes: this.maxRecentRoutes,
			maxSideLanes: this.maxSideLanes,
		});
		if (lines.length === 0) return;

		const { x, y, width } = rect;
		let cursorY = y;
		const maxY = y + rect.height;
		if (cursorY >= maxY) return;
		screen.writeText(cursorY++, x, "OPERATOR BOARD", { fg: HEADER_COLOR, bold: true });

		for (const line of lines) {
			if (cursorY >= maxY) break;
			screen.writeText(cursorY++, x, truncate(stripAnsi(line.text), width), {
				fg: line.fg,
				bold: line.bold,
				dim: line.dim,
			});
		}
	}
}

function buildAttentionLine(
	route: OperatorRouteSummary | null,
	sync: OperatorSyncSummary,
	artifacts: ReturnType<typeof readArtifactPromotionSummary>,
	hasApproval: boolean,
	sideLanes: SideLaneSnapshot[],
): OperatorBoardLine {
	const alerts: string[] = [];
	if (route?.degraded || route?.sessionDegraded) alerts.push("route degraded");
	if (sync.status === "failed") alerts.push("sync stalled");
	else if (sync.degradedHistory) alerts.push("sync degraded");
	if (artifacts.status === "failed") alerts.push("review failed");
	else if (artifacts.pendingArtifactIds.length > 0) {
		alerts.push(`${artifacts.pendingArtifactIds.length} artifact review`);
	}
	if (hasApproval) alerts.push("approval pending");
	const liveLanes = sideLanes.filter((lane) => lane.state === "running" || lane.state === "starting").length;
	if (liveLanes > 0) alerts.push(`${liveLanes} live lane${liveLanes === 1 ? "" : "s"}`);
	if (alerts.length === 0) {
		return { text: "✓ stable • route visible • no pending operator work", fg: SUCCESS_COLOR, bold: true };
	}
	const fg = alerts.some((alert) => alert.includes("degraded") || alert.includes("failed"))
		? ERROR_COLOR
		: WARNING_COLOR;
	return { text: `! ${alerts.slice(0, 4).join(" • ")}`, fg, bold: true };
}

function buildRouteLine(route: OperatorRouteSummary): OperatorBoardLine {
	const suffix = route.sessionDegraded && !route.degraded ? " • degraded-run" : "";
	return {
		text: `route ${route.icon} ${route.authority} [${route.enforcement === "same-provider" ? "SP" : "CO"}] ${route.capability} → ${route.target}${suffix}`,
		fg: route.degraded ? ERROR_COLOR : route.fg,
		bold: route.degraded,
		dim: !route.degraded,
	};
}

function shouldRenderSyncLine(sync: OperatorSyncSummary): boolean {
	return Boolean(sync.canonicalSessionId || sync.pendingCount > 0 || sync.status !== "idle" || sync.lastError);
}

function buildSyncLine(sync: OperatorSyncSummary): OperatorBoardLine {
	const parts = ["sync", sync.canonicalSessionId ?? "unbound", sync.status];
	if (sync.pendingCount > 0) parts.push(`${sync.pendingCount} pending`);
	if (sync.detail) parts.push(sync.detail);
	if (sync.degradedHistory && sync.status !== "failed") parts.push("degraded history");
	if (sync.status === "failed" && sync.lastError) parts.push(sync.lastError);
	const fg =
		sync.status === "failed" || sync.degradedHistory
			? ERROR_COLOR
			: sync.status === "syncing" || sync.pendingCount > 0
				? WARNING_COLOR
				: sync.canonicalSessionId
					? SUCCESS_COLOR
					: META_COLOR;
	return {
		text: parts.join(" • "),
		fg,
		bold: sync.status === "failed" || sync.status === "syncing" || sync.degradedHistory,
		dim: fg === META_COLOR,
	};
}

function shouldRenderReviewLine(artifacts: ReturnType<typeof readArtifactPromotionSummary>): boolean {
	return Boolean(
		artifacts.pendingArtifactIds.length > 0 ||
			artifacts.importedArtifactIds.length > 0 ||
			artifacts.status !== "idle" ||
			artifacts.lastError,
	);
}

function buildReviewLine(artifacts: ReturnType<typeof readArtifactPromotionSummary>): OperatorBoardLine {
	const parts = [
		"review",
		artifacts.status,
		`${artifacts.pendingArtifactIds.length} pending`,
		`${artifacts.importedArtifactIds.length} imported`,
	];
	if (artifacts.lastError && artifacts.status === "failed") {
		parts.push(artifacts.lastError);
	}
	const fg =
		artifacts.status === "failed"
			? ERROR_COLOR
			: artifacts.pendingArtifactIds.length > 0 || artifacts.status === "syncing"
				? WARNING_COLOR
				: SUCCESS_COLOR;
	return {
		text: parts.join(" • "),
		fg,
		bold: artifacts.status === "failed" || artifacts.pendingArtifactIds.length > 0,
		dim: fg === SUCCESS_COLOR,
	};
}

function buildRecentRouteLine(decision: RoutingDecision, isLatest: boolean): OperatorBoardLine {
	const icon = decision.degraded === true ? "⚠" : decision.selected ? "✦" : "↩";
	const enforcement = decision.selected ? "SP" : "CO";
	const capability = stripAnsi(decision.request?.capability ?? "unknown");
	const text = `${isLatest ? "lane" : "hist"} ${icon} [${enforcement}] ${capability}`;
	const fg = decision.degraded === true ? ERROR_COLOR : decision.selected ? LABEL_COLOR : WARNING_COLOR;
	return { text, fg, bold: isLatest, dim: !isLatest };
}

function buildSideLaneLine(lane: SideLaneSnapshot): OperatorBoardLine {
	const view = normalizeSideLaneState(lane.state, Boolean(lane.error));
	const target = lane.tmuxWindow || lane.branch || lane.id;
	const detail = lane.error || lane.responseSummary || lane.model || target;
	return {
		text: `side ${view.icon} ${lane.commandName} ${view.label} • ${stripAnsi(detail).replace(/\s+/g, " ").trim()}`,
		fg: view.fg,
		bold: lane.error !== null,
		dim: lane.error === null && view.fg === META_COLOR,
	};
}

function buildDrilldownLine(
	route: OperatorRouteSummary | null,
	sync: OperatorSyncSummary,
	artifacts: ReturnType<typeof readArtifactPromotionSummary>,
	hasApproval: boolean,
	hasSideLanes: boolean,
): OperatorBoardLine | null {
	const commands: string[] = [];
	if (route) commands.push("/route");
	if (
		artifacts.pendingArtifactIds.length > 0 ||
		artifacts.importedArtifactIds.length > 0 ||
		artifacts.status !== "idle" ||
		artifacts.lastError
	) {
		commands.push("/artifacts");
	}
	if (hasApproval) commands.push("/approvals");
	if (hasSideLanes) commands.push("/lanes");
	if (sync.status === "failed" || sync.pendingCount > 0) commands.push("/rebind");
	if (commands.length === 0) return null;
	return {
		text: `open ${Array.from(new Set(commands)).join(" • ")}`,
		fg: META_COLOR,
		dim: true,
	};
}

function normalizeSideLaneState(state: string, hasError: boolean): { icon: string; fg: number; label: string } {
	if (hasError) return { icon: "⚠", fg: ERROR_COLOR, label: "ERROR" };
	const normalized = state.trim().toLowerCase();
	if (normalized === "running") return { icon: "●", fg: SUCCESS_COLOR, label: "RUN" };
	if (normalized === "starting" || normalized === "queued" || normalized === "booting") {
		return { icon: "○", fg: WARNING_COLOR, label: "BOOT" };
	}
	if (normalized === "done" || normalized === "complete" || normalized === "completed") {
		return { icon: "✓", fg: LABEL_COLOR, label: "DONE" };
	}
	if (normalized === "stopped" || normalized === "cancelled" || normalized === "canceled") {
		return { icon: "■", fg: META_COLOR, label: "STOP" };
	}
	return { icon: "·", fg: META_COLOR, label: normalized ? normalized.slice(0, 4).toUpperCase() : "IDLE" };
}

function formatApprovalHint(args: Record<string, unknown>): string {
	const preferredKeys = ["filePath", "command", "path", "url", "tool"];
	for (const key of preferredKeys) {
		const value = args[key];
		if (typeof value === "string" && value.trim()) {
			return ` • ${value.trim()}`;
		}
	}
	const firstEntry = Object.entries(args).find(([, value]) => value !== undefined && value !== null);
	if (!firstEntry) return " • operator action required";
	const [key, value] = firstEntry;
	if (typeof value === "string") {
		return ` • ${key}=${value.trim()}`;
	}
	try {
		return ` • ${key}=${JSON.stringify(value)}`;
	} catch {
		return ` • ${key}`;
	}
}

function truncate(text: string, width: number): string {
	if (text.length <= width) return text;
	if (width <= 1) return text.slice(0, width);
	return `${text.slice(0, width - 1)}…`;
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}
