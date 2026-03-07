import type { DockerIsolationConfig, MeshTopologyMode, OrchestrationConfig } from "@takumi/core";
import { type AgentTopology, type TaskClassification, TaskComplexity, TaskType } from "../classifier.js";
import { AgentRole, type ClusterConfig, type ClusterTopology } from "./types.js";

export type MeshIntegrityStatus = "healthy" | "warning" | "critical";

export interface DeriveClusterConfigInput {
	description: string;
	classification: TaskClassification;
	topology: AgentTopology;
	maxRetries: number;
	isolationMode?: "none" | "worktree" | "docker";
	dockerConfig?: DockerIsolationConfig;
	orchestrationConfig?: OrchestrationConfig;
	integrityStatus?: MeshIntegrityStatus;
}

export interface MeshPolicyDecision extends ClusterConfig {
	reasons: string[];
	escalateToSabha: boolean;
}

export function deriveClusterConfig(input: DeriveClusterConfigInput): MeshPolicyDecision {
	const reasons: string[] = [];
	const meshConfig = input.orchestrationConfig?.mesh;
	const lucyAdaptive = meshConfig?.lucyAdaptiveTopology !== false;
	const scarlettAdaptive = meshConfig?.scarlettAdaptiveTopology !== false;
	const baseline = lucyAdaptive
		? chooseLucyTopology(input.classification.complexity, input.classification.type)
		: (meshConfig?.defaultTopology ?? "hierarchical");
	let topology = baseline;

	if (lucyAdaptive) {
		reasons.push(
			`Lucy selected ${baseline} topology for ${input.classification.complexity}/${input.classification.type}`,
		);
	} else if (meshConfig?.defaultTopology) {
		reasons.push(`Mesh topology pinned to ${meshConfig.defaultTopology} by config`);
	}

	if (scarlettAdaptive) {
		const scarlettTopology = applyScarlettTopologyGuard(topology, input.integrityStatus ?? "healthy");
		if (scarlettTopology !== topology) {
			reasons.push(`Scarlett downgraded topology from ${topology} to ${scarlettTopology}`);
			topology = scarlettTopology;
		}
	}

	const roles = chooseRoles(input.classification.complexity, topology);
	const validationStrategy = chooseValidationStrategy(input.topology, topology);
	const integrityThreshold = meshConfig?.sabhaEscalation?.integrityThreshold ?? "critical";
	const escalateToSabha =
		meshConfig?.sabhaEscalation?.enabled === true &&
		(input.integrityStatus === integrityThreshold ||
			(integrityThreshold === "warning" && input.integrityStatus === "critical"));

	if (escalateToSabha) {
		reasons.push(`Sabha escalation requested because Scarlett integrity is ${input.integrityStatus ?? "healthy"}`);
	}

	return {
		roles,
		topology,
		validationStrategy,
		maxRetries: input.maxRetries,
		taskDescription: input.description,
		isolationMode: input.isolationMode,
		dockerConfig: input.dockerConfig,
		reasons,
		escalateToSabha,
	};
}

export function adaptTopologyAfterRejection(
	current: ClusterTopology,
	validationAttempt: number,
	config?: OrchestrationConfig["mesh"],
): ClusterTopology {
	if (config?.lucyAdaptiveTopology === false) {
		return current;
	}
	if (validationAttempt >= 3) {
		return "healing";
	}
	switch (current) {
		case "hierarchical":
			return validationAttempt >= 1 ? "council" : current;
		case "swarm":
			return validationAttempt >= 1 ? "council" : current;
		case "council":
			return validationAttempt >= 2 ? "adversarial" : current;
		case "adversarial":
			return validationAttempt >= 2 ? "healing" : current;
		default:
			return current;
	}
}

export function shouldEscalateWeakConsensus(
	approvals: number,
	rejections: number,
	validationAttempt: number,
	config?: OrchestrationConfig["mesh"],
): boolean {
	if (config?.sabhaEscalation?.enabled !== true) return false;
	const minAttempts = config.sabhaEscalation.minValidationAttempts ?? 1;
	if (validationAttempt < minAttempts) return false;
	return approvals > 0 && rejections > 0;
}

export function getTopologyGuidance(
	topology: ClusterTopology,
	audience: "planner" | "worker" | "validator" | "fixer",
): string {
	switch (topology) {
		case "council":
			return audience === "validator"
				? "Council mesh: compare your judgment against plausible peer objections, but keep your verdict independent."
				: "Council mesh: optimize for explicit reasoning that other peers can inspect and challenge.";
		case "swarm":
			return audience === "planner"
				? "Swarm mesh: decompose the task into parallelizable fronts and minimize unnecessary coordination."
				: "Swarm mesh: explore broadly, publish concise findings, and avoid premature convergence.";
		case "adversarial":
			return audience === "worker"
				? "Adversarial mesh: assume peers will attack hidden assumptions, so preemptively justify risky moves."
				: "Adversarial mesh: actively search for breakpoints, contradictions, and weak assumptions.";
		case "healing":
			return "Healing mesh: prefer stabilization, smaller moves, explicit verification, and recovery over breadth.";
		case "parallel":
			return "Parallel mesh: keep work streams loosely coupled and summarize results crisply for aggregation.";
		case "sequential":
			return "Sequential mesh: minimize branching and preserve a clear baton-pass between agents.";
		default:
			return "Hierarchical mesh: preserve planner intent, worker execution discipline, and validator independence.";
	}
}

function chooseLucyTopology(complexity: TaskComplexity, type: TaskType): MeshTopologyMode {
	if (complexity === TaskComplexity.CRITICAL || type === TaskType.DEBUG) {
		return "adversarial";
	}
	if (type === TaskType.RESEARCH) {
		return "swarm";
	}
	if (complexity === TaskComplexity.STANDARD || type === TaskType.REFACTOR || type === TaskType.REVIEW) {
		return "council";
	}
	return "hierarchical";
}

function applyScarlettTopologyGuard(topology: MeshTopologyMode, status: MeshIntegrityStatus): MeshTopologyMode {
	if (status === "critical") return "healing";
	if (status !== "warning") return topology;
	switch (topology) {
		case "swarm":
		case "adversarial":
			return "council";
		default:
			return topology;
	}
}

function chooseRoles(complexity: TaskComplexity, topology: MeshTopologyMode): AgentRole[] {
	if (topology === "healing") {
		return [AgentRole.PLANNER, AgentRole.WORKER, AgentRole.VALIDATOR_REQUIREMENTS, AgentRole.VALIDATOR_CODE];
	}
	if (topology === "adversarial" || complexity === TaskComplexity.CRITICAL) {
		return [
			AgentRole.PLANNER,
			AgentRole.WORKER,
			AgentRole.VALIDATOR_CODE,
			AgentRole.VALIDATOR_REQUIREMENTS,
			AgentRole.VALIDATOR_SECURITY,
			AgentRole.VALIDATOR_TESTS,
			AgentRole.VALIDATOR_ADVERSARIAL,
		];
	}
	if (complexity === TaskComplexity.STANDARD || topology === "council" || topology === "swarm") {
		return [AgentRole.PLANNER, AgentRole.WORKER, AgentRole.VALIDATOR_CODE, AgentRole.VALIDATOR_REQUIREMENTS];
	}
	if (complexity === TaskComplexity.SIMPLE) {
		return [AgentRole.WORKER, AgentRole.VALIDATOR_REQUIREMENTS];
	}
	return [AgentRole.WORKER];
}

function chooseValidationStrategy(
	topology: AgentTopology,
	meshTopology: MeshTopologyMode,
): ClusterConfig["validationStrategy"] {
	if (meshTopology === "adversarial" || meshTopology === "healing") {
		return "all_approve";
	}
	return topology.validationStrategy;
}
