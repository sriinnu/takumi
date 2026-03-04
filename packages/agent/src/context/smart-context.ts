/**
 * Smart Context Window — Phase 30.
 *
 * Instead of naively truncating conversation history FIFO,
 * this module ranks context items by composite relevance:
 *
 *   score = α·recency + β·rippleDepth + γ·editFreq + δ·pinned
 *
 * Context with the highest scores gets priority placement within
 * the token budget. Low-scoring context is summarized or dropped.
 *
 * Integrates with:
 *   - RippleDag (Phase 29) for dependency-based relevance
 *   - TokenBudget (budget.ts) for capacity limits
 *   - CompactHistory (compact.ts) for summarization fallback
 */

import { createLogger } from "@takumi/core";
import { estimateTokens, truncateToTokenBudget } from "./budget.js";

const log = createLogger("smart-context");

// ── Types ────────────────────────────────────────────────────────────────────

export interface ContextItem {
	/** Unique identifier (file path, message id, etc.) */
	id: string;
	/** The text content to include in context */
	content: string;
	/** Type of context item */
	kind: "file" | "message" | "tool_result" | "summary" | "pinned";
	/** When this item was last accessed/modified (epoch ms) */
	lastTouched: number;
	/** How many times this item has been referenced in the session */
	referenceCount: number;
	/** Whether the user explicitly pinned this item */
	pinned?: boolean;
	/** Ripple depth from the current edit target (0 = the file itself) */
	rippleDepth?: number;
}

export interface ScoredItem {
	item: ContextItem;
	score: number;
	estimatedTokens: number;
}

export interface SmartContextConfig {
	/** Total token budget for context items. */
	maxTokens: number;

	/** Weight for recency scoring (default: 0.3). */
	recencyWeight?: number;

	/** Weight for ripple proximity (default: 0.3). */
	rippleWeight?: number;

	/** Weight for reference frequency (default: 0.2). */
	frequencyWeight?: number;

	/** Weight for pinned items (default: 0.2). */
	pinnedWeight?: number;

	/** Maximum age in ms before an item scores 0 for recency (default: 30min). */
	maxAgeMs?: number;
}

export interface PackResult {
	/** Items that fit within the budget, ordered by score desc. */
	included: ScoredItem[];
	/** Items that didn't fit (lowest-scoring). */
	excluded: ScoredItem[];
	/** Total tokens used by included items. */
	totalTokens: number;
	/** Concatenated context text, ready for prompt injection. */
	packed: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_RECENCY_WEIGHT = 0.3;
const DEFAULT_RIPPLE_WEIGHT = 0.3;
const DEFAULT_FREQUENCY_WEIGHT = 0.2;
const DEFAULT_PINNED_WEIGHT = 0.2;
const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
const MAX_RIPPLE_DEPTH = 5;

// ── SmartContextWindow class ─────────────────────────────────────────────────

export class SmartContextWindow {
	private readonly config: Required<SmartContextConfig>;
	private items = new Map<string, ContextItem>();

	constructor(config: SmartContextConfig) {
		this.config = {
			maxTokens: config.maxTokens,
			recencyWeight: config.recencyWeight ?? DEFAULT_RECENCY_WEIGHT,
			rippleWeight: config.rippleWeight ?? DEFAULT_RIPPLE_WEIGHT,
			frequencyWeight: config.frequencyWeight ?? DEFAULT_FREQUENCY_WEIGHT,
			pinnedWeight: config.pinnedWeight ?? DEFAULT_PINNED_WEIGHT,
			maxAgeMs: config.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
		};
	}

	/** Add or update a context item. */
	upsert(item: ContextItem): void {
		const existing = this.items.get(item.id);
		if (existing) {
			existing.content = item.content;
			existing.lastTouched = Math.max(existing.lastTouched, item.lastTouched);
			existing.referenceCount = Math.max(existing.referenceCount, item.referenceCount);
			if (item.pinned !== undefined) existing.pinned = item.pinned;
			if (item.rippleDepth !== undefined) existing.rippleDepth = item.rippleDepth;
		} else {
			this.items.set(item.id, { ...item });
		}
	}

	/** Remove a context item by id. */
	remove(id: string): boolean {
		return this.items.delete(id);
	}

	/** Touch an item (refresh its recency). */
	touch(id: string): void {
		const item = this.items.get(id);
		if (item) {
			item.lastTouched = Date.now();
			item.referenceCount += 1;
		}
	}

	/** Pin/unpin an item. Pinned items get a large score boost. */
	pin(id: string, pinned = true): void {
		const item = this.items.get(id);
		if (item) item.pinned = pinned;
	}

	/** Update ripple depths for items (call after ripple DAG recalculation). */
	setRippleDepth(id: string, depth: number): void {
		const item = this.items.get(id);
		if (item) item.rippleDepth = depth;
	}

	/** Score a single context item (0-1 range). */
	scoreItem(item: ContextItem, now: number): number {
		const { recencyWeight, rippleWeight, frequencyWeight, pinnedWeight, maxAgeMs } = this.config;

		// Recency: 1.0 for just-touched, decays to 0.0 at maxAgeMs
		const age = now - item.lastTouched;
		const recencyScore = Math.max(0, 1 - age / maxAgeMs);

		// Ripple: 1.0 for depth 0 (the file itself), decays with depth
		const depth = item.rippleDepth ?? MAX_RIPPLE_DEPTH;
		const rippleScore = Math.max(0, 1 - depth / MAX_RIPPLE_DEPTH);

		// Frequency: logarithmic scale, capped at 1.0
		const freqScore = Math.min(1, Math.log2(1 + item.referenceCount) / 5);

		// Pinned: binary 0 or 1
		const pinnedScore = item.pinned ? 1 : 0;

		return (
			recencyWeight * recencyScore +
			rippleWeight * rippleScore +
			frequencyWeight * freqScore +
			pinnedWeight * pinnedScore
		);
	}

	/**
	 * Pack the best context items into the token budget.
	 *
	 * Algorithm (greedy by score):
	 *   1. Score all items
	 *   2. Sort descending by score
	 *   3. Greedily fill until budget exhausted
	 *   4. Return included + excluded lists
	 */
	pack(): PackResult {
		const now = Date.now();
		const scored: ScoredItem[] = [];

		for (const item of this.items.values()) {
			scored.push({
				item,
				score: this.scoreItem(item, now),
				estimatedTokens: estimateTokens(item.content),
			});
		}

		// Sort by score descending
		scored.sort((a, b) => b.score - a.score);

		const included: ScoredItem[] = [];
		const excluded: ScoredItem[] = [];
		let totalTokens = 0;

		for (const entry of scored) {
			if (totalTokens + entry.estimatedTokens <= this.config.maxTokens) {
				included.push(entry);
				totalTokens += entry.estimatedTokens;
			} else {
				excluded.push(entry);
			}
		}

		// Build the packed text with section headers
		const sections = included.map((s) => {
			const label = s.item.kind === "file" ? `[File: ${s.item.id}]` : `[${s.item.kind}: ${s.item.id}]`;
			return `${label}\n${s.item.content}`;
		});

		const packed = truncateToTokenBudget(sections.join("\n\n---\n\n"), this.config.maxTokens);

		log.debug(`Packed ${included.length}/${scored.length} items (${totalTokens} tokens)`);

		return { included, excluded, totalTokens, packed };
	}

	/** Get all items (for inspection/testing). */
	getAll(): ContextItem[] {
		return [...this.items.values()];
	}

	/** Clear all items. */
	clear(): void {
		this.items.clear();
	}

	/** Number of items currently tracked. */
	get size(): number {
		return this.items.size;
	}
}
