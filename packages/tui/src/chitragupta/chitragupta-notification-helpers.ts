function parseStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.map((entry) => String(entry ?? "").trim()).filter(Boolean) : [];
}

export function normalizePredictions(params: Record<string, unknown>): Array<{
	type: string;
	action?: string;
	files?: string[];
	confidence: number;
	reasoning?: string;
	risk?: number;
	pastFailures?: number;
	suggestion?: string;
}> {
	const raw = Array.isArray(params.predictions) ? params.predictions : [];
	const predictions: Array<{
		type: string;
		action?: string;
		files?: string[];
		confidence: number;
		reasoning?: string;
		risk?: number;
		pastFailures?: number;
		suggestion?: string;
	}> = [];

	for (const entry of raw) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
		const prediction = entry as Record<string, unknown>;
		const confidence = Number(prediction.confidence ?? 0);
		predictions.push({
			type: String(prediction.type ?? params.type ?? "prediction"),
			action: typeof prediction.action === "string" ? prediction.action : undefined,
			files: parseStringArray(prediction.files),
			confidence: Number.isFinite(confidence) ? confidence : 0,
			reasoning: typeof prediction.reasoning === "string" ? prediction.reasoning : undefined,
			risk: Number.isFinite(Number(prediction.risk)) ? Number(prediction.risk) : undefined,
			pastFailures: Number.isFinite(Number(prediction.pastFailures)) ? Number(prediction.pastFailures) : undefined,
			suggestion: typeof prediction.suggestion === "string" ? prediction.suggestion : undefined,
		});
	}

	return predictions;
}
