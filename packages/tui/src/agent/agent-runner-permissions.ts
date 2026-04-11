import type { PermissionDecision } from "@takumi/core";
import type { AppState } from "../state.js";

/**
 * Queue a permission request and resolve once the operator makes a decision.
 */
export function requestToolPermission(
	state: AppState,
	tool: string,
	args: Record<string, unknown>,
): Promise<PermissionDecision> {
	return new Promise<PermissionDecision>((resolve) => {
		void (async () => {
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
		})();
	});
}
