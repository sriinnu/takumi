import type { OrchestrationConfig } from "@takumi/core";
import { describe, expect, it } from "vitest";
import {
	buildClusterCheckpointPolicyMarkers,
	CheckpointManager,
	type ClusterCheckpoint,
	evaluateClusterCheckpointCompatibility,
} from "../src/cluster/checkpoint.js";
import { AgentRole, type ClusterConfig, ClusterPhase, type ClusterState } from "../src/cluster/types.js";

function makeConfig(): ClusterConfig {
	return {
		roles: [AgentRole.PLANNER, AgentRole.WORKER],
		topology: "hierarchical",
		validationStrategy: "majority",
		maxRetries: 2,
		taskDescription: "Patch the runtime constitution",
	};
}

function makeOrchestrationConfig(): OrchestrationConfig {
	return {
		enabled: true,
		defaultMode: "multi",
		complexityThreshold: "standard",
		maxValidationRetries: 2,
		mesh: {
			defaultTopology: "hierarchical",
			lucyAdaptiveTopology: true,
			scarlettAdaptiveTopology: true,
		},
	} satisfies OrchestrationConfig;
}

describe("cluster checkpoint compatibility", () => {
	it("persists policy markers when checkpointing cluster state", () => {
		const config = makeConfig();
		const orchestrationConfig = makeOrchestrationConfig();
		const state: ClusterState = {
			id: "cluster-1",
			config,
			phase: ClusterPhase.PLANNING,
			agents: new Map(),
			validationAttempt: 0,
			plan: null,
			workProduct: null,
			validationResults: [],
			finalDecision: null,
			createdAt: 1,
			updatedAt: 2,
		};
		const checkpoint = CheckpointManager.fromState(state, orchestrationConfig);

		expect(checkpoint.policyMarkers).toEqual(buildClusterCheckpointPolicyMarkers(config, orchestrationConfig));
	});

	it("blocks resume when route policy markers drift", () => {
		const config = makeConfig();
		const savedConfig = makeOrchestrationConfig();
		const driftedConfig = {
			...savedConfig,
			mesh: {
				...savedConfig.mesh,
				defaultTopology: "swarm",
			},
		} satisfies OrchestrationConfig;
		const checkpoint: ClusterCheckpoint = {
			version: 1,
			clusterId: "cluster-2",
			phase: ClusterPhase.EXECUTING,
			config,
			validationAttempt: 1,
			plan: "do the thing",
			workProduct: null,
			validationResults: [],
			finalDecision: null,
			policyMarkers: buildClusterCheckpointPolicyMarkers(config, savedConfig),
			savedAt: Date.now(),
		};

		const result = evaluateClusterCheckpointCompatibility(checkpoint, driftedConfig);

		expect(result.ok).toBe(false);
		expect(result.blocking).toBe(true);
		expect(result.conflicts.map((conflict) => conflict.kind)).toContain("route_policy_mismatch");
		expect(result.summary).toContain("Checkpoint compatibility blocked resume for cluster-2");
	});

	it("warns when legacy checkpoint markers cannot fully validate the new default topology", () => {
		const config = makeConfig();
		const savedConfig = makeOrchestrationConfig();
		const checkpoint: ClusterCheckpoint = {
			version: 1,
			clusterId: "cluster-3",
			phase: ClusterPhase.PLANNING,
			config,
			validationAttempt: 0,
			plan: null,
			workProduct: null,
			validationResults: [],
			finalDecision: null,
			policyMarkers: {
				...buildClusterCheckpointPolicyMarkers(config, savedConfig),
				routePolicyHash: null,
				safetyPolicyHash: null,
			},
			savedAt: Date.now(),
		};

		const result = evaluateClusterCheckpointCompatibility(checkpoint, {
			...savedConfig,
			mesh: {
				...savedConfig.mesh,
				defaultTopology: "swarm",
				lucyAdaptiveTopology: false,
				scarlettAdaptiveTopology: false,
			},
			modelRouting: savedConfig.modelRouting,
		});

		expect(result.ok).toBe(true);
		expect(result.blocking).toBe(false);
		expect(result.warnings).toContain("Checkpoint topology hierarchical differs from the current default swarm.");
		expect(result.warnings).toContain(
			"Checkpoint policy markers are incomplete; route/safety drift validation is partial.",
		);
	});
});
