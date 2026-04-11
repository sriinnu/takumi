/**
 * Side-agent runtime helpers.
 *
 * I keep the failure-handling and structured-query helpers here so the public
 * tool surface stays readable while the runtime contracts remain explicit.
 */

import type { SideAgentDispatchKind, SideAgentInfo, SideAgentState } from "@takumi/core";
import type { Orchestrator } from "../cluster/orchestrator-factory.js";
import type { SideAgentRegistry } from "../cluster/side-agent-registry.js";
import type { WorktreePoolManager } from "../cluster/worktree-pool.js";
import {
	buildSideAgentDispatchEnvelope,
	findSideAgentReadyMarker,
	type SideAgentDispatchEnvelope,
	summarizeSideAgentRuns,
} from "./side-agent-worker-protocol.js";

export const WINDOW_MISSING_REASON = "Side-agent tmux window is no longer alive.";
export const SIDE_AGENT_LEASE_OWNER = "takumi-side-agent";
export const SIDE_AGENT_LEASE_TTL_MS = 15 * 60_000;

const PRE_TMUX_WINDOW_STATES: ReadonlySet<SideAgentState> = new Set(["allocating_worktree", "spawning_tmux"]);
const READY_POLL_MS = 100;
const READY_TIMEOUT_MS = 10_000;

export interface FailedStartCleanupResult {
	removedFromRegistry: boolean;
	tmuxCleared: boolean;
	worktreeCleared: boolean;
	cleanupErrors: string[];
}

export function buildStructuredQueryPrompt(query: string, format: string, requestId: string): string {
	return (
		`[STRUCTURED_QUERY id=${requestId} format=${format}]\n${query}\n[/STRUCTURED_QUERY]\n` +
		`Respond with exactly one block using this envelope:\n` +
		`[STRUCTURED_QUERY_RESPONSE id=${requestId}]\n\`\`\`json\n{"requestId":"${requestId}"}\n\`\`\`\n[/STRUCTURED_QUERY_RESPONSE]`
	);
}

export function buildInitialSideAgentPrompt(description: string, initialPrompt?: string): string {
	return [
		`Primary task: ${description.trim()}`,
		initialPrompt?.trim() || null,
		"Work only inside your assigned worktree. Leave concrete findings, edits, or next steps that a follow-up lane query can inspect.",
	]
		.filter((part): part is string => typeof part === "string" && part.length > 0)
		.join("\n\n");
}

/**
 * I launch the worker from the repository root using pre-compiled JS instead of
 * tsx to avoid the ~500 ms JIT penalty on every side-agent spawn. Falls back to
 * tsx when the compiled worker doesn't exist (dev mode).
 */
export function buildSideAgentWorkerLaunchCommand(input: {
	id: string;
	model: string;
	repoRoot: string;
	worktreePath: string;
}): string {
	const args = [
		`--id ${shellQuote(input.id)}`,
		`--model ${shellQuote(input.model)}`,
		`--worktree ${shellQuote(input.worktreePath)}`,
	].join(" ");
	return [
		`cd ${shellQuote(input.repoRoot)} &&`,
		`if [ -f dist-bin/cli/side-agent-worker.js ]; then`,
		`node dist-bin/cli/side-agent-worker.js ${args};`,
		`else pnpm exec tsx --tsconfig tsconfig.dev.json bin/cli/side-agent-worker.ts ${args}; fi`,
	].join(" ");
}

/**
 * I wait for the worker to print its ready marker. If the orchestrator supports
 * tmux channels (`waitForChannel`), I use an event-driven wait instead of the
 * hot polling loop — one fork instead of ~100 capture-pane forks over 10 s.
 */
export async function waitForSideAgentReady(input: {
	id: string;
	tmux: Orchestrator;
	timeoutMs?: number;
}): Promise<void> {
	const timeoutMs = input.timeoutMs ?? READY_TIMEOUT_MS;

	if (input.tmux.waitForChannel) {
		const signaled = await input.tmux.waitForChannel(`takumi-ready-${input.id}`, timeoutMs);
		if (signaled) return;
		// Paranoid fallback: signal may have fired just before we started waiting.
		// One capture-pane check closes the race window completely.
		try {
			const output = await input.tmux.captureOutput(input.id, 80);
			if (findSideAgentReadyMarker(output, input.id)) return;
		} catch {
			/* Worker may have died — fall through to throw. */
		}
		throw new Error(`Side-agent worker for "${input.id}" did not report ready state within ${timeoutMs}ms.`);
	}

	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		try {
			const output = await input.tmux.captureOutput(input.id, 80);
			if (findSideAgentReadyMarker(output, input.id)) {
				return;
			}
		} catch {
			// Worker may still be starting. Keep polling until timeout.
		}
		await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
	}
	throw new Error(`Side-agent worker for "${input.id}" did not report ready state within ${timeoutMs}ms.`);
}

export async function dispatchSideAgentWork(input: {
	id: string;
	kind: SideAgentDispatchKind;
	prompt: string;
	agents: SideAgentRegistry;
	tmux: Orchestrator;
	requestId?: string | null;
	format?: string | null;
}): Promise<{ sequence: number; dispatchedAt: number }> {
	const agent = input.agents.get(input.id);
	if (!agent) {
		throw new Error(`Side agent "${input.id}" not found`);
	}
	const sequence = (agent.dispatchSequence ?? 0) + 1;
	const dispatchedAt = Date.now();
	const envelope: SideAgentDispatchEnvelope = {
		id: input.id,
		seq: sequence,
		kind: input.kind,
		requestId: input.requestId ?? null,
		format: input.format ?? null,
		prompt: input.prompt,
	};
	await input.tmux.sendKeys(input.id, buildSideAgentDispatchEnvelope(envelope));
	input.agents.update(input.id, {
		dispatchSequence: sequence,
		reuseCount: Math.max(agent.reuseCount ?? 0, sequence - 1),
		leaseOwner: SIDE_AGENT_LEASE_OWNER,
		leaseExpiresAt: dispatchedAt + SIDE_AGENT_LEASE_TTL_MS,
		lastHeartbeatAt: dispatchedAt,
		lastDispatchAt: dispatchedAt,
		lastDispatchKind: input.kind,
		lastRunRequestId: input.requestId ?? null,
	});
	if (agent.state !== "running") {
		input.agents.transition(input.id, "running");
	}
	return { sequence, dispatchedAt };
}

/**
 * I reconcile the lane registry from worker markers printed in the pane so the
 * durable lane state survives queued runs and process restarts.
 */
export function syncSideAgentRuntimeFromOutput(input: {
	current: SideAgentInfo;
	agents: SideAgentRegistry;
	output: string;
}): SideAgentInfo {
	const summary = summarizeSideAgentRuns(input.output, input.current.id);
	const now = Date.now();
	if (summary.latestSequence === 0) {
		return input.agents.update(input.current.id, {
			leaseOwner: SIDE_AGENT_LEASE_OWNER,
			leaseExpiresAt: now + SIDE_AGENT_LEASE_TTL_MS,
			lastHeartbeatAt: now,
		});
	}
	const nextState =
		summary.busy || (input.current.state === "starting" && summary.latestSequence > 0) ? "running" : "waiting_user";
	const nextError =
		summary.lastCompleted && summary.lastCompleted.code !== null && summary.lastCompleted.code !== 0
			? `Last side-agent run exited with code ${summary.lastCompleted.code}.`
			: undefined;

	if (input.current.state !== nextState && !isTerminalState(input.current.state)) {
		input.agents.transition(input.current.id, nextState, nextError);
	}

	return input.agents.update(input.current.id, {
		leaseOwner: SIDE_AGENT_LEASE_OWNER,
		leaseExpiresAt: now + SIDE_AGENT_LEASE_TTL_MS,
		lastHeartbeatAt: now,
		lastRunStartedAt: summary.latestBegin?.ts ?? input.current.lastRunStartedAt ?? null,
		lastRunFinishedAt: summary.lastCompleted?.ts ?? input.current.lastRunFinishedAt ?? null,
		lastRunExitCode: summary.lastCompleted?.code ?? input.current.lastRunExitCode ?? null,
		lastRunRequestId:
			summary.lastCompleted?.requestId ?? summary.latestBegin?.requestId ?? input.current.lastRunRequestId ?? null,
		error: nextError,
	});
}

export function extractStructuredQueryResponse(output: string, requestId: string): unknown | null {
	const pattern =
		"\\[STRUCTURED_QUERY_RESPONSE id=" +
		escapeRegExp(requestId) +
		"\\][\\s\\S]*?```json\\s*([\\s\\S]*?)```[\\s\\S]*?\\[/STRUCTURED_QUERY_RESPONSE\\]";
	const matcher = new RegExp(pattern, "g");
	const matches = [...output.matchAll(matcher)];
	const payload = matches.at(-1)?.[1]?.trim();
	if (!payload) {
		return null;
	}

	const parsed = JSON.parse(payload) as { requestId?: unknown };
	if (parsed.requestId !== requestId) {
		return null;
	}
	return parsed;
}

/**
 * Tear down partially-started side-agent resources so failed starts do not
 * leak worktree capacity or ghost registry entries.
 */
export async function rollbackFailedStart(options: {
	id: string;
	slotId: string | null;
	agents: SideAgentRegistry;
	pool: WorktreePoolManager;
	tmux: Orchestrator;
}): Promise<FailedStartCleanupResult> {
	const cleanupErrors: string[] = [];
	let tmuxCleared = true;

	try {
		if (await options.tmux.isWindowAlive(options.id)) {
			await options.tmux.killWindow(options.id);
		}
	} catch (error) {
		tmuxCleared = false;
		cleanupErrors.push(`tmux cleanup failed: ${formatError(error)}`);
	}

	let worktreeCleared = options.slotId === null;
	if (options.slotId) {
		try {
			await options.pool.release(options.slotId);
			worktreeCleared = true;
		} catch (error) {
			cleanupErrors.push(`worktree cleanup failed: ${formatError(error)}`);
		}
	}

	const agent = options.agents.get(options.id);
	if (cleanupErrors.length === 0) {
		if (agent) {
			options.agents.remove(options.id);
		}
		return {
			removedFromRegistry: agent !== undefined,
			tmuxCleared,
			worktreeCleared,
			cleanupErrors,
		};
	}

	if (agent) {
		options.agents.update(options.id, {
			slotId: worktreeCleared ? null : agent.slotId,
			worktreePath: worktreeCleared ? null : agent.worktreePath,
			tmuxWindow: tmuxCleared ? null : agent.tmuxWindow,
			tmuxSessionName: tmuxCleared ? null : agent.tmuxSessionName,
			tmuxWindowId: tmuxCleared ? null : agent.tmuxWindowId,
			tmuxPaneId: tmuxCleared ? null : agent.tmuxPaneId,
		});
	}

	return {
		removedFromRegistry: false,
		tmuxCleared,
		worktreeCleared,
		cleanupErrors,
	};
}

/**
 * Mark a previously-live lane as crashed when its tmux window disappears.
 */
export function reconcileMissingWindow(options: { id: string; agents: SideAgentRegistry }): string {
	const agent = options.agents.get(options.id);
	if (agent && isLiveState(agent.state)) {
		options.agents.transition(options.id, "crashed", WINDOW_MISSING_REASON);
	}
	return WINDOW_MISSING_REASON;
}

/**
 * Startup lanes can briefly exist before tmux has finished creating a window.
 * I keep those states out of crash-reconcile so a status check does not race
 * with startup and kill an otherwise healthy launch.
 */
export function isTmuxWindowPending(
	agent: Pick<SideAgentInfo, "state" | "tmuxWindow" | "tmuxWindowId" | "tmuxPaneId">,
): boolean {
	return PRE_TMUX_WINDOW_STATES.has(agent.state) && !hasTmuxLocator(agent);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `"'"'`)}'`;
}

function isLiveState(state: SideAgentState): boolean {
	return state !== "stopped" && state !== "done" && state !== "failed" && state !== "crashed";
}

function isTerminalState(state: SideAgentState): boolean {
	return state === "stopped" || state === "done" || state === "failed" || state === "crashed";
}

function hasTmuxLocator(agent: Pick<SideAgentInfo, "tmuxWindow" | "tmuxWindowId" | "tmuxPaneId">): boolean {
	return Boolean(agent.tmuxWindow || agent.tmuxWindowId || agent.tmuxPaneId);
}
