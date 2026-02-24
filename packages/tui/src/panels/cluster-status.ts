/**
 * ClusterStatusPanel — live badge in the sidebar showing multi-agent cluster progress.
 *
 * Renders a single summary line when collapsed, and a full status block when expanded.
 * Auto-expands when a cluster becomes active; collapses back to one line when idle.
 * Toggle with the `toggle()` method (wired to Ctrl+Shift+C in app.ts).
 */

import type { Rect } from "@takumi/core";
import type { Screen } from "@takumi/render";
import { Border, Component, effect } from "@takumi/render";
import type { AppState } from "../state.js";

// ANSI 256-color codes for each cluster phase
const PHASE_COLORS: Record<string, number> = {
	idle: 8, // dark grey
	planning: 27, // blue
	executing: 220, // yellow
	validating: 208, // orange
	fixing: 196, // red
	done: 46, // bright green
};

// Single-char phase icons
const PHASE_ICONS: Record<string, string> = {
	idle: "·",
	planning: "◎",
	executing: "◉",
	validating: "◈",
	fixing: "◆",
	done: "✓",
};

/** Number of rows the expanded panel occupies. */
const EXPANDED_HEIGHT = 6;

export interface ClusterStatusPanelProps {
	state: AppState;
}

export class ClusterStatusPanel extends Component {
	private state: AppState;
	private border: Border;
	private _collapsed = true;
	private _disposeEffect: (() => void) | null = null;
	/** Spinner frame counter for active phases. */
	private _spinFrame = 0;
	private _spinInterval: ReturnType<typeof setInterval> | null = null;

	constructor(props: ClusterStatusPanelProps) {
		super();
		this.state = props.state;

		this.border = new Border({
			style: "single",
			title: "Cluster",
			color: 8,
			titleColor: 15,
		});

		// Subscribe to cluster signals and auto-expand on activity
		this._disposeEffect = effect(() => {
			const phase = this.state.clusterPhase.value;
			const clusterId = this.state.clusterId.value;

			// Auto-expand when a cluster starts; auto-collapse when it goes idle
			if (clusterId && phase !== "idle") {
				this._collapsed = false;
				this._startSpinner();
			} else if (!clusterId && phase === "idle") {
				this._stopSpinner();
			}

			this.markDirty();
			return undefined;
		});
	}

	/** Toggle collapsed / expanded state. */
	toggle(): void {
		this._collapsed = !this._collapsed;
		this.markDirty();
	}

	/** Returns the number of rows this panel occupies in the layout. */
	get height(): number {
		const phase = this.state.clusterPhase.value;
		const clusterId = this.state.clusterId.value;

		if (!clusterId && phase === "idle") return 0; // Hidden when no cluster
		return this._collapsed ? 1 : EXPANDED_HEIGHT;
	}

	onUnmount(): void {
		this._disposeEffect?.();
		this._disposeEffect = null;
		this._stopSpinner();
		super.onUnmount();
	}

	render(screen: Screen, rect: Rect): void {
		const phase = this.state.clusterPhase.value;
		const clusterId = this.state.clusterId.value;

		// Nothing to render when idle with no cluster
		if (!clusterId && phase === "idle") return;
		if (rect.height < 1 || rect.width < 4) return;

		const color = PHASE_COLORS[phase.toLowerCase()] ?? 8;
		const icon = PHASE_ICONS[phase.toLowerCase()] ?? "·";
		const agents = this.state.clusterAgentCount.value;
		const attempt = this.state.clusterValidationAttempt.value;
		const isolation = this.state.isolationMode.value;
		const phaseLabel = phase.toUpperCase();

		if (this._collapsed) {
			// ── Collapsed: single summary line ───────────────────────────────────
			const spinner = this._spinnerChar();
			const agentPart = agents > 0 ? ` ${agents}×` : "";
			const attemptPart = attempt > 0 ? ` ·${attempt}` : "";
			const label = `${icon} ${phaseLabel}${agentPart}${attemptPart} ${spinner}`;
			const truncated = label.length > rect.width ? label.slice(0, rect.width) : label;
			screen.writeText(rect.y, rect.x, truncated, { fg: color, bold: phase !== "idle" });
		} else {
			// ── Expanded: bordered block ──────────────────────────────────────────
			const panelRect: Rect = {
				x: rect.x,
				y: rect.y,
				width: Math.min(rect.width, 36),
				height: Math.min(rect.height, EXPANDED_HEIGHT),
			};

			this.border.render(screen, panelRect);

			const innerX = panelRect.x + 1;
			const innerW = panelRect.width - 2;
			let y = panelRect.y + 1;
			const maxY = panelRect.y + panelRect.height - 1;

			const writeRow = (text: string, fg: number, bold = false) => {
				if (y >= maxY) return;
				const t = text.length > innerW ? text.slice(0, innerW) : text;
				screen.writeText(y++, innerX, t, { fg, bold });
			};

			// Phase line with spinner
			const spinner = this._spinnerChar();
			writeRow(`${icon} ${phaseLabel} ${spinner}`, color, true);

			// Agents
			writeRow(`  Agents:    ${agents > 0 ? agents : "—"}`, 7);

			// Validation attempt
			writeRow(`  Attempt:   ${attempt > 0 ? attempt : "—"}`, attempt > 2 ? 208 : 7);

			// Isolation badge
			const isoColor = isolation === "docker" ? 33 : isolation === "worktree" ? 35 : 8;
			writeRow(`  Isolation: ${isolation}`, isoColor);

			// Cluster ID (abbreviated)
			if (clusterId) {
				const shortId = clusterId.length > innerW - 5 ? `${clusterId.slice(0, innerW - 6)}…` : clusterId;
				writeRow(`  ID: ${shortId}`, 8);
			}
		}
	}

	/** Advance and return the current spinner character. */
	private _spinnerChar(): string {
		const phase = this.state.clusterPhase.value;
		if (phase === "idle" || phase === "done") return "";
		const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
		return frames[this._spinFrame % frames.length] ?? "";
	}

	private _startSpinner(): void {
		if (this._spinInterval) return;
		this._spinInterval = setInterval(() => {
			this._spinFrame++;
			this.markDirty();
		}, 80);
	}

	private _stopSpinner(): void {
		if (this._spinInterval) {
			clearInterval(this._spinInterval);
			this._spinInterval = null;
		}
	}
}
