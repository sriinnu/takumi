/**
 * RouteCardPanel — sidebar widget showing the latest routing decision.
 *
 * Displays authority badge (engine | takumi-fallback), enforcement badge
 * (same-provider | capability-only), degraded/fallback indicator, and the
 * selected capability + reason.  Only renders when there is at least one
 * routing decision in state.
 */

import type { Rect } from "@takumi/core";
import type { Screen } from "@takumi/render";
import { Component, effect } from "@takumi/render";
import type { AppState } from "../state.js";

export interface RouteCardPanelProps {
	state: AppState;
}

/** Lines rendered per card in the normal (expanded) view. */
const CARD_HEIGHT = 5;

// ANSI 256-colour codes
const FG_ENGINE = 46; // bright green — control-plane routed
const FG_FALLBACK = 214; // orange — Takumi local fallback
const FG_DEGRADED = 196; // red
const FG_OK = 2; // green
const FG_DIM = 8;
const FG_LABEL = 6;

export class RouteCardPanel extends Component {
	private readonly state: AppState;
	private _disposeEffect: (() => void) | null = null;

	constructor(props: RouteCardPanelProps) {
		super();
		this.state = props.state;

		this._disposeEffect = effect(() => {
			// Re-render whenever routing decisions or connection state changes
			const _decisions = this.state.routingDecisions.value;
			const _connected = this.state.chitraguptaConnected.value;
			this.markDirty();
			return undefined;
		});
	}

	onUnmount(): void {
		this._disposeEffect?.();
		super.onUnmount();
	}

	/** Height this panel occupies; 0 when no routing data is available. */
	get height(): number {
		const decisions = this.state.routingDecisions.value;
		if (decisions.length === 0) return 0;
		// Section header + card rows
		return 1 + CARD_HEIGHT;
	}

	render(screen: Screen, rect: Rect): void {
		const decisions = this.state.routingDecisions.value;
		if (decisions.length === 0) return;

		const latest = decisions.at(-1);
		if (!latest) return;
		const { x, y, width } = rect;
		let cursorY = y;
		const maxY = y + rect.height;

		// ── Section header ────────────────────────────────────────────────
		if (cursorY >= maxY) return;
		const header = "ROUTE";
		screen.writeText(cursorY, x, header, { fg: FG_LABEL, bold: true });
		cursorY++;

		// ── Authority + enforcement badge ─────────────────────────────────
		if (cursorY >= maxY) return;
		const authority = latest.selected ? "engine" : "takumi-fallback";
		const authorityFg = authority === "engine" ? FG_ENGINE : FG_FALLBACK;
		const authorityIcon = authority === "engine" ? "✦" : "↩";
		const enforcement = latest.selected ? "same-provider" : "capability-only";
		const authorityLabel = `${authorityIcon} ${authority} [${enforcement}]`;
		screen.writeText(cursorY, x, this.trunc(authorityLabel, width), { fg: authorityFg, bold: true });
		cursorY++;

		// ── Capability + degraded status ──────────────────────────────────
		if (cursorY >= maxY) return;
		const capability = latest.request?.capability ?? "unknown";
		const degradedSuffix = latest.degraded === true ? " ⚠ degraded" : "";
		const capFg = latest.degraded === true ? FG_DEGRADED : FG_OK;
		const capLine = this.trunc(capability + degradedSuffix, width);
		screen.writeText(cursorY, x, capLine, { fg: capFg });
		cursorY++;

		// ── Selected capability ID + fallback chain ───────────────────────
		if (cursorY >= maxY) return;
		const selectedId = latest.selected?.id ?? "(local-fallback)";
		const fallbackCount = latest.fallbackChain?.length ?? 0;
		const fbSuffix = fallbackCount > 0 ? ` (↻${fallbackCount} fallback${fallbackCount > 1 ? "s" : ""})` : "";
		screen.writeText(cursorY, x, this.trunc(`→ ${selectedId}${fbSuffix}`, width), { fg: FG_DIM, dim: true });
		cursorY++;

		// ── Reason (truncated to one line) ────────────────────────────────
		if (cursorY >= maxY) return;
		const reason = latest.reason ?? "";
		if (reason) {
			screen.writeText(cursorY, x, this.trunc(reason, width), { fg: FG_DIM, dim: true, italic: true });
		}
		cursorY++;

		// ── Degraded reason (extra detail when degraded) ──────────────────
		if (cursorY >= maxY) return;
		if (latest.degraded === true && latest.policyTrace?.length > 0) {
			const trace = latest.policyTrace[latest.policyTrace.length - 1] ?? "";
			if (trace) {
				screen.writeText(cursorY, x, this.trunc(`⚠ ${trace}`, width), { fg: FG_DEGRADED, dim: true });
			}
		}
	}

	private trunc(text: string, width: number): string {
		if (text.length <= width) return text;
		return `${text.slice(0, width - 1)}\u2026`;
	}
}
