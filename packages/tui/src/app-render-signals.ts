/**
 * App render signal bindings — explicit scheduler subscriptions for TUI state.
 *
 * I keep render-driving signals centralized here so operator-visible surfaces
 * stay honest when state changes outside the main chat stream.
 */

import { effect } from "@takumi/render";
import type { AppState } from "./state.js";

export interface RenderSchedulerLike {
	scheduleRender(): void;
}

/**
 * Bind the app-state signals that must trigger a repaint.
 *
 * I split the bindings into primary chat/runtime and sidebar/operator surfaces
 * so the render contract is explicit and testable.
 */
export function bindAppRenderSignals(state: AppState, scheduler: RenderSchedulerLike): Array<() => void> {
	return [
		effect(() => {
			// I repaint the main conversation surface from the core chat/runtime signals.
			void state.messages.value;
			void state.streamingText.value;
			void state.thinkingText.value;
			void state.isStreaming.value;
			void state.codingPhase.value;
			void state.autocyclePhase.value;
			void state.activeTool.value;
			void state.toolOutput.value;
			void state.dialogStack.value;
			scheduler.scheduleRender();
			return undefined;
		}),
		effect(() => {
			// I repaint the operator surfaces separately so sidebar-only state cannot go stale.
			void state.sidebarVisible.value;
			void state.previewVisible.value;
			void state.previewFile.value;
			void state.modifiedFiles.value;
			void state.provider.value;
			void state.model.value;
			void state.turnCount.value;
			void state.totalInputTokens.value;
			void state.totalOutputTokens.value;
			void state.totalCost.value;
			void state.clusterPhase.value;
			void state.clusterId.value;
			void state.clusterAgentCount.value;
			void state.clusterValidationAttempt.value;
			void state.isolationMode.value;
			void state.routingDecisions.value;
			void state.sideLanes.entries.value;
			void state.lastSabhaId.value;
			void state.chitraguptaPredictions.value;
			void state.chitraguptaPatternMatches.value;
			scheduler.scheduleRender();
			return undefined;
		}),
	];
}
