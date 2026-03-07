import { TaskComplexity, TaskType } from "../src/classifier.js";
import {
	AgentRole,
	adaptTopologyAfterRejection,
	deriveClusterConfig,
	shouldEscalateWeakConsensus,
} from "../src/index.js";

describe("mesh policy", () => {
	const standardTopology = {
		totalAgents: 4,
		validatorCount: 2,
		usePlanner: true,
		validationStrategy: "majority",
	} as const;

	it("lets Lucy pick a council mesh for standard refactors", () => {
		const result = deriveClusterConfig({
			description: "refactor orchestration runtime",
			classification: {
				complexity: TaskComplexity.STANDARD,
				type: TaskType.REFACTOR,
				estimatedFiles: 6,
				riskLevel: 6,
				confidence: 0.9,
				reasoning: "cross-package refactor",
			},
			topology: standardTopology,
			maxRetries: 3,
			integrityStatus: "healthy",
		});

		expect(result.topology).toBe("council");
		expect(result.roles).toEqual([
			AgentRole.PLANNER,
			AgentRole.WORKER,
			AgentRole.VALIDATOR_CODE,
			AgentRole.VALIDATOR_REQUIREMENTS,
		]);
		expect(result.reasons[0]).toContain("Lucy selected council topology");
	});

	it("lets Scarlett downgrade risky meshes when integrity is warning", () => {
		const result = deriveClusterConfig({
			description: "research failure modes",
			classification: {
				complexity: TaskComplexity.SIMPLE,
				type: TaskType.RESEARCH,
				estimatedFiles: 2,
				riskLevel: 3,
				confidence: 0.7,
				reasoning: "parallel discovery task",
			},
			topology: {
				totalAgents: 2,
				validatorCount: 1,
				usePlanner: false,
				validationStrategy: "single",
			},
			maxRetries: 2,
			integrityStatus: "warning",
		});

		expect(result.topology).toBe("council");
		expect(result.reasons.some((reason) => reason.includes("Scarlett downgraded topology"))).toBe(true);
	});

	it("escalates to Sabha and healing mode on critical integrity", () => {
		const result = deriveClusterConfig({
			description: "debug auth bypass",
			classification: {
				complexity: TaskComplexity.CRITICAL,
				type: TaskType.DEBUG,
				estimatedFiles: 8,
				riskLevel: 10,
				confidence: 0.95,
				reasoning: "critical path",
			},
			topology: {
				totalAgents: 7,
				validatorCount: 5,
				usePlanner: true,
				validationStrategy: "all_approve",
			},
			maxRetries: 4,
			integrityStatus: "critical",
			orchestrationConfig: {
				enabled: true,
				defaultMode: "multi",
				complexityThreshold: "STANDARD",
				maxValidationRetries: 4,
				isolationMode: "none",
				mesh: {
					sabhaEscalation: {
						enabled: true,
						integrityThreshold: "critical",
						minValidationAttempts: 1,
					},
				},
			},
		});

		expect(result.topology).toBe("healing");
		expect(result.validationStrategy).toBe("all_approve");
		expect(result.escalateToSabha).toBe(true);
		expect(result.roles).toEqual([
			AgentRole.PLANNER,
			AgentRole.WORKER,
			AgentRole.VALIDATOR_REQUIREMENTS,
			AgentRole.VALIDATOR_CODE,
		]);
	});

	it("adapts topology across rejection attempts", () => {
		expect(adaptTopologyAfterRejection("hierarchical", 1)).toBe("council");
		expect(adaptTopologyAfterRejection("council", 2)).toBe("adversarial");
		expect(adaptTopologyAfterRejection("adversarial", 3)).toBe("healing");
		expect(adaptTopologyAfterRejection("swarm", 1, { lucyAdaptiveTopology: false })).toBe("swarm");
	});

	it("only escalates weak consensus after the configured attempt threshold", () => {
		expect(
			shouldEscalateWeakConsensus(1, 1, 1, {
				sabhaEscalation: { enabled: true, minValidationAttempts: 2 },
			}),
		).toBe(false);
		expect(
			shouldEscalateWeakConsensus(2, 1, 2, {
				sabhaEscalation: { enabled: true, minValidationAttempts: 2 },
			}),
		).toBe(true);
		expect(
			shouldEscalateWeakConsensus(0, 2, 2, {
				sabhaEscalation: { enabled: true, minValidationAttempts: 1 },
			}),
		).toBe(false);
	});
});
