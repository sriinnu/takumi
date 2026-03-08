import { AgentRole, type ModelRouter, type TaskClassification, TaskComplexity, TaskType } from "@takumi/agent";
import type { OrchestrationConfig, OrchestrationModelRoleOverrides } from "@takumi/core";

export interface TaskModelPlan {
	classifierModel: string;
	roleOverrides: Partial<Record<AgentRole, string>>;
	sideAgentModel?: string;
}

export function resolveTaskModelPlan(
	router: ModelRouter,
	classification: TaskClassification,
	orchestrationConfig?: OrchestrationConfig,
): TaskModelPlan {
	const tierMap = router.getTierMap();
	const routing = orchestrationConfig?.modelRouting;
	const taskOverrides = routing?.taskTypes?.[classification.type];
	const balancedMode = routing?.mode === "balanced";
	const classifierModel = taskOverrides?.classifier ?? routing?.classifier ?? tierMap.fast;
	const roleOverrides: Partial<Record<AgentRole, string>> = {
		[AgentRole.WORKER]:
			pickRoleModel(taskOverrides, routing, "worker") ??
			defaultWorkerModel(router, classification, { balancedMode, useTierMap: tierMap }),
		[AgentRole.PLANNER]:
			pickRoleModel(taskOverrides, routing, "planner") ??
			defaultPlannerModel(router, classification, { balancedMode, useTierMap: tierMap }),
		[AgentRole.VALIDATOR_REQUIREMENTS]:
			pickValidatorModel(taskOverrides, routing, "validatorRequirements") ?? tierMap.fast,
		[AgentRole.VALIDATOR_CODE]: pickValidatorModel(taskOverrides, routing, "validatorCode") ?? tierMap.fast,
		[AgentRole.VALIDATOR_SECURITY]: pickValidatorModel(taskOverrides, routing, "validatorSecurity") ?? tierMap.fast,
		[AgentRole.VALIDATOR_TESTS]: pickValidatorModel(taskOverrides, routing, "validatorTests") ?? tierMap.fast,
		[AgentRole.VALIDATOR_ADVERSARIAL]:
			pickValidatorModel(taskOverrides, routing, "validatorAdversarial") ?? tierMap.fast,
	};

	return {
		classifierModel,
		roleOverrides,
		sideAgentModel: taskOverrides?.sideAgent ?? routing?.sideAgent,
	};
}

function defaultWorkerModel(
	router: ModelRouter,
	classification: TaskClassification,
	options: { balancedMode: boolean; useTierMap: ReturnType<ModelRouter["getTierMap"]> },
): string {
	if (!options.balancedMode && shouldDowngradeWorker(classification)) {
		return downgradeRecommendation(router, classification.complexity, "WORKER", options.useTierMap);
	}
	return router.recommend(classification.complexity, "WORKER").model;
}

function defaultPlannerModel(
	router: ModelRouter,
	classification: TaskClassification,
	options: { balancedMode: boolean; useTierMap: ReturnType<ModelRouter["getTierMap"]> },
): string {
	if (!options.balancedMode && shouldDowngradePlanner(classification)) {
		return downgradeRecommendation(router, classification.complexity, "PLANNER", options.useTierMap);
	}
	return router.recommend(classification.complexity, "PLANNER").model;
}

function downgradeRecommendation(
	router: ModelRouter,
	complexity: TaskComplexity,
	role: "PLANNER" | "WORKER",
	tierMap: ReturnType<ModelRouter["getTierMap"]>,
): string {
	const recommendation = router.recommend(complexity, role);
	if (recommendation.routeClass === "coding.patch-cheap" || recommendation.routeClass === "coding.fast-local") {
		return recommendation.model;
	}
	switch (recommendation.tier) {
		case "frontier":
			return tierMap.powerful;
		case "powerful":
			return tierMap.balanced;
		case "balanced":
			return tierMap.fast;
		default:
			return tierMap.fast;
	}
}

function shouldDowngradeWorker(classification: TaskClassification): boolean {
	return (
		classification.type === TaskType.RESEARCH ||
		classification.type === TaskType.REVIEW ||
		(classification.type === TaskType.REFACTOR && classification.complexity !== TaskComplexity.CRITICAL)
	);
}

function shouldDowngradePlanner(classification: TaskClassification): boolean {
	return (
		shouldDowngradeWorker(classification) ||
		(classification.type === TaskType.DEBUG && classification.complexity !== TaskComplexity.CRITICAL)
	);
}

function pickRoleModel(
	taskOverrides: OrchestrationModelRoleOverrides | undefined,
	routing: OrchestrationConfig["modelRouting"],
	key: "planner" | "worker",
): string | undefined {
	return taskOverrides?.[key] ?? routing?.[key];
}

function pickValidatorModel(
	taskOverrides: OrchestrationModelRoleOverrides | undefined,
	routing: OrchestrationConfig["modelRouting"],
	key: "validatorRequirements" | "validatorCode" | "validatorSecurity" | "validatorTests" | "validatorAdversarial",
): string | undefined {
	return taskOverrides?.[key] ?? taskOverrides?.validators ?? routing?.[key] ?? routing?.validators;
}
