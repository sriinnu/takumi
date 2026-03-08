import { buildCognitiveState, SteeringPriority } from "@takumi/agent";

describe("buildCognitiveState", () => {
	it("enters recover mode for critical anomalies", () => {
		const state = buildCognitiveState({
			connected: true,
			integrityStatus: "warning",
			integritySummary: "Scarlett sees drift.",
			anomaly: {
				severity: "critical",
				details: "loop detected",
				suggestion: "abort the current branch",
			},
			contextPressure: "normal",
			predictions: [],
			patternMatches: [],
			routingDecisions: [],
			steeringPending: 0,
			now: 1,
		});

		expect(state.awareness.stance).toBe("critical");
		expect(state.workspace.mode).toBe("recover");
		expect(state.intuition.dominantSignal?.kind).toBe("anomaly");
		expect(state.workspace.recommendedDirectives[0]).toMatchObject({
			priority: SteeringPriority.INTERRUPT,
			text: "abort the current branch",
		});
	});

	it("enters consolidate mode near the context ceiling", () => {
		const state = buildCognitiveState({
			connected: true,
			integrityStatus: "healthy",
			contextPressure: "near_limit",
			contextPercent: 96,
			predictions: [],
			patternMatches: [],
			routingDecisions: [],
			steeringPending: 0,
			now: 2,
		});

		expect(state.awareness.contextPressure).toBe("near_limit");
		expect(state.awareness.stance).toBe("strained");
		expect(state.workspace.mode).toBe("consolidate");
		expect(state.workspace.recommendedDirectives[0]?.text).toContain("compact");
	});

	it("stabilizes around high-confidence failure warnings", () => {
		const state = buildCognitiveState({
			connected: true,
			integrityStatus: "healthy",
			contextPressure: "normal",
			predictions: [
				{
					type: "failure_warning",
					action: "apply patch to router",
					confidence: 0.88,
					risk: 0.91,
					suggestion: "validate route health first",
				},
			],
			patternMatches: [],
			routingDecisions: [],
			steeringPending: 0,
			now: 3,
		});

		expect(state.intuition.dominantSignal?.kind).toBe("prediction");
		expect(state.workspace.mode).toBe("stabilize");
		expect(state.workspace.recommendedDirectives[0]).toMatchObject({
			priority: SteeringPriority.INTERRUPT,
			text: "validate route health first",
		});
	});
});
