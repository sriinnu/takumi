import { ModelRouter, type TaskClassification, TaskComplexity, TaskType } from "@takumi/agent";
import type { OrchestrationConfig } from "@takumi/core";
import { describe, expect, it } from "vitest";
import { resolveTaskModelPlan } from "../src/agent/coding-agent-model-routing.js";

function makeClassification(overrides: Partial<TaskClassification> = {}): TaskClassification {
	return {
		complexity: TaskComplexity.STANDARD,
		type: TaskType.CODING,
		estimatedFiles: 4,
		riskLevel: 5,
		confidence: 0.9,
		reasoning: "default",
		...overrides,
	};
}

describe("resolveTaskModelPlan", () => {
	it("defaults the classifier to the cheap fast-tier model", () => {
		const router = new ModelRouter("anthropic");
		const plan = resolveTaskModelPlan(router, makeClassification());

		expect(plan.classifierModel).toBe("claude-haiku-4-20250514");
	});

	it("downgrades planner and worker for review-style tasks", () => {
		const router = new ModelRouter("anthropic");
		const plan = resolveTaskModelPlan(
			router,
			makeClassification({ type: TaskType.REVIEW, complexity: TaskComplexity.STANDARD }),
		);

		expect(plan.roleOverrides.WORKER).toBe("claude-sonnet-4-20250514");
		expect(plan.roleOverrides.PLANNER).toBe("claude-sonnet-4-5");
		expect(plan.roleOverrides.VALIDATOR_CODE).toBe("claude-haiku-4-20250514");
	});

	it("honors explicit task-specific model overrides", () => {
		const router = new ModelRouter("openai");
		const orchestrationConfig: OrchestrationConfig = {
			enabled: true,
			defaultMode: "multi",
			complexityThreshold: "STANDARD",
			maxValidationRetries: 3,
			isolationMode: "none",
			modelRouting: {
				worker: "gpt-4o",
				sideAgent: "gpt-4.1-mini",
				taskTypes: {
					RESEARCH: {
						classifier: "gpt-4o-mini",
						worker: "gpt-4.1-mini",
						validators: "gpt-4o-mini",
						sideAgent: "o3-mini",
					},
				},
			},
		};

		const plan = resolveTaskModelPlan(
			router,
			makeClassification({ type: TaskType.RESEARCH, complexity: TaskComplexity.SIMPLE }),
			orchestrationConfig,
		);

		expect(plan.classifierModel).toBe("gpt-4o-mini");
		expect(plan.roleOverrides.WORKER).toBe("gpt-4.1-mini");
		expect(plan.roleOverrides.VALIDATOR_SECURITY).toBe("gpt-4o-mini");
		expect(plan.sideAgentModel).toBe("o3-mini");
	});
});
