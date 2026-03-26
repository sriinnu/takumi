/**
 * Side-agent runtime helpers.
 *
 * I keep the failure-handling and structured-query helpers here so the public
 * tool surface stays readable while the runtime contracts remain explicit.
 */

import type { SideAgentState } from "@takumi/core";
import type { Orchestrator } from "../cluster/orchestrator-factory.js";
import type { SideAgentRegistry } from "../cluster/side-agent-registry.js";
import type { WorktreePoolManager } from "../cluster/worktree-pool.js";

export const WINDOW_MISSING_REASON = "Side-agent tmux window is no longer alive.";

export function buildStructuredQueryPrompt(query: string, format: string, requestId: string): string {
	return (
		`[STRUCTURED_QUERY id=${requestId} format=${format}]\n${query}\n[/STRUCTURED_QUERY]\n` +
		`Respond with exactly one block using this envelope:\n` +
		`[STRUCTURED_QUERY_RESPONSE id=${requestId}]\n\`\`\`json\n{"requestId":"${requestId}"}\n\`\`\`\n[/STRUCTURED_QUERY_RESPONSE]`
	);
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
}): Promise<void> {
	const cleanupErrors: string[] = [];

	try {
		if (await options.tmux.isWindowAlive(options.id)) {
			await options.tmux.killWindow(options.id);
		}
	} catch (error) {
		cleanupErrors.push(`tmux cleanup failed: ${formatError(error)}`);
	}

	if (options.slotId) {
		try {
			await options.pool.release(options.slotId);
		} catch (error) {
			cleanupErrors.push(`worktree cleanup failed: ${formatError(error)}`);
		}
	}

	if (options.agents.get(options.id)) {
		options.agents.remove(options.id);
	}

	if (cleanupErrors.length > 0) {
		throw new Error(cleanupErrors.join(" "));
	}
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

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isLiveState(state: SideAgentState): boolean {
	return state !== "stopped" && state !== "done" && state !== "failed" && state !== "crashed";
}
