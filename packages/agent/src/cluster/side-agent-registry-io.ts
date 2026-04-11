import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SideAgentDispatchKind, SideAgentInfo, SideAgentState } from "@takumi/core";

export const DEFAULT_SIDE_AGENT_REGISTRY_DIR = ".takumi/side-agents";
export const SIDE_AGENT_REGISTRY_FILENAME = "registry.json";

export type PersistedSideAgentReason =
	| "invalid_shape"
	| "missing_id"
	| "missing_description"
	| "missing_model"
	| "missing_branch"
	| "missing_started_at"
	| "missing_updated_at"
	| "invalid_state"
	| "incomplete_live_metadata"
	| "duplicate_id";

/**
 * I preserve the raw persisted view of one side-agent row so diagnostics can
 * distinguish on-disk truth from the normalized runtime copy.
 */
export interface PersistedSideAgentRecord {
	rawId: string | null;
	rawState: string | null;
	normalizedState: SideAgentState | null;
	retained: boolean;
	dirty: boolean;
	incompleteLive: boolean;
	reasons: PersistedSideAgentReason[];
	agent: SideAgentInfo | null;
}

export interface LoadedAgentResult {
	agent: SideAgentInfo | null;
	dirty: boolean;
	incompleteLive: boolean;
	record: PersistedSideAgentRecord;
}

/**
 * I expose a read-only snapshot of the persisted side-agent registry so doctor
 * and platform watch can audit drift without mutating runtime state.
 */
export interface SideAgentRegistrySnapshot {
	registryPath: string;
	totalEntries: number;
	normalizedEntries: number;
	malformedEntries: number;
	readError?: string;
	parseError?: string;
	records: PersistedSideAgentRecord[];
	agents: SideAgentInfo[];
}

const TERMINAL_STATES: ReadonlySet<SideAgentState> = new Set(["stopped", "done", "failed", "crashed"]);
const SIDE_AGENT_STATES: ReadonlySet<SideAgentState> = new Set([
	"allocating_worktree",
	"spawning_tmux",
	"starting",
	"running",
	"waiting_user",
	"finishing",
	"waiting_merge_lock",
	"retrying_reconcile",
	"stopped",
	"done",
	"failed",
	"crashed",
]);

export function resolveSideAgentRegistryPath(baseDir = DEFAULT_SIDE_AGENT_REGISTRY_DIR): string {
	return join(baseDir, SIDE_AGENT_REGISTRY_FILENAME);
}

export async function inspectPersistedSideAgentRegistry(
	baseDir = DEFAULT_SIDE_AGENT_REGISTRY_DIR,
): Promise<SideAgentRegistrySnapshot> {
	const registryPath = resolveSideAgentRegistryPath(baseDir);
	let raw: string;
	try {
		raw = await readFile(registryPath, "utf-8");
	} catch (error) {
		const code = typeof error === "object" && error && "code" in error ? String(error.code) : null;
		if (code === "ENOENT") {
			return { registryPath, totalEntries: 0, normalizedEntries: 0, malformedEntries: 0, records: [], agents: [] };
		}
		return {
			registryPath,
			totalEntries: 0,
			normalizedEntries: 0,
			malformedEntries: 0,
			readError: error instanceof Error ? error.message : String(error),
			records: [],
			agents: [],
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		return {
			registryPath,
			totalEntries: 0,
			normalizedEntries: 0,
			malformedEntries: 0,
			parseError: error instanceof Error ? error.message : String(error),
			records: [],
			agents: [],
		};
	}

	if (!Array.isArray(parsed)) {
		return {
			registryPath,
			totalEntries: 0,
			normalizedEntries: 0,
			malformedEntries: 0,
			parseError: "Persisted registry root was not an array.",
			records: [],
			agents: [],
		};
	}

	const seenIds = new Set<string>();
	const agents: SideAgentInfo[] = [];
	const records: PersistedSideAgentRecord[] = [];
	let normalizedEntries = 0;
	let malformedEntries = 0;
	for (const entry of parsed) {
		const normalized = normalizeLoadedAgent(entry);
		if (!normalized.agent) {
			malformedEntries += 1;
			records.push(normalized.record);
			continue;
		}
		if (seenIds.has(normalized.agent.id)) {
			malformedEntries += 1;
			records.push(markDuplicateRecord(normalized.record));
			continue;
		}
		if (normalized.dirty) normalizedEntries += 1;
		seenIds.add(normalized.agent.id);
		records.push({ ...normalized.record, retained: true });
		agents.push(normalized.agent);
	}

	return {
		registryPath,
		totalEntries: parsed.length,
		normalizedEntries,
		malformedEntries,
		records,
		agents,
	};
}

export function normalizeLoadedAgent(value: unknown): LoadedAgentResult {
	const rawState = isRecord(value) ? readRequiredString(value.state) : null;
	if (!isRecord(value)) {
		return buildRejectedResult(null, rawState, "invalid_shape");
	}

	const id = readRequiredString(value.id);
	if (!id) {
		return buildRejectedResult(null, rawState, "missing_id");
	}

	let dirty = false;
	let incompleteLive = false;
	const reasons: PersistedSideAgentReason[] = [];
	const description =
		readOptionalString(value.description) ?? markDirty(`Recovered side agent ${id}`, "missing_description");
	const model = readOptionalString(value.model) ?? markDirty("unknown", "missing_model");
	const branch = readOptionalString(value.branch) ?? markDirty(`takumi/side-agent/${id}`, "missing_branch");
	const slotId = readNullableString(value.slotId);
	const worktreePath = readNullableString(value.worktreePath);
	const tmuxWindow = readNullableString(value.tmuxWindow);
	const tmuxSessionName = readNullableString(value.tmuxSessionName);
	const tmuxWindowId = readNullableString(value.tmuxWindowId);
	const tmuxPaneId = readNullableString(value.tmuxPaneId);
	const pid = readNullableNumber(value.pid);
	const dispatchSequence = readOptionalInteger(value.dispatchSequence);
	const reuseCount = readOptionalInteger(value.reuseCount);
	const leaseOwner = readNullableString(value.leaseOwner);
	const leaseExpiresAt = readNullableNumber(value.leaseExpiresAt);
	const lastHeartbeatAt = readNullableNumber(value.lastHeartbeatAt);
	const lastDispatchAt = readNullableNumber(value.lastDispatchAt);
	const lastDispatchKind = readNullableDispatchKind(value.lastDispatchKind);
	const lastRunStartedAt = readNullableNumber(value.lastRunStartedAt);
	const lastRunFinishedAt = readNullableNumber(value.lastRunFinishedAt);
	const lastRunExitCode = readNullableInteger(value.lastRunExitCode);
	const lastRunRequestId = readNullableString(value.lastRunRequestId);
	const startedAt = readFiniteNumber(value.startedAt) ?? markDirty(Date.now(), "missing_started_at");
	const updatedAt = readFiniteNumber(value.updatedAt) ?? markDirty(startedAt, "missing_updated_at");
	let error = readOptionalString(value.error);
	let state: SideAgentState = "failed";

	if (rawState && SIDE_AGENT_STATES.has(rawState as SideAgentState)) {
		state = rawState as SideAgentState;
	} else {
		dirty = true;
		reasons.push("invalid_state");
		error = appendLoadError(error, `Persisted side-agent entry had invalid state "${rawState ?? "<missing>"}".`);
	}

	const hasRecoverableWorktree = Boolean(worktreePath && (slotId || deriveSlotId(worktreePath)));
	const hasRecoverableTmux = Boolean(tmuxWindow || tmuxWindowId || tmuxPaneId);
	if (!TERMINAL_STATES.has(state) && (!hasRecoverableWorktree || !hasRecoverableTmux)) {
		dirty = true;
		incompleteLive = true;
		reasons.push("incomplete_live_metadata");
		state = "failed";
		error = appendLoadError(error, "Persisted side-agent entry was incomplete and could not be recovered safely.");
	}

	const agent: SideAgentInfo = {
		id,
		description,
		state,
		model,
		slotId,
		worktreePath,
		tmuxWindow,
		tmuxSessionName,
		tmuxWindowId,
		tmuxPaneId,
		branch,
		pid,
		startedAt,
		updatedAt,
		error,
		dispatchSequence,
		reuseCount,
		leaseOwner,
		leaseExpiresAt,
		lastHeartbeatAt,
		lastDispatchAt,
		lastDispatchKind,
		lastRunStartedAt,
		lastRunFinishedAt,
		lastRunExitCode,
		lastRunRequestId,
	};
	return {
		agent,
		dirty,
		incompleteLive,
		record: {
			rawId: id,
			rawState,
			normalizedState: state,
			retained: true,
			dirty,
			incompleteLive,
			reasons,
			agent,
		},
	};

	function markDirty<T>(fallback: T, reason: PersistedSideAgentReason): T {
		dirty = true;
		reasons.push(reason);
		return fallback;
	}
}

export function extractCounterValue(value: unknown): number {
	if (!isRecord(value)) {
		return 0;
	}
	const id = readRequiredString(value.id);
	if (!id) {
		return 0;
	}
	const number = Number.parseInt(id.replace(/^side-/, ""), 10);
	return Number.isNaN(number) ? 0 : number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readRequiredString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNullableString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readFiniteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNullableNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNullableInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function readOptionalInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function readNullableDispatchKind(value: unknown): SideAgentDispatchKind | null {
	return value === "start" || value === "send" || value === "query" ? value : null;
}

function appendLoadError(existing: string | undefined, message: string): string {
	return existing?.trim() ? `${existing} ${message}` : message;
}

function deriveSlotId(worktreePath: string | null): string | null {
	if (!worktreePath) {
		return null;
	}
	const match = /(?:^|[\\/])(wt-\d+)$/.exec(worktreePath.trim());
	return match?.[1] ?? null;
}

function buildRejectedResult(
	rawId: string | null,
	rawState: string | null,
	reason: PersistedSideAgentReason,
): LoadedAgentResult {
	return {
		agent: null,
		dirty: true,
		incompleteLive: false,
		record: {
			rawId,
			rawState,
			normalizedState: null,
			retained: false,
			dirty: true,
			incompleteLive: false,
			reasons: [reason],
			agent: null,
		},
	};
}

function markDuplicateRecord(record: PersistedSideAgentRecord): PersistedSideAgentRecord {
	return {
		...record,
		retained: false,
		reasons: record.reasons.includes("duplicate_id") ? record.reasons : [...record.reasons, "duplicate_id"],
	};
}
