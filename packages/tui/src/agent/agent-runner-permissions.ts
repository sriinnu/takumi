import type { PermissionDecision } from "@takumi/core";
import { createLogger } from "@takumi/core";
import type { AppState } from "../state.js";

const log = createLogger("agent-runner-permissions");

/**
 * Queue a permission request and resolve once the operator makes a decision.
 *
 * If the approval-queue disk write fails, we resolve with `allowed: false` so
 * the agent loop can continue instead of hanging on an unresolvable Promise.
 */
export function requestToolPermission(
	state: AppState,
	tool: string,
	args: Record<string, unknown>,
): Promise<PermissionDecision> {
	return new Promise<PermissionDecision>((resolve) => {
		void (async () => {
			try {
				// Keep the dialog payload compact so the permission modal stays readable.
				const argsSummary = JSON.stringify(args).slice(0, 500);
				const approval = await state.approvalQueue.request(tool, argsSummary, state.sessionId.value || undefined);
				state.pendingPermission.value = {
					approvalId: approval.id,
					tool,
					args,
					resolve: (decision) => {
						void state.approvalQueue.decide(
							approval.id,
							decision.allowed ? "approved" : "denied",
							"user",
							decision.reason,
						);
						resolve(decision);
					},
				};
				state.pushDialog("permission");
			} catch (err) {
				log.error("Permission request failed, denying by default", err);
				resolve({ allowed: false, reason: `Permission request failed: ${(err as Error).message}` });
			}
		})();
	});
}
