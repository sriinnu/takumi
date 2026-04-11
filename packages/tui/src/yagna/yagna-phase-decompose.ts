/**
 * yagna-phase-decompose.ts — Break the user's topic into a subtask DAG.
 *
 * Uses a side-agent lane to produce structured JSON decomposition.
 * Falls back to a direct agent submission when native tools are unavailable.
 *
 * The decomposition creates 2–7 concrete, independently executable subtasks
 * with explicit dependency edges forming a directed acyclic graph.
 */

import type { AppCommandContext } from "../commands/app-command-context.js";
import { runAnalysisMacro } from "../commands/app-command-macros.js";
import type { NativeSideAgentQueryResult } from "../workflow/workflow-side-agent-lanes.js";
import { runNativeSideAgentLane } from "../workflow/workflow-side-agent-lanes.js";
import type { YagnaEventListener, YagnaSnapshot, YagnaSubtask } from "./yagna-types.js";

/** JSON shape the LLM returns during decomposition. */
interface DecompositionResult {
	subtasks: Array<{
		id: string;
		title: string;
		spec: string;
		dependencies: string[];
	}>;
}

/**
 * Run the decompose phase: break the topic into a subtask DAG.
 *
 * Tries native side-agent tools first for isolation. Falls back to direct
 * agent macro when native tools are unavailable (single-pass, no worktree).
 *
 * @param ctx - TUI app context with agent runner and native tools.
 * @param snap - The Yagna snapshot to populate with subtasks.
 * @param emit - Event listener for status updates.
 */
export async function decomposePhase(
	ctx: AppCommandContext,
	snap: YagnaSnapshot,
	emit: YagnaEventListener,
): Promise<void> {
	const prompt = buildDecomposePrompt(snap.topic);

	/* ── Try native side-agent lane first ────────────────── */
	const laneResult = await runNativeSideAgentLane(ctx, "/yagna", `Decompose: ${snap.topic}`, prompt, {
		topic: "architecture",
		complexity: "STANDARD",
	});

	if (laneResult) {
		const parsed = extractDecomposition(laneResult);
		const subtasks = parseSubtasks(parsed);
		if (subtasks.length > 0) {
			snap.subtasks = subtasks;
			// Notify listeners of every newly created subtask.
			for (const st of subtasks) {
				emit({ kind: "subtask-status", subtaskId: st.id, status: "pending" });
			}
			return;
		}
	}

	/* ── Fallback: direct agent submission ───────────────── */
	if (ctx.agentRunner) {
		await runAnalysisMacro(
			ctx,
			"/yagna",
			[
				"You are decomposing a topic into subtasks for an autonomous Yagna swarm.",
				"Return ONLY valid JSON — no other text.",
				prompt,
			].join("\n"),
		);

		// Read the most recent assistant message for the JSON payload.
		const lastAssistant = [...ctx.state.messages.value].reverse().find((msg) => msg.role === "assistant");
		if (lastAssistant) {
			const text = lastAssistant.content
				.filter(
					(block): block is Extract<(typeof lastAssistant.content)[number], { type: "text" }> => block.type === "text",
				)
				.map((block) => block.text)
				.join("");
			snap.subtasks = parseSubtasks(tryParseJson<DecompositionResult>(text));
		}
	}

	// Emit status for any subtasks created via fallback path.
	for (const st of snap.subtasks) {
		emit({ kind: "subtask-status", subtaskId: st.id, status: "pending" });
	}
}

/* ── Prompt construction ─────────────────────────────────────── */

/** Build the system prompt that instructs the LLM on decomposition rules. */
function buildDecomposePrompt(topic: string): string {
	return [
		"You are a senior engineering architect. Your ONLY job is to decompose a topic into subtasks.",
		"",
		"Rules:",
		"1. Break the topic into 2–7 concrete, independently executable subtasks.",
		"2. Each subtask must have a clear deliverable (a file, a module, a test suite, etc.).",
		"3. Express dependencies as subtask IDs. Use a DAG — no cycles.",
		"4. Keep subtask specs detailed enough for a coding agent to implement without questions.",
		"5. Return ONLY valid JSON — no markdown fences, no explanation outside the JSON.",
		"",
		"Return strict JSON matching this schema:",
		'{ "subtasks": [{ "id": "st-1", "title": "...", "spec": "...", "dependencies": [] }, ...] }',
		"",
		`Topic: ${topic}`,
	].join("\n");
}

/* ── Parsing helpers ─────────────────────────────────────────── */

/** Convert raw LLM JSON output into typed YagnaSubtask entries. */
function parseSubtasks(raw: DecompositionResult | null): YagnaSubtask[] {
	if (!raw?.subtasks || !Array.isArray(raw.subtasks)) return [];

	return raw.subtasks.map((item, index) => ({
		id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : `st-${index + 1}`,
		title: typeof item.title === "string" ? item.title.trim() : `Subtask ${index + 1}`,
		spec: typeof item.spec === "string" ? item.spec.trim() : "",
		dependencies: Array.isArray(item.dependencies)
			? item.dependencies.filter((dep): dep is string => typeof dep === "string")
			: [],
		status: "pending" as const,
		tarkaRounds: [],
		agreedPlan: "",
		laneId: null,
		branch: "",
		attempts: 0,
		lastError: null,
	}));
}

/** Extract a DecompositionResult from a native side-agent query result. */
function extractDecomposition(result: NativeSideAgentQueryResult): DecompositionResult | null {
	if (typeof result.response === "string") {
		return tryParseJson<DecompositionResult>(result.response);
	}
	if (result.response && typeof result.response === "object") {
		return result.response as DecompositionResult;
	}
	return null;
}

/**
 * Attempt to parse JSON from a string, tolerating markdown code fences.
 *
 * LLMs love wrapping JSON in ```json blocks — this strips those before parsing.
 * Falls back to extracting the first `{...}` object from the text.
 */
function tryParseJson<T>(text: string): T | null {
	const cleaned = text
		.replace(/^```(?:json)?\s*/m, "")
		.replace(/\s*```$/m, "")
		.trim();
	try {
		return JSON.parse(cleaned) as T;
	} catch {
		// Last resort: grab the first JSON object from the text.
		const match = cleaned.match(/\{[\s\S]*\}/);
		if (match) {
			try {
				return JSON.parse(match[0]) as T;
			} catch {
				return null;
			}
		}
		return null;
	}
}
