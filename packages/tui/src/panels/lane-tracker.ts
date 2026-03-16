/**
 * LaneTrackerPanel — sidebar widget showing recent routing decisions as lanes.
 *
 * Each routing decision is treated as a "lane" — a named execution path
 * with a capability, authority, and outcome status.  The panel shows the
 * last N lanes so the operator can see what paths were chosen and whether
 * any fell back or were degraded.
 *
 * Renders only when there is routing history in state.
 */

import type { RoutingDecision } from "@takumi/bridge";
import type { Rect } from "@takumi/core";
import type { Screen } from "@takumi/render";
import { Component, effect } from "@takumi/render";
import type { AppState } from "../state.js";

export interface LaneTrackerPanelProps {
	state: AppState;
	/** Maximum number of lane rows to show (default: 4). */
	maxLanes?: number;
}

/** Characters per lane row. Layout: icon + space + capability (truncated). */
const FG_ENGINE = 46;
const FG_FALLBACK = 214;
const FG_DEGRADED = 196;
const FG_LABEL = 6;
const FG_DIM = 8;

const DEFAULT_MAX_LANES = 4;

/** Strip ANSI escape sequences from untrusted data. */
function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

interface LaneRow {
	icon: string;
	fg: number;
	capability: string;
	selected: string;
	degraded: boolean;
	fallbackCount: number;
	enforcement: string;
}

function decisionToLane(d: RoutingDecision): LaneRow {
	const authority = d.selected ? "engine" : "takumi-fallback";
	const degraded = d.degraded === true;
	const icon = degraded ? "⚠" : authority === "engine" ? "✦" : "↩";
	const fg = degraded ? FG_DEGRADED : authority === "engine" ? FG_ENGINE : FG_FALLBACK;
	return {
		icon,
		fg,
		capability: stripAnsi(d.request?.capability ?? "unknown"),
		selected: stripAnsi(d.selected?.id ?? "local"),
		degraded,
		fallbackCount: d.fallbackChain?.length ?? 0,
		enforcement: d.selected ? "same-provider" : "capability-only",
	};
}

export class LaneTrackerPanel extends Component {
	private readonly state: AppState;
	private readonly maxLanes: number;
	private _disposeEffect: (() => void) | null = null;

	constructor(props: LaneTrackerPanelProps) {
		super();
		this.state = props.state;
		this.maxLanes = props.maxLanes ?? DEFAULT_MAX_LANES;

		this._disposeEffect = effect(() => {
			const _decisions = this.state.routingDecisions.value;
			this.markDirty();
			return undefined;
		});
	}

	onUnmount(): void {
		this._disposeEffect?.();
		super.onUnmount();
	}

	/** Height this panel needs. 0 when no lanes exist. */
	get height(): number {
		const decisions = this.state.routingDecisions.value;
		if (decisions.length === 0) return 0;
		const rows = Math.min(decisions.length, this.maxLanes);
		// header + rows
		return 1 + rows;
	}

	render(screen: Screen, rect: Rect): void {
		const decisions = this.state.routingDecisions.value;
		if (decisions.length === 0) return;

		const { x, y, width } = rect;
		let cursorY = y;
		const maxY = y + rect.height;

		// Section header
		if (cursorY >= maxY) return;
		screen.writeText(cursorY, x, "LANES", { fg: FG_LABEL, bold: true });
		cursorY++;

		// Most-recent lanes first
		const recentDecisions = decisions.slice(-this.maxLanes).reverse();
		let laneIndex = 0;

		for (const decision of recentDecisions) {
			if (cursorY >= maxY) break;

			const lane = decisionToLane(decision);
			// Icon: newest lane gets a solid dot prefix to distinguish it
			const prefix = laneIndex === 0 ? "● " : "  ";
			const iconStr = `${prefix}${lane.icon} `;
			const usedWidth = iconStr.length;

			// Enforcement badge: [SP] for same-provider, [CO] for capability-only
			const badge = lane.enforcement === "same-provider" ? "[SP]" : "[CO]";
			const badgeWidth = badge.length + 1;

			// Fallback indicator: show count if > 0
			const fbStr = lane.fallbackCount > 0 ? ` ↻${lane.fallbackCount}` : "";

			const selMaxWidth = Math.min(12, Math.floor(width / 3));
			const selStr =
				lane.selected.length > selMaxWidth ? `${lane.selected.slice(0, selMaxWidth - 1)}\u2026` : lane.selected;

			const capWidth = Math.max(1, width - usedWidth - badgeWidth - selStr.length - fbStr.length - 1);
			const capTrunc =
				lane.capability.length > capWidth
					? `${lane.capability.slice(0, capWidth - 1)}\u2026`
					: lane.capability.padEnd(capWidth);

			let col = x;
			// Render icon portion
			screen.writeText(cursorY, col, iconStr, { fg: lane.fg, bold: laneIndex === 0 });
			col += iconStr.length;

			// Render enforcement badge
			screen.writeText(cursorY, col, badge, { fg: FG_DIM, dim: true });
			col += badge.length + 1;

			// Render capability
			screen.writeText(cursorY, col, capTrunc, {
				fg: laneIndex === 0 ? 7 : FG_DIM,
				dim: laneIndex !== 0,
			});
			col += capTrunc.length;

			// Render fallback count
			if (fbStr) {
				screen.writeText(cursorY, col, fbStr, { fg: FG_FALLBACK, dim: true });
				col += fbStr.length;
			}

			// Render selected capability ID (right-aligned)
			const selX = x + width - selStr.length;
			if (selX > col) {
				screen.writeText(cursorY, selX, selStr, { fg: FG_DIM, dim: true });
			}

			cursorY++;
			laneIndex++;
		}
	}
}
