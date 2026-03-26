/**
 * SideLanesPanel — sidebar widget showing spawned workflow side lanes.
 *
 * I render the lanes as stable operator-visible state so spawned work is
 * visible immediately, even if the main chat has already scrolled past the
 * original spawn message.
 */

import type { Rect } from "@takumi/core";
import type { Screen } from "@takumi/render";
import { Component, effect } from "@takumi/render";
import type { SideLaneSnapshot } from "../side-lane-store.js";
import type { AppState } from "../state.js";

export interface SideLanesPanelProps {
	state: AppState;
	maxLanes?: number;
}

const DEFAULT_MAX_LANES = 3;
const HEADER_COLOR = 6;
const LABEL_COLOR = 7;
const META_COLOR = 8;
const RUNNING_COLOR = 46;
const STARTING_COLOR = 214;
const ERROR_COLOR = 196;
const COMPLETE_COLOR = 33;

interface SideLaneView {
	icon: string;
	color: number;
	stateLabel: string;
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

function normalizeState(state: string, hasError: boolean): SideLaneView {
	if (hasError) {
		return { icon: "⚠", color: ERROR_COLOR, stateLabel: "ERROR" };
	}
	const normalized = state.trim().toLowerCase();
	if (normalized === "running") {
		return { icon: "●", color: RUNNING_COLOR, stateLabel: "RUN" };
	}
	if (normalized === "starting" || normalized === "booting" || normalized === "queued") {
		return { icon: "○", color: STARTING_COLOR, stateLabel: "BOOT" };
	}
	if (normalized === "done" || normalized === "complete" || normalized === "completed") {
		return { icon: "✓", color: COMPLETE_COLOR, stateLabel: "DONE" };
	}
	if (normalized === "stopped" || normalized === "cancelled" || normalized === "canceled") {
		return { icon: "■", color: META_COLOR, stateLabel: "STOP" };
	}
	return {
		icon: "·",
		color: META_COLOR,
		stateLabel: normalized ? normalized.slice(0, 4).toUpperCase() : "IDLE",
	};
}

function buildLaneDetail(lane: SideLaneSnapshot): string {
	const detail = lane.error || lane.responseSummary || lane.recentOutput || lane.model || lane.title;
	const cleanDetail = stripAnsi(detail).replace(/\s+/g, " ").trim();
	const target = lane.tmuxWindow || lane.branch || lane.id;
	return cleanDetail ? `${target} · ${cleanDetail}` : target;
}

export class SideLanesPanel extends Component {
	private readonly state: AppState;
	private readonly maxLanes: number;
	private _disposeEffect: (() => void) | null = null;

	constructor(props: SideLanesPanelProps) {
		super();
		this.state = props.state;
		this.maxLanes = props.maxLanes ?? DEFAULT_MAX_LANES;

		this._disposeEffect = effect(() => {
			const _lanes = this.state.sideLanes.entries.value;
			this.markDirty();
			return undefined;
		});
	}

	onUnmount(): void {
		this._disposeEffect?.();
		super.onUnmount();
	}

	/** Height this panel needs. I use two rows per lane plus one header row. */
	get height(): number {
		const laneCount = Math.min(this.state.sideLanes.entries.value.length, this.maxLanes);
		return laneCount > 0 ? 1 + laneCount * 2 : 0;
	}

	render(screen: Screen, rect: Rect): void {
		const lanes = this.state.sideLanes.list(this.maxLanes);
		if (lanes.length === 0) {
			return;
		}

		const { x, y, width } = rect;
		let cursorY = y;
		const maxY = y + rect.height;

		if (cursorY >= maxY) {
			return;
		}
		screen.writeText(cursorY++, x, "SIDE LANES", { fg: HEADER_COLOR, bold: true });

		for (const lane of lanes) {
			if (cursorY >= maxY) {
				break;
			}

			const view = normalizeState(lane.state, Boolean(lane.error));
			const title = `${view.icon} ${lane.commandName} ${view.stateLabel}`;
			screen.writeText(cursorY++, x, this.trunc(title, width), { fg: view.color, bold: true });

			if (cursorY >= maxY) {
				break;
			}

			const detail = buildLaneDetail(lane);
			const detailColor = lane.error ? ERROR_COLOR : META_COLOR;
			screen.writeText(cursorY++, x, this.trunc(detail, width), {
				fg: lane.responseSummary ? LABEL_COLOR : detailColor,
				dim: !lane.responseSummary,
			});
		}
	}

	private trunc(text: string, width: number): string {
		if (text.length <= width) {
			return text;
		}
		return `${text.slice(0, width - 1)}…`;
	}
}
