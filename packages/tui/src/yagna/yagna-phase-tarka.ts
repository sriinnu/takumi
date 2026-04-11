/**
 * yagna-phase-tarka.ts — Logical argumentation phase (तर्क / Tarka).
 *
 * Each subtask goes through a PROPOSE → CHALLENGE(×3) → REVISE loop.
 * Three distinct challenger framings (flaw, alternative, risk) probe the
 * proposal from different angles. A revised plan is accepted when Jaccard
 * similarity with the previous round exceeds a convergence threshold,
 * indicating ideas have stabilised.
 *
 * Derived from the "duh" consensus protocol (tmp/duh-main).
 */

import type { AppCommandContext } from "../commands/app-command-context.js";
import type { NativeSideAgentQueryResult } from "../workflow/workflow-side-agent-lanes.js";
import { runNativeSideAgentLane } from "../workflow/workflow-side-agent-lanes.js";
import type { TarkaRound, YagnaEventListener, YagnaSnapshot, YagnaSubtask } from "./yagna-types.js";

/** Jaccard similarity threshold: above this, the subtask plan has converged. */
const CONVERGENCE_THRESHOLD = 0.65;

/** The three challenger framings used to probe a proposal. */
const CHALLENGER_FRAMINGS = [
	"Find the biggest flaw, limitation, or incorrect assumption in this plan.",
	"Propose a fundamentally different alternative approach to achieve the same goal.",
	"Identify the most dangerous risk or failure mode this plan doesn't address.",
] as const;

/**
 * Run the Tarka (debate) phase across all subtasks.
 *
 * Subtasks are debated in parallel — each subtask runs up to `maxRounds`
 * rounds of PROPOSE → CHALLENGE → REVISE until convergence or exhaustion.
 *
 * @param ctx - TUI app command context.
 * @param snap - Yagna snapshot with decomposed subtasks.
 * @param emit - Event emitter for status broadcasting.
 */
export async function tarkaPhase(ctx: AppCommandContext, snap: YagnaSnapshot, emit: YagnaEventListener): Promise<void> {
	const maxRounds = snap.config.maxTarkaRounds;

	// Debate all subtasks concurrently — each subtask is independent.
	await Promise.all(snap.subtasks.map((subtask) => tarkaSubtask(ctx, subtask, maxRounds, emit)));
}

/* ── Per-subtask Tarka loop ──────────────────────────────────── */

/**
 * Run debate rounds for a single subtask until convergence or round limit.
 *
 * @param ctx - TUI app context.
 * @param subtask - The subtask to debate.
 * @param maxRounds - Maximum number of Tarka rounds.
 * @param emit - Event emitter.
 */
async function tarkaSubtask(
	ctx: AppCommandContext,
	subtask: YagnaSubtask,
	maxRounds: number,
	emit: YagnaEventListener,
): Promise<void> {
	for (let round = 0; round < maxRounds; round++) {
		emit({ kind: "subtask-status", subtaskId: subtask.id, status: "debating" });

		/* Step 1: PROPOSE — Generate or refine the implementation plan. */
		const proposal = await runPropose(ctx, subtask, round);

		/* Step 2: CHALLENGE(×3) — Probe from three framings in parallel. */
		const challengeTexts = await runChallenges(ctx, subtask, proposal);

		// Build a keyed record: { "flaw": ..., "alternative": ..., "risk": ... }
		const challenges: Record<string, string> = {
			flaw: challengeTexts[0] ?? "",
			alternative: challengeTexts[1] ?? "",
			risk: challengeTexts[2] ?? "",
		};

		/* Step 3: REVISE — Synthesise proposal + challenges into a refined plan. */
		const revision = await runRevise(ctx, subtask, proposal, challengeTexts);

		// Record this round in the subtask's debate history.
		const tarkaRound: TarkaRound = {
			round,
			proposal,
			challenges,
			revision,
			convergenceScore: 0,
		};

		// Check convergence against the previous round's revised plan.
		if (round > 0) {
			const prev = subtask.tarkaRounds[round - 1].revision;
			tarkaRound.convergenceScore = jaccardSimilarity(prev, revision);
			if (tarkaRound.convergenceScore >= CONVERGENCE_THRESHOLD) {
				subtask.tarkaRounds.push(tarkaRound);
				subtask.agreedPlan = revision;
				return; // Converged — exit debate early.
			}
		}

		subtask.tarkaRounds.push(tarkaRound);
	}

	// Exhausted all rounds — use the last revised plan as best effort.
	const lastRound = subtask.tarkaRounds[subtask.tarkaRounds.length - 1];
	subtask.agreedPlan = lastRound?.revision ?? "";
}

/* ── PROPOSE step ────────────────────────────────────────────── */

/**
 * Generate an implementation proposal for the subtask.
 *
 * Round 0 creates an initial proposal; subsequent rounds re-propose
 * incorporating feedback from the previous round's challenges.
 */
async function runPropose(ctx: AppCommandContext, subtask: YagnaSubtask, round: number): Promise<string> {
	const context =
		round > 0
			? `Previous round feedback was incorporated. Refine your proposal.\n\nPrevious plan:\n${subtask.agreedPlan || subtask.tarkaRounds[round - 1]?.revision || ""}`
			: "";

	const prompt = [
		`You are proposing an implementation plan for subtask "${subtask.title}".`,
		`Specification: ${subtask.spec}`,
		context,
		"Provide a concrete, step-by-step implementation plan.",
		"Include file names, function signatures, and key algorithms.",
	]
		.filter(Boolean)
		.join("\n\n");

	return queryLane(ctx, `propose-${subtask.id}-r${round}`, prompt);
}

/* ── CHALLENGE step (×3 framings) ────────────────────────────── */

/**
 * Run three parallel challengers against the proposal.
 *
 * Each challenger uses a different framing to find weaknesses:
 * - **Flaw**: logical/technical errors
 * - **Alternative**: fundamentally different approaches
 * - **Risk**: failure modes and edge cases
 */
async function runChallenges(ctx: AppCommandContext, subtask: YagnaSubtask, proposal: string): Promise<string[]> {
	return Promise.all(
		CHALLENGER_FRAMINGS.map((framing, i) => {
			const prompt = [
				`You are challenger #${i + 1} reviewing a plan for "${subtask.title}".`,
				`Proposal:\n${proposal}`,
				`Your framing: ${framing}`,
				"Be specific and constructive. Cite exact weaknesses.",
			].join("\n\n");

			return queryLane(ctx, `challenge-${subtask.id}-c${i}`, prompt);
		}),
	);
}

/* ── REVISE step ─────────────────────────────────────────────── */

/**
 * Synthesise the original proposal with challenger feedback into a refined plan.
 *
 * The reviser acts as a neutral synthesiser, accepting valid criticisms
 * and rejecting unfounded ones with explicit reasoning.
 */
async function runRevise(
	ctx: AppCommandContext,
	subtask: YagnaSubtask,
	proposal: string,
	challenges: string[],
): Promise<string> {
	const challengeBlock = challenges.map((c, i) => `Challenge ${i + 1}:\n${c}`).join("\n\n---\n\n");

	const prompt = [
		`You are revising the plan for "${subtask.title}" after debate.`,
		`Original proposal:\n${proposal}`,
		`Challenges received:\n${challengeBlock}`,
		"Produce a final revised plan that:",
		"- Addresses valid criticisms with concrete changes",
		"- Rejects unfounded criticisms with reasoning",
		"- Maintains the concrete step-by-step format with file names and function signatures",
	].join("\n\n");

	return queryLane(ctx, `revise-${subtask.id}`, prompt);
}

/* ── Side-agent lane query ───────────────────────────────────── */

/**
 * Query a side-agent lane, returning its text response.
 *
 * Wraps `runNativeSideAgentLane` with a fallback to an empty string
 * when the lane returns no usable response.
 */
async function queryLane(ctx: AppCommandContext, label: string, prompt: string): Promise<string> {
	const result: NativeSideAgentQueryResult | null = await runNativeSideAgentLane(ctx, "/yagna", label, prompt, {
		topic: "debate",
		complexity: "STANDARD",
	});

	if (!result) return "";
	return typeof result.response === "string" ? result.response : JSON.stringify(result.response ?? "");
}

/* ── Convergence metric ──────────────────────────────────────── */

/**
 * Compute Jaccard similarity between two texts (word-level).
 *
 * Jaccard(A, B) = |A ∩ B| / |A ∪ B|
 *
 * Used to detect when debate rounds stop producing materially new ideas,
 * indicating the subtask plan has converged.
 *
 * @returns A value in [0, 1]. Higher = more similar.
 */
function jaccardSimilarity(a: string, b: string): number {
	const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
	const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));

	if (wordsA.size === 0 && wordsB.size === 0) return 1; // Both empty → identical.

	let intersectionSize = 0;
	for (const word of wordsA) {
		if (wordsB.has(word)) intersectionSize++;
	}

	// |A ∪ B| = |A| + |B| - |A ∩ B|
	const unionSize = wordsA.size + wordsB.size - intersectionSize;
	return unionSize === 0 ? 1 : intersectionSize / unionSize;
}
