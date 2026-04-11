import type { ClusterOrchestrator } from "@takumi/agent";
import type { AppState, ClusterCommandEvent } from "../state.js";

interface ClusterCommandDeps {
	orchestrator: ClusterOrchestrator | null;
	state: AppState;
	isActive: () => boolean;
	resume: (taskId: string) => Promise<void>;
	addSystemMessage: (text: string) => void;
}

/** Handle a ClusterCommandEvent dispatched by slash commands/dialogs. */
export async function handleClusterCommand(deps: ClusterCommandDeps, cmd: ClusterCommandEvent): Promise<void> {
	switch (cmd.type) {
		case "validate": {
			if (!deps.orchestrator) {
				deps.addSystemMessage("Orchestration is not enabled — cannot re-validate.");
				return;
			}
			if (!deps.isActive()) {
				deps.addSystemMessage("No active coding task to validate.");
				return;
			}
			deps.addSystemMessage("Re-running validation phase...");
			break;
		}
		case "retry": {
			if (!deps.isActive()) {
				deps.addSystemMessage("No active coding task to retry.");
				return;
			}
			const max = cmd.maxAttempts;
			deps.addSystemMessage(
				`Retry requested${max ? ` (max ${max} additional attempts)` : ""}. The cluster will pick this up on its next fixing phase.`,
			);
			break;
		}
		case "checkpoint_save": {
			const clusterState = deps.orchestrator?.getState?.();
			if (!clusterState) {
				deps.addSystemMessage("No active cluster state to checkpoint.");
				return;
			}
			try {
				const { CheckpointManager } = await import("@takumi/agent");
				const mgr = new CheckpointManager({
					chitragupta: deps.state.chitraguptaBridge.value ?? undefined,
				});
				await mgr.save(CheckpointManager.fromState(clusterState));
				deps.addSystemMessage(`Checkpoint saved: ${clusterState.id} @ ${clusterState.phase}`);
			} catch (err) {
				deps.addSystemMessage(`Checkpoint save failed: ${(err as Error).message}`);
			}
			break;
		}
		case "resume": {
			await deps.resume(cmd.taskId);
			break;
		}
		case "isolation_set": {
			deps.addSystemMessage(`Isolation mode updated to: ${cmd.mode} (applies to next cluster run).`);
			break;
		}
	}
}
