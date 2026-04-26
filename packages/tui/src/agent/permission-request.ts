/**
 * Shape of an in-flight tool-permission request.
 *
 * Lives in its own file so both `AppState` (which holds the visible card +
 * waiting queue as signals) and `requestToolPermission` (which produces them)
 * can import without pulling in either's transitive dependencies.
 */

import type { PermissionDecision } from "@takumi/core";

/** A single permission request rendered inline as a card in the message list. */
export interface PendingPermissionRequest {
	/** Stable id minted by the disk approval queue — required so the operator's
	 *  decision can round-trip back to persistence and to remote approvers. */
	approvalId: string;
	tool: string;
	args: Record<string, unknown>;
	resolve: (decision: PermissionDecision) => void;
}
