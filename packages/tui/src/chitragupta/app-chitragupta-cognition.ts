import type { AppState } from "../state.js";

export function upsertPatternMatch(
	state: AppState,
	pattern: { type: string; confidence: number; lastSeen?: number },
): void {
	state.chitraguptaPatternMatches.value = [
		pattern,
		...state.chitraguptaPatternMatches.value.filter((entry) => entry.type !== pattern.type),
	].slice(0, 5);
}

export function buildTelemetryCognition(state: AppState): {
	stance: "stable" | "watchful" | "strained" | "critical";
	workspaceMode: "monitor" | "execute" | "stabilize" | "consolidate" | "recover";
	dominantSignal: string | null;
	dominantSummary: string | null;
	directiveBacklog: number;
	signalCount: number;
} {
	const cognition = state.cognitiveState.value;
	return {
		stance: cognition.awareness.stance,
		workspaceMode: cognition.workspace.mode,
		dominantSignal: cognition.intuition.dominantSignal?.kind ?? null,
		dominantSummary: cognition.intuition.dominantSignal?.summary ?? null,
		directiveBacklog: cognition.workspace.backlog,
		signalCount: cognition.intuition.signals.length,
	};
}
