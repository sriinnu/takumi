/**
 * StatusBarPanel — bottom status bar showing model, tokens, cost, etc.
 */

import type { Rect, TakumiConfig } from "@takumi/core";
import type { Screen } from "@takumi/render";
import { Component, effect } from "@takumi/render";
import type { AppState } from "../state.js";

export interface StatusBarPanelProps {
	state: AppState;
	config: TakumiConfig;
}

export class StatusBarPanel extends Component {
	private state: AppState;
	private config: TakumiConfig;
	private disposeEffect: (() => void) | null = null;

	constructor(props: StatusBarPanelProps) {
		super();
		this.state = props.state;
		this.config = props.config;

		this.disposeEffect = effect(() => {
			const _status = this.state.statusText.value;
			const _chi = this.state.chitraguptaConnected.value;
			const _scarlett = this.state.scarlettIntegrityReport.value;
			// Cluster signals — trigger re-render when active cluster state changes
			const _clusterId = this.state.clusterId.value;
			const _clusterPhase = this.state.clusterPhase.value;
			const _agentCount = this.state.clusterAgentCount.value;
			const _tokens = this.state.totalTokens.value;
			const _cost = this.state.totalCost.value;
			// Akasha mesh signals
			const _deposits = this.state.akashaDeposits.value;
			const _meshSize = this.state.akashaMeshSize.value;
			const _lastActivity = this.state.akashaLastActivity.value;
			// Context pressure signals (Phase 20.4)
			const _contextPercent = this.state.contextPercent.value;
			const _contextPressure = this.state.contextPressure.value;
			const _consolidation = this.state.consolidationInProgress.value;
			this.markDirty();
			return undefined;
		});
	}

	onUnmount(): void {
		this.disposeEffect?.();
		super.onUnmount();
	}

	render(screen: Screen, rect: Rect): void {
		const model = this.state.model.value;
		const status = this.state.statusText.value;
		const isStreaming = this.state.isStreaming.value;
		const clusterId = this.state.clusterId.value;
		const clusterPhase = this.state.clusterPhase.value;
		const agentCount = this.state.clusterAgentCount.value;

		// Background fill
		for (let col = rect.x; col < rect.x + rect.width; col++) {
			screen.set(rect.y, col, {
				char: " ",
				fg: 7,
				bg: 236,
				bold: false,
				dim: false,
				italic: false,
				underline: false,
				strikethrough: false,
			});
		}

		const renderWidget = (widget: string): { text: string; fg: number; bg: number; bold?: boolean; dim?: boolean } => {
			switch (widget) {
				case "model":
					return { text: ` ${model} `, fg: 15, bg: 236, bold: true };
				case "mesh": {
					const chiConnected = this.state.chitraguptaConnected.value;
					const deposits = this.state.akashaDeposits.value;
					const meshSize = this.state.akashaMeshSize.value;
					const meshIndicator = chiConnected ? ` \u0293 ${meshSize}\u2191 ${deposits}\u29BF ` : " \u0293 ";
					return { text: meshIndicator, fg: chiConnected ? 2 : 8, bg: 236, bold: chiConnected, dim: !chiConnected };
				}
				case "scarlett": {
					const report = this.state.scarlettIntegrityReport.value;
					const text = report.status === "critical" ? " 🛡 crit " : report.status === "warning" ? " 🛡 warn " : " 🛡 ok ";
					const fg = report.status === "critical" ? 1 : report.status === "warning" ? 3 : 2;
					return { text, fg, bg: 236, bold: report.status !== "healthy" };
				}
				case "cluster": {
					if (clusterId) {
						const clusterText = ` \u2B21 ${clusterPhase} ${agentCount}\u2191 `;
						return {
							text: clusterText,
							fg: clusterPhase === "DONE" ? 2 : clusterPhase === "FAILED" ? 1 : 3,
							bg: 236,
							bold: true,
						};
					}
					return { text: "", fg: 7, bg: 236 };
				}
				case "status":
					return {
						text: this.state.consolidationInProgress.value ? " ⟳ consolidating… " : ` ${status} `,
						fg: this.state.consolidationInProgress.value ? 214 : isStreaming ? 3 : 7,
						bg: 236,
					};
				case "metrics": {
					const tokens = this.state.totalTokens.value;
					const cost = this.state.totalCost.value;
					const metricsText = tokens > 0 ? ` ${tokens.toLocaleString()}t | $${cost.toFixed(3)} ` : "";
					return { text: metricsText, fg: 8, bg: 236, dim: true };
				}
				case "context": {
					const percent = this.state.contextPercent.value;
					const pressure = this.state.contextPressure.value;

					// Only show if context tracking is active (percent > 0)
					if (percent === 0) return { text: "", fg: 7, bg: 236 };

					// Icon and color based on pressure level
					const icon =
						{
							normal: "✓",
							approaching_limit: "⚠",
							near_limit: "◆",
							at_limit: "⬤",
						}[pressure] || "·";

					const fg =
						{
							normal: 2, // green
							approaching_limit: 3, // yellow
							near_limit: 214, // orange
							at_limit: 1, // red
						}[pressure] || 8;

					const text = ` ${icon} ${Math.round(percent)}% `;
					return { text, fg, bg: 236, bold: pressure !== "normal" };
				}
				case "keybinds":
					return { text: " Ctrl+C quit  Ctrl+K cmd  Ctrl+L clear ", fg: 8, bg: 236, dim: true };
				default:
					return { text: ` [${widget}] `, fg: 7, bg: 236 };
			}
		};

		const statusBarConfig = this.config.statusBar || {
			left: ["model", "mesh", "cluster"],
			center: ["status"],
			right: ["metrics", "context", "scarlett", "keybinds"],
		};

		// ── Branded anchor: 匠 always pinned at position 0 ──────────────────────
		const BRAND = " 匠 ";
		const themeAnsi = typeof this.config.theme === "object" ? this.config.theme.ansi : undefined;
		const brandFg = themeAnsi?.primary ?? 141;
		const brandBg = themeAnsi?.bgBrand ?? 55;
		const brandSeparatorFg = themeAnsi?.muted ?? 99;
		const brandSeparatorBg = themeAnsi?.bg ?? 236;
		screen.writeText(rect.y, rect.x, BRAND, { fg: brandFg, bg: brandBg, bold: true });
		const brandWidth = BRAND.length;
		// Separator pip after brand
		screen.writeText(rect.y, rect.x + brandWidth, "│", { fg: brandSeparatorFg, bg: brandSeparatorBg, bold: false });
		const anchorWidth = brandWidth + 1; // brand + separator

		// Left side
		let currentLeftCol = rect.x + anchorWidth;
		for (const widget of statusBarConfig.left || []) {
			const rendered = renderWidget(widget);
			if (rendered.text) {
				screen.writeText(rect.y, currentLeftCol, rendered.text, rendered);
				currentLeftCol += rendered.text.length;
			}
		}

		// Center
		let centerText = "";
		const centerWidgets = (statusBarConfig.center || []).map(renderWidget);
		for (const rendered of centerWidgets) {
			centerText += rendered.text;
		}
		const centerCol = rect.x + Math.floor((rect.width - centerText.length) / 2);
		let currentCenterCol = centerCol;
		for (const rendered of centerWidgets) {
			if (rendered.text) {
				screen.writeText(rect.y, currentCenterCol, rendered.text, rendered);
				currentCenterCol += rendered.text.length;
			}
		}

		// Right side
		let rightText = "";
		const rightWidgets = (statusBarConfig.right || []).map(renderWidget);
		for (const rendered of rightWidgets) {
			rightText += rendered.text;
		}
		const rightCol = rect.x + rect.width - rightText.length;
		if (rightCol > centerCol + centerText.length) {
			let currentRightCol = rightCol;
			for (const rendered of rightWidgets) {
				if (rendered.text) {
					screen.writeText(rect.y, currentRightCol, rendered.text, rendered);
					currentRightCol += rendered.text.length;
				}
			}
		}
	}
}
