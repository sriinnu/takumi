/**
 * Dynamic Temperature Scaling
 *
 * Calculates the optimal temperature for a task based on complexity, phase,
 * and retry count. Extracted from model-router.ts for LOC guardrail.
 *
 * Research Foundation: Temperature controls exploration vs exploitation
 * in LLM sampling.
 */

/**
 * @param complexity - Task complexity level (string to avoid circular dep)
 * @param phase - Current cluster phase (string to avoid circular dep)
 * @param attemptNumber - 1-indexed retry count (default: 1)
 * @returns Temperature value in [0.0, 1.0]
 */
export function getTemperatureForTask(
	complexity: "TRIVIAL" | "SIMPLE" | "STANDARD" | "CRITICAL",
	phase: "PLANNING" | "EXECUTING" | "VALIDATING" | "FIXING",
	attemptNumber = 1,
): number {
	const baseTemps: Record<string, number> = {
		TRIVIAL: 0.3,
		SIMPLE: 0.5,
		STANDARD: 0.7,
		CRITICAL: 0.9,
	};
	let temp = baseTemps[complexity] ?? 0.7;

	if (phase === "VALIDATING") return 0.2;

	const phaseAdjustments: Record<string, number> = {
		PLANNING: 0.1,
		EXECUTING: 0.0,
		FIXING: -0.2,
	};
	temp += phaseAdjustments[phase] ?? 0;

	if (attemptNumber > 1) {
		const decayFactor = Math.min(attemptNumber - 1, 3) * 0.1;
		temp = Math.max(0.3, temp - decayFactor);
	}

	return Math.max(0.0, Math.min(1.0, temp));
}
