/**
 * @file tot-planner.ts
 * @module cluster/tot-planner
 *
 * Tree-of-Thoughts (ToT) Planning
 *
 * **Paper:** "Tree of Thoughts: Deliberate Problem Solving with Large Language Models"
 * Yao et al., arXiv:2305.10601 (May 2023)
 *
 * ## Key Insight
 * Instead of generating a single linear plan, ToT explores multiple plan
 * branches simultaneously, scoring each with a heuristic evaluator, and
 * pruning low-quality branches early. This mirrors human deliberate
 * reasoning: consider alternatives, evaluate merit, backtrack when stuck.
 *
 * ## Algorithm
 * 1. Generate K candidate plan branches from the root prompt
 * 2. Score each branch with {@link AgentEvaluator}
 * 3. Prune branches below the score threshold
 * 4. For surviving branches, expand one step deeper
 * 5. Repeat until `maxDepth` reached or a branch meets `targetScore`
 * 6. Return the highest-scoring complete path
 *
 * ## Search Strategies
 * - **BFS** (breadth-first): expand all surviving branches at each level —
 *   better coverage, higher token cost.
 * - **DFS** (depth-first): pursue one branch at a time, backtrack on prune —
 *   lower token cost, may miss better alternatives.
 *
 * ## Integration with Takumi
 * - Plugs into the PLANNING phase of {@link ClusterPhaseRunner}
 * - Uses existing {@link PhaseContext.sendMessage} for LLM calls
 * - Scored by Niyanta's {@link AgentEvaluator}
 * - Configurable via `orchestration.treeOfThoughts` (future config key)
 *
 * @see https://arxiv.org/abs/2305.10601
 */

import { createLogger } from "@takumi/core";
import type { AgentEvaluator } from "@yugenlab/chitragupta/niyanta";
import type { MessagePayload } from "../loop.js";
import type { PhaseContext } from "./phases.js";

const log = createLogger("cluster-tot");

// ─── Type Definitions ────────────────────────────────────────────────────────

/** Configuration for Tree-of-Thoughts planning. */
export interface ToTConfig {
	/** Number of candidate branches per expansion (default: 3). */
	branchFactor: number;
	/** Maximum tree depth — steps of plan expansion (default: 3). */
	maxDepth: number;
	/** Minimum heuristic score to survive pruning (default: 4.0). */
	pruneThreshold: number;
	/** Score at which a branch is considered "good enough" to return early (default: 8.0). */
	targetScore: number;
	/** Search strategy (default: "bfs"). */
	searchStrategy: "bfs" | "dfs";
	/** Temperature for branch generation (default: 0.8). */
	temperature: number;
}

/** A single node in the thought tree. */
export interface ThoughtNode {
	/** Unique node identifier. */
	id: string;
	/** Depth in the tree (0 = root). */
	depth: number;
	/** Parent node ID (null for root). */
	parentId: string | null;
	/** The partial plan text produced at this node. */
	thought: string;
	/** Heuristic score from evaluator (0–10). */
	score: number;
	/** Whether this node was pruned. */
	pruned: boolean;
	/** Child node IDs. */
	children: string[];
}

/** Complete result from a ToT planning run. */
export interface ToTResult {
	/** All nodes explored in the tree. */
	nodes: ThoughtNode[];
	/** The best path from root to leaf (node IDs). */
	bestPath: string[];
	/** Combined plan text from the best path. */
	bestPlan: string;
	/** Score of the best leaf node. */
	bestScore: number;
	/** Total branches explored (not pruned). */
	branchesExplored: number;
	/** Total branches pruned. */
	branchesPruned: number;
	/** Whether the target score was reached. */
	targetReached: boolean;
	/** Total token usage across all LLM calls. */
	totalTokenUsage: { input: number; output: number };
}

// ─── Default Config ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG: ToTConfig = {
	branchFactor: 3,
	maxDepth: 3,
	pruneThreshold: 4.0,
	targetScore: 8.0,
	searchStrategy: "bfs",
	temperature: 0.8,
};

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Explore a task using Tree-of-Thoughts planning.
 *
 * @param ctx       Phase context (provides LLM access and workspace info).
 * @param evaluator Niyanta evaluator for scoring branches.
 * @param task      Natural-language task description.
 * @param config    Partial config — merged with defaults.
 * @returns The best plan found along with exploration statistics.
 *
 * @example
 * ```ts
 * const result = await totPlan(ctx, evaluator, "Refactor auth module to use JWTs", {
 *   branchFactor: 4,
 *   maxDepth: 2,
 * });
 * console.log(result.bestPlan);  // combined plan text
 * console.log(result.bestScore); // e.g. 8.3
 * ```
 */
export async function totPlan(
	ctx: PhaseContext,
	evaluator: AgentEvaluator,
	task: string,
	config?: Partial<ToTConfig>,
): Promise<ToTResult> {
	const cfg: ToTConfig = { ...DEFAULT_CONFIG, ...config };
	log.info(`ToT planning: branching=${cfg.branchFactor}, depth=${cfg.maxDepth}, strategy=${cfg.searchStrategy}`);

	const nodeMap = new Map<string, ThoughtNode>();
	let totalInput = 0;
	let totalOutput = 0;
	let branchesPruned = 0;

	const trackTokens = (i: number, o: number) => {
		totalInput += i;
		totalOutput += o;
	};

	// ── Generate root branches ───────────────────────────────────────────
	const rootBranches = await generateBranches(ctx, evaluator, task, null, cfg, trackTokens);
	for (const node of rootBranches) nodeMap.set(node.id, node);
	branchesPruned += pruneBranches(rootBranches, cfg.pruneThreshold);

	const surviving = rootBranches.filter((n) => !n.pruned);
	log.info(`Root: ${rootBranches.length} generated, ${surviving.length} survive pruning`);

	// ── Check early exit ─────────────────────────────────────────────────
	const earlyWinner = surviving.find((n) => n.score >= cfg.targetScore);
	if (earlyWinner) {
		log.info(`Target reached at depth 0: score=${earlyWinner.score.toFixed(2)}`);
		return buildResult(nodeMap, earlyWinner.id, branchesPruned, true, totalInput, totalOutput);
	}

	// ── Expand deeper via chosen strategy ────────────────────────────────
	if (cfg.searchStrategy === "bfs") {
		const bfsResult = await expandBFS(ctx, evaluator, task, surviving, cfg, nodeMap, branchesPruned, trackTokens);
		branchesPruned = bfsResult.pruned;
	} else {
		const dfsResult = await expandDFS(ctx, evaluator, task, surviving, cfg, nodeMap, branchesPruned, trackTokens);
		branchesPruned = dfsResult.pruned;
	}

	// ── Select best leaf ─────────────────────────────────────────────────
	const allNodes = Array.from(nodeMap.values());
	const leaves = allNodes.filter((n) => n.children.length === 0 && !n.pruned);
	if (leaves.length === 0) {
		log.warn("All branches pruned — returning best pruned leaf as fallback");
		const fallback = allNodes.sort((a, b) => b.score - a.score)[0];
		return buildResult(nodeMap, fallback.id, branchesPruned, false, totalInput, totalOutput);
	}
	const best = leaves.sort((a, b) => b.score - a.score)[0];
	return buildResult(nodeMap, best.id, branchesPruned, best.score >= cfg.targetScore, totalInput, totalOutput);
}

// ─── BFS Expansion ───────────────────────────────────────────────────────────

async function expandBFS(
	ctx: PhaseContext,
	evaluator: AgentEvaluator,
	task: string,
	frontier: ThoughtNode[],
	cfg: ToTConfig,
	nodeMap: Map<string, ThoughtNode>,
	pruned: number,
	trackTokens: (i: number, o: number) => void,
): Promise<{ pruned: number; targetHit: boolean }> {
	let currentFrontier = frontier;
	for (let depth = 1; depth < cfg.maxDepth; depth++) {
		const nextFrontier: ThoughtNode[] = [];
		for (const parent of currentFrontier) {
			const children = await generateBranches(ctx, evaluator, task, parent, cfg, trackTokens);
			for (const child of children) {
				nodeMap.set(child.id, child);
				parent.children.push(child.id);
			}
			pruned += pruneBranches(children, cfg.pruneThreshold);
			nextFrontier.push(...children.filter((n) => !n.pruned));
		}
		log.info(`BFS depth=${depth}: ${nextFrontier.length} live branches`);
		if (nextFrontier.length === 0) break;
		const winner = nextFrontier.find((n) => n.score >= cfg.targetScore);
		if (winner) {
			log.info(`Target reached at depth ${depth}: score=${winner.score.toFixed(2)}`);
			return { pruned, targetHit: true };
		}
		currentFrontier = nextFrontier;
	}
	return { pruned, targetHit: false };
}

// ─── DFS Expansion ───────────────────────────────────────────────────────────

async function expandDFS(
	ctx: PhaseContext,
	evaluator: AgentEvaluator,
	task: string,
	roots: ThoughtNode[],
	cfg: ToTConfig,
	nodeMap: Map<string, ThoughtNode>,
	pruned: number,
	trackTokens: (i: number, o: number) => void,
): Promise<{ pruned: number; targetHit: boolean }> {
	// DFS: prioritize highest-scoring root first
	const sorted = [...roots].sort((a, b) => b.score - a.score);
	for (const root of sorted) {
		const result = await dfsExpand(ctx, evaluator, task, root, 1, cfg, nodeMap, trackTokens);
		pruned += result.pruned;
		if (result.targetHit) return { pruned, targetHit: true };
	}
	return { pruned, targetHit: false };
}

async function dfsExpand(
	ctx: PhaseContext,
	evaluator: AgentEvaluator,
	task: string,
	parent: ThoughtNode,
	depth: number,
	cfg: ToTConfig,
	nodeMap: Map<string, ThoughtNode>,
	trackTokens: (i: number, o: number) => void,
): Promise<{ pruned: number; targetHit: boolean }> {
	if (depth >= cfg.maxDepth) return { pruned: 0, targetHit: false };
	const children = await generateBranches(ctx, evaluator, task, parent, cfg, trackTokens);
	for (const child of children) {
		nodeMap.set(child.id, child);
		parent.children.push(child.id);
	}
	let pruned = pruneBranches(children, cfg.pruneThreshold);
	const surviving = children.filter((n) => !n.pruned).sort((a, b) => b.score - a.score);
	for (const child of surviving) {
		if (child.score >= cfg.targetScore) return { pruned, targetHit: true };
		const deeper = await dfsExpand(ctx, evaluator, task, child, depth + 1, cfg, nodeMap, trackTokens);
		pruned += deeper.pruned;
		if (deeper.targetHit) return { pruned, targetHit: true };
	}
	return { pruned, targetHit: false };
}

// ─── Branch Generation ───────────────────────────────────────────────────────

async function generateBranches(
	ctx: PhaseContext,
	evaluator: AgentEvaluator,
	task: string,
	parent: ThoughtNode | null,
	cfg: ToTConfig,
	trackTokens: (i: number, o: number) => void,
): Promise<ThoughtNode[]> {
	const depth = parent ? parent.depth + 1 : 0;
	const parentChain = parent ? collectAncestorThoughts(parent, new Map()) : [];

	const systemPrompt = buildBranchPrompt(task, parentChain, cfg.branchFactor, depth, ctx.workDir);
	const userMsg: MessagePayload = { role: "user", content: task };

	let raw = "";
	let inputTokens = 0;
	let outputTokens = 0;
	const model = ctx.getModelForRole?.("PLANNER" as never);

	try {
		for await (const event of ctx.sendMessage([userMsg], systemPrompt, [], undefined, {
			model,
			// @ts-expect-error — temperature not in base options type
			temperature: cfg.temperature,
		})) {
			if (event.type === "text_delta") raw += event.text;
			else if (event.type === "usage_update") {
				inputTokens = event.usage.inputTokens;
				outputTokens = event.usage.outputTokens;
			}
		}
	} catch (err) {
		log.error(`Branch generation failed at depth=${depth}`, err);
		raw = `[branch generation error: ${err instanceof Error ? err.message : String(err)}]`;
	}
	trackTokens(inputTokens, outputTokens);

	const branches = parseBranches(raw, cfg.branchFactor);
	return branches.map((thought, i) => {
		const id = `tot-d${depth}-b${i}-${Math.random().toString(36).slice(2, 6)}`;
		const report = evaluator.evaluate(id, "tot-planner", task, thought);
		return {
			id,
			depth,
			parentId: parent?.id ?? null,
			thought,
			score: report.overallScore,
			pruned: false,
			children: [],
		};
	});
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function collectAncestorThoughts(node: ThoughtNode, _nodeMap: Map<string, ThoughtNode>): string[] {
	// For the initial implementation we only have the immediate parent's thought.
	// A full tree walk requires the node map; we keep it simple here by returning
	// the single parent thought. The caller (generateBranches) passes the parent
	// directly so we just wrap it.
	return [node.thought];
}

function buildBranchPrompt(
	task: string,
	parentThoughts: string[],
	branchFactor: number,
	depth: number,
	workDir: string,
): string {
	const context =
		parentThoughts.length > 0
			? `\nPrevious plan steps:\n${parentThoughts.map((t, i) => `Step ${i + 1}: ${t}`).join("\n")}\n`
			: "";
	return `You are a planning agent performing Tree-of-Thoughts deliberation.

**Task:** ${task}
**Working directory:** ${workDir}
**Current depth:** ${depth}
${context}
Generate exactly ${branchFactor} DISTINCT plan approaches for ${depth === 0 ? "the overall task" : "the NEXT step"}.
Each approach should be meaningfully different — vary the strategy, ordering, or technique.

Format your response as a numbered list:
1. <plan approach 1>
2. <plan approach 2>
${branchFactor > 2 ? `3. <plan approach 3>` : ""}
${branchFactor > 3 ? `4. <plan approach 4>` : ""}
${branchFactor > 4 ? `5. <plan approach 5>` : ""}

Each approach should be 2-5 sentences describing the specific steps to take.
Be concrete — mention file names, functions, patterns, and tools where relevant.`;
}

function parseBranches(raw: string, expected: number): string[] {
	const lines = raw.split("\n");
	const branches: string[] = [];
	let current = "";
	for (const line of lines) {
		const numbered = line.match(/^\s*\d+[.)]\s+(.+)/);
		if (numbered) {
			if (current.trim()) branches.push(current.trim());
			current = numbered[1];
		} else if (current && line.trim()) {
			current += ` ${line.trim()}`;
		}
	}
	if (current.trim()) branches.push(current.trim());

	// If parsing failed to find enough branches, split raw text evenly
	if (branches.length === 0 && raw.trim()) {
		branches.push(raw.trim());
	}
	// Pad if fewer than expected (e.g. LLM returned 2 instead of 3)
	while (branches.length < expected && branches.length > 0) {
		branches.push(branches[branches.length - 1]);
	}
	return branches.slice(0, expected);
}

function pruneBranches(nodes: ThoughtNode[], threshold: number): number {
	let pruned = 0;
	for (const node of nodes) {
		if (node.score < threshold) {
			node.pruned = true;
			pruned++;
			log.debug(`Pruned ${node.id} (score=${node.score.toFixed(2)} < ${threshold})`);
		}
	}
	return pruned;
}

function buildResult(
	nodeMap: Map<string, ThoughtNode>,
	leafId: string,
	branchesPruned: number,
	targetReached: boolean,
	totalInput: number,
	totalOutput: number,
): ToTResult {
	// Walk from leaf back to root to build best path
	const path: string[] = [];
	let current: ThoughtNode | undefined = nodeMap.get(leafId);
	while (current) {
		path.unshift(current.id);
		current = current.parentId ? nodeMap.get(current.parentId) : undefined;
	}

	const planParts = path.map((id) => nodeMap.get(id)!.thought);
	const nodes = Array.from(nodeMap.values());
	const bestLeaf = nodeMap.get(leafId)!;

	return {
		nodes,
		bestPath: path,
		bestPlan: planParts.join("\n\n"),
		bestScore: bestLeaf.score,
		branchesExplored: nodes.filter((n) => !n.pruned).length,
		branchesPruned,
		targetReached,
		totalTokenUsage: { input: totalInput, output: totalOutput },
	};
}
