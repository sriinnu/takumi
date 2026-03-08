import { enqueueDirective, wasRecentlyHandled } from "./chitragupta-runtime-helpers.js";
import type { AppState } from "./state.js";

export async function hydrateRunnerCognition(state: AppState): Promise<string> {
	const observer = state.chitraguptaObserver.value;
	const sessionId = state.sessionId.value;
	if (!observer || !sessionId) return "";

	const [predictionResult, patternResult] = await Promise.all([
		observer.predictNext({
			currentTool: state.activeTool.value ?? undefined,
			currentFile: state.previewFile.value || undefined,
			sessionId,
		}),
		observer.patternQuery({ minConfidence: 0.65, limit: 5 }),
	]);

	if (predictionResult.predictions.length > 0) {
		state.chitraguptaPredictions.value = predictionResult.predictions.map((prediction) => ({
			type: prediction.type,
			action: prediction.action ?? (prediction.files?.length ? prediction.files.join(", ") : prediction.type),
			confidence: prediction.confidence,
			risk: prediction.risk,
			reasoning: prediction.reasoning,
			suggestion: prediction.suggestion,
			files: prediction.files,
		}));
	}

	state.chitraguptaPatternMatches.value = patternResult.patterns.map((pattern) => ({
		id: pattern.id,
		type: pattern.type,
		confidence: pattern.confidence,
		occurrences: pattern.occurrences,
		lastSeen: pattern.lastSeen,
	}));

	const lines = predictionResult.predictions.slice(0, 3).map((prediction, index) => {
		const subject = prediction.action
			? prediction.action
			: prediction.files?.length
				? prediction.files.join(", ")
				: prediction.type;
		const note = prediction.reasoning ?? "";
		return `${index + 1}. ${prediction.type}: ${subject} (${Math.round(prediction.confidence * 100)}%)${note ? ` — ${note}` : ""}`;
	});
	return lines.length > 0 ? `## Chitragupta Live Guidance\n${lines.join("\n")}` : "";
}

export function materializeWorkspaceDirectives(state: AppState): void {
	const workspacePlan = state.cognitiveState.value.workspace;
	if (workspacePlan.recommendedDirectives.length === 0 || state.steeringPending.value >= 4) return;

	for (const directive of workspacePlan.recommendedDirectives) {
		if (wasRecentlyHandled(`cognition:${directive.id}`, 15_000)) continue;
		enqueueDirective(state, `Takumi cognitive workspace: ${directive.text}`, directive.priority, {
			source: "takumi-cognition",
			workspaceMode: workspacePlan.mode,
			directiveId: directive.id,
			rationale: directive.rationale,
		});
	}
}
