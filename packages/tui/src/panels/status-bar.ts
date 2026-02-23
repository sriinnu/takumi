/**
 * StatusBarPanel — bottom status bar showing model, tokens, cost, etc.
 */

import type { Rect } from "@takumi/core";
import type { Screen } from "@takumi/render";
import { Component, effect } from "@takumi/render";
import type { AppState } from "../state.js";

export interface StatusBarPanelProps {
	state: AppState;
}

export class StatusBarPanel extends Component {
	private state: AppState;
	private disposeEffect: (() => void) | null = null;

	constructor(props: StatusBarPanelProps) {
		super();
		this.state = props.state;

		this.disposeEffect = effect(() => {
			const _status = this.state.statusText.value;
			const _chi = this.state.chitraguptaConnected.value;
			// Cluster signals — trigger re-render when active cluster state changes
			const _clusterId = this.state.clusterId.value;
			const _clusterPhase = this.state.clusterPhase.value;
			const _agentCount = this.state.clusterAgentCount.value;
			const _tokens = this.state.totalTokens.value;
			const _cost = this.state.totalCost.value;
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

		// Left side: model name
		const leftText = ` ${model} `;
		screen.writeText(rect.y, rect.x, leftText, { fg: 15, bg: 236, bold: true });

		// Chitragupta connection indicator (right after model name)
		const chiConnected = this.state.chitraguptaConnected.value;
		const chiIndicator = chiConnected ? " \u091A\u093F " : " \u091A\u093F ";
		const chiCol = rect.x + leftText.length;
		screen.writeText(rect.y, chiCol, chiIndicator, {
			fg: chiConnected ? 2 : 8, // green when connected, gray when not
			bg: 236,
			dim: !chiConnected,
		});

		// Cluster state indicator — shown when a cluster is actively running
		let afterChiCol = chiCol + chiIndicator.length;
		if (clusterId) {
			// Show phase + agent count badge: e.g. " ⬡ VALIDATING 4↑ "
			const clusterText = ` \u2B21 ${clusterPhase} ${agentCount}\u2191 `;
			screen.writeText(rect.y, afterChiCol, clusterText, {
				fg: clusterPhase === "DONE" ? 2 : clusterPhase === "FAILED" ? 1 : 3,
				bg: 236,
				bold: true,
			});
			afterChiCol += clusterText.length;
		}

		// Center: status
		const centerText = ` ${status} `;
		const centerCol = rect.x + Math.floor((rect.width - centerText.length) / 2);
		screen.writeText(rect.y, centerCol, centerText, {
			fg: isStreaming ? 3 : 7,
			bg: 236,
		});

		// Right side: tokens, cost, keybind hints
		const tokens = this.state.totalTokens.value;
		const cost = this.state.totalCost.value;
		const metricsText = tokens > 0 ? ` ${tokens.toLocaleString()}t | $${cost.toFixed(3)} ` : "";
		const rightText = `${metricsText} Ctrl+C quit  Ctrl+K cmd  Ctrl+L clear `;
		const rightCol = rect.x + rect.width - rightText.length;
		if (rightCol > centerCol + centerText.length) {
			screen.writeText(rect.y, rightCol, rightText, { fg: 8, bg: 236, dim: true });
		}
	}
}
