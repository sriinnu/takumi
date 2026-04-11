import type { SessionControlPlaneLanePolicyState, SessionControlPlaneLaneState } from "@takumi/core";
import { normalizeProviderName } from "@takumi/core";

export type ReplayValidationConflictKind =
	| "route_intent_mismatch"
	| "provider_mismatch"
	| "model_mismatch"
	| "policy_hash_mismatch"
	| "policy_version_mismatch";

export interface ReplayValidationConflict {
	kind: ReplayValidationConflictKind;
	expected: string;
	actual: string;
}

export interface ReplayValidationInput {
	canonicalSessionId: string | null;
	pendingLocalTurns: number;
	sessionModel: string | null;
	currentProvider: string | null;
	storedLanes: SessionControlPlaneLaneState[];
	refreshedLanes: SessionControlPlaneLaneState[];
}

export interface ReplayValidationResult {
	ok: boolean;
	blocking: boolean;
	warnings: string[];
	conflicts: ReplayValidationConflict[];
	summary: string | null;
}

export function findPrimaryControlPlaneLane(
	lanes: SessionControlPlaneLaneState[] | undefined,
): SessionControlPlaneLaneState | null {
	if (!lanes || lanes.length === 0) return null;
	return (
		lanes.find((lane) => lane.role === "primary" || lane.key === "primary") ??
		lanes.find((lane) => lane.role === "session" || lane.key === "session") ??
		lanes[0] ??
		null
	);
}

export function validateReplayBeforeCanonicalImport(input: ReplayValidationInput): ReplayValidationResult {
	if (!input.canonicalSessionId) {
		return {
			ok: true,
			blocking: false,
			warnings: ["No canonical session bound yet; replay validation skipped."],
			conflicts: [],
			summary: null,
		};
	}

	const warnings: string[] = [];
	const conflicts: ReplayValidationConflict[] = [];
	const storedPrimary = findPrimaryControlPlaneLane(input.storedLanes);
	const refreshedPrimary = findPrimaryControlPlaneLane(input.refreshedLanes);
	if (!storedPrimary) {
		warnings.push("Stored control-plane lane snapshot missing; validating with limited session metadata.");
	}
	if (!refreshedPrimary) {
		warnings.push("Authoritative daemon lane snapshot unavailable; replay validation is incomplete.");
		return finishValidation(input, warnings, conflicts);
	}

	const expectedCapability = storedPrimary?.capability ?? null;
	const actualCapability = refreshedPrimary.capability ?? null;
	if (expectedCapability && actualCapability && expectedCapability !== actualCapability) {
		conflicts.push({ kind: "route_intent_mismatch", expected: expectedCapability, actual: actualCapability });
	}

	const expectedProvider = normalizeProviderName(storedPrimary?.provider ?? input.currentProvider ?? undefined) ?? null;
	const actualProvider = normalizeProviderName(refreshedPrimary.provider ?? undefined) ?? null;
	if (expectedProvider && actualProvider && expectedProvider !== actualProvider) {
		conflicts.push({ kind: "provider_mismatch", expected: expectedProvider, actual: actualProvider });
	}

	const expectedModel = storedPrimary?.model ?? input.sessionModel ?? null;
	const actualModel = refreshedPrimary.model ?? null;
	if (expectedModel && actualModel && expectedModel !== actualModel) {
		conflicts.push({ kind: "model_mismatch", expected: expectedModel, actual: actualModel });
	}

	const expectedPolicyHash = storedPrimary?.policyHash ?? null;
	const actualPolicyHash = refreshedPrimary.policyHash ?? null;
	if (expectedPolicyHash && actualPolicyHash && expectedPolicyHash !== actualPolicyHash) {
		conflicts.push({ kind: "policy_hash_mismatch", expected: expectedPolicyHash, actual: actualPolicyHash });
	}

	const expectedPolicyVersion = readPolicyVersion(storedPrimary);
	const actualPolicyVersion = readPolicyVersion(refreshedPrimary);
	if (expectedPolicyVersion !== null && actualPolicyVersion !== null && expectedPolicyVersion !== actualPolicyVersion) {
		conflicts.push({
			kind: "policy_version_mismatch",
			expected: String(expectedPolicyVersion),
			actual: String(actualPolicyVersion),
		});
	}

	if (expectedPolicyVersion === null || actualPolicyVersion === null) {
		warnings.push("Policy contractVersion markers are incomplete; policy-era validation is partial.");
	}

	return finishValidation(input, warnings, conflicts);
}

export function formatReplayValidationConflict(conflict: ReplayValidationConflict): string {
	switch (conflict.kind) {
		case "route_intent_mismatch":
			return `route intent mismatch (${conflict.expected} ≠ ${conflict.actual})`;
		case "provider_mismatch":
			return `provider mismatch (${conflict.expected} ≠ ${conflict.actual})`;
		case "model_mismatch":
			return `model mismatch (${conflict.expected} ≠ ${conflict.actual})`;
		case "policy_hash_mismatch":
			return `policy hash mismatch (${conflict.expected} ≠ ${conflict.actual})`;
		case "policy_version_mismatch":
			return `policy version mismatch (${conflict.expected} ≠ ${conflict.actual})`;
	}
}

function finishValidation(
	input: ReplayValidationInput,
	warnings: string[],
	conflicts: ReplayValidationConflict[],
): ReplayValidationResult {
	const blocking = conflicts.length > 0 && input.pendingLocalTurns > 0;
	const ok = conflicts.length === 0;
	return {
		ok,
		blocking,
		warnings,
		conflicts,
		summary: buildValidationSummary(input.canonicalSessionId ?? null, input.pendingLocalTurns, conflicts, blocking),
	};
}

function buildValidationSummary(
	canonicalSessionId: string | null,
	pendingLocalTurns: number,
	conflicts: ReplayValidationConflict[],
	blocking: boolean,
): string | null {
	if (conflicts.length === 0) return null;
	const sessionLabel = canonicalSessionId ?? "(unbound)";
	const prefix = blocking
		? `Replay validation blocked canonical rebind for ${sessionLabel}`
		: `Replay validation found compatibility drift for ${sessionLabel}`;
	const suffix = blocking ? ` while ${pendingLocalTurns} local turn(s) were pending` : "";
	return `${prefix}${suffix}: ${conflicts.map((conflict) => formatReplayValidationConflict(conflict)).join("; ")}`;
}

function readPolicyVersion(lane: SessionControlPlaneLaneState | null): number | null {
	if (!lane) return null;
	return (
		readPolicyContractVersion(lane.policy) ??
		readPolicyContractVersion(lane.requestedPolicy) ??
		readPolicyContractVersion(lane.effectivePolicy)
	);
}

function readPolicyContractVersion(policy: SessionControlPlaneLanePolicyState | undefined): number | null {
	const contractVersion = (policy as { contractVersion?: number | null } | undefined)?.contractVersion;
	return typeof contractVersion === "number" ? contractVersion : null;
}
