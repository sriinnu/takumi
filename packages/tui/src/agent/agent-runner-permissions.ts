import type { Message, PermissionDecision } from "@takumi/core";
import { createLogger } from "@takumi/core";
import type { AppState } from "../state.js";
import type { PendingPermissionRequest } from "./permission-request.js";

const log = createLogger("agent-runner-permissions");

/**
 * Hard cap on the in-memory permission queue. A jailbroken or pathological
 * agent that fires `requestToolPermission` in a tight loop would otherwise
 * grow `state.pendingPermissionQueue` without bound. Past this watermark
 * we deny new requests outright (and mark them denied on disk) so the
 * operator's UI stays responsive.
 */
const PERMISSION_QUEUE_CAP = 100;

/**
 * Queue a permission request and resolve once the operator makes a decision.
 *
 * If a card is already visible (`state.pendingPermission` is set), the new
 * request goes onto `state.pendingPermissionQueue` instead of overwriting
 * the visible slot — that overwrite was the original "two tools fired in a
 * row, the first one's promise never resolved" bug. The input handler
 * promotes the head of the queue when the visible card is decided.
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
				const request: PendingPermissionRequest = {
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
				// Permission cards render inline in the message list now —
				// don't push "permission" onto the dialog stack. The dialog-
				// overlay's dim layer keys off `state.topDialog`, so pushing
				// here would re-trigger the gray-screen / frozen-chat bug
				// the in-stream redesign was meant to kill.
				if (state.pendingPermission.value === null) {
					state.pendingPermission.value = request;
				} else if (state.pendingPermissionQueue.value.length >= PERMISSION_QUEUE_CAP) {
					// Queue is saturated — reject the new request rather than leaking
					// memory. The disk approval is closed denied so it doesn't linger.
					// We log + push a transcript message so the operator can see why
					// the agent suddenly stopped acting; otherwise the denial is
					// completely silent from the operator's POV.
					log.warn(`Permission queue full (${PERMISSION_QUEUE_CAP} pending) — denying ${tool}`);
					void state.approvalQueue.decide(approval.id, "denied", "user", "permission queue full");
					pushQueueFullNotice(state, tool);
					resolve({ allowed: false, reason: `permission queue full (${PERMISSION_QUEUE_CAP} pending)` });
				} else {
					state.pendingPermissionQueue.value = [...state.pendingPermissionQueue.value, request];
				}
			} catch (err) {
				log.error("Permission request failed, denying by default", err);
				resolve({ allowed: false, reason: `Permission request failed: ${(err as Error).message}` });
			}
		})();
	});
}

/**
 * Push a single transcript line so the operator knows the queue is saturated.
 * Without this the agent goes quiet (every new request auto-denies) and the
 * operator has no idea what's happening.
 */
function pushQueueFullNotice(state: AppState, tool: string): void {
	const message: Message = {
		id: `queue-full-${Date.now()}`,
		role: "assistant",
		content: [
			{
				type: "text",
				text: `permission queue full (${PERMISSION_QUEUE_CAP} pending) — auto-denied ${tool}. Resolve some pending cards to drain the queue.`,
			},
		],
		timestamp: Date.now(),
	};
	state.messages.value = [...state.messages.value, message];
}
