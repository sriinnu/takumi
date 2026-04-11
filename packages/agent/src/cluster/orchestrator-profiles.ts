import type { AgentProfileStore, TaskOutcome } from "./agent-identity.js";
import { getRecordedRoleModel, inferRoutingCaps } from "./orchestrator-profile.js";
import type { AgentRole, ClusterState } from "./types.js";

export interface RecordClusterAgentProfilesInput {
	state: ClusterState;
	runStartMs: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	modelOverrides?: Partial<Record<AgentRole, string>>;
	profileStore: AgentProfileStore;
	success: boolean;
}

/** I capture per-agent outcomes for Lucy's topology memory without bloating the orchestrator shell. */
export function recordClusterAgentProfiles(input: RecordClusterAgentProfilesInput): void {
	const { modelOverrides, profileStore, runStartMs, state, success, totalInputTokens, totalOutputTokens } = input;
	const durationMs = Date.now() - runStartMs;
	const taskCaps = inferRoutingCaps(state.config.taskDescription);
	profileStore.recordTopologyOutcome(state.config.topology, success);
	const agentCount = state.agents.size;
	const tokensPerAgent = agentCount > 0 ? Math.round((totalInputTokens + totalOutputTokens) / agentCount) : 0;
	for (const agent of state.agents.values()) {
		const outcome: TaskOutcome = {
			role: agent.role,
			model: getRecordedRoleModel(agent.role, state.config.laneEnvelopes, modelOverrides),
			success,
			capabilities: taskCaps,
			durationMs,
			tokensUsed: tokensPerAgent,
		};
		profileStore.recordOutcome(outcome);
	}
}
