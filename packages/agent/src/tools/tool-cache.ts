/**
 * Tool Result Cache (Phase 40)
 *
 * Content-addressable cache for deterministic tool results.
 * Read-only / search tools (read, glob, grep) return the same output for
 * identical inputs within a session, so we can skip re-execution.
 *
 * Cache key = SHA-256(toolName + JSON(input)).
 * Entries are evicted via LRU when the cache exceeds its capacity.
 */

import { createHash } from "node:crypto";
import type { ToolResult } from "@takumi/core";
import { createLogger } from "@takumi/core";

const log = createLogger("tool-cache");

// ── Types ────────────────────────────────────────────────────────────────────

export interface CacheEntry {
	result: ToolResult;
	toolName: string;
	inputJson: string;
	createdAt: number;
	lastAccessed: number;
	hits: number;
}

export interface ToolCacheConfig {
	/** Max number of entries before LRU eviction. Default 256. */
	maxEntries: number;
	/** TTL in milliseconds. 0 = no expiry. Default 0. */
	ttlMs: number;
	/** Tool names eligible for caching. Default: read-only tools. */
	cacheableTools: Set<string>;
}

export interface ToolCacheStats {
	hits: number;
	misses: number;
	evictions: number;
	entries: number;
	hitRate: number;
}

/** Default set of tools safe to cache (read-only / idempotent). */
const DEFAULT_CACHEABLE_TOOLS = new Set(["read_file", "glob", "grep", "list_directory", "file_search", "ast_query"]);

const DEFAULT_CONFIG: ToolCacheConfig = {
	maxEntries: 256,
	ttlMs: 0,
	cacheableTools: DEFAULT_CACHEABLE_TOOLS,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a cache key from tool name + input. */
function cacheKey(toolName: string, input: Record<string, unknown>): string {
	const payload = `${toolName}\0${JSON.stringify(input, Object.keys(input).sort())}`;
	return createHash("sha256").update(payload).digest("hex");
}

// ── ToolResultCache ──────────────────────────────────────────────────────────

export class ToolResultCache {
	private readonly config: ToolCacheConfig;
	private readonly entries = new Map<string, CacheEntry>();
	private stats = { hits: 0, misses: 0, evictions: 0 };

	constructor(config?: Partial<ToolCacheConfig>) {
		this.config = {
			...DEFAULT_CONFIG,
			...config,
			cacheableTools: config?.cacheableTools ?? new Set(DEFAULT_CACHEABLE_TOOLS),
		};
	}

	// ── Core API ─────────────────────────────────────────────────────────────

	/**
	 * Check whether a tool invocation is cache-eligible and, if so,
	 * return a cached result.  Returns null on miss.
	 */
	get(toolName: string, input: Record<string, unknown>): ToolResult | null {
		if (!this.config.cacheableTools.has(toolName)) return null;

		const key = cacheKey(toolName, input);
		const entry = this.entries.get(key);
		if (!entry) {
			this.stats.misses++;
			return null;
		}

		// TTL check
		if (this.config.ttlMs > 0 && Date.now() - entry.createdAt > this.config.ttlMs) {
			this.entries.delete(key);
			this.stats.misses++;
			log.debug(`Cache expired: ${toolName} [${key.slice(0, 8)}]`);
			return null;
		}

		entry.lastAccessed = Date.now();
		entry.hits++;
		this.stats.hits++;
		log.debug(`Cache hit: ${toolName} [${key.slice(0, 8)}] (hits=${entry.hits})`);
		return entry.result;
	}

	/**
	 * Store a tool result in the cache.
	 * Only stores results for cacheable tools that did not error.
	 */
	set(toolName: string, input: Record<string, unknown>, result: ToolResult): void {
		if (!this.config.cacheableTools.has(toolName)) return;
		if (result.isError) return; // Don't cache errors

		const key = cacheKey(toolName, input);
		const now = Date.now();

		this.entries.set(key, {
			result,
			toolName,
			inputJson: JSON.stringify(input),
			createdAt: now,
			lastAccessed: now,
			hits: 0,
		});

		log.debug(`Cache set: ${toolName} [${key.slice(0, 8)}]`);
		this.evictIfNeeded();
	}

	// ── Invalidation ─────────────────────────────────────────────────────────

	/**
	 * Invalidate cache entries related to a path that was mutated.
	 * Call this after write/edit/bash tools modify the filesystem.
	 */
	invalidateForPath(path: string): number {
		let removed = 0;
		for (const [key, entry] of this.entries) {
			if (entry.inputJson.includes(path) || entry.result.output.includes(path)) {
				this.entries.delete(key);
				removed++;
			}
		}
		if (removed > 0) {
			log.info(`Invalidated ${removed} cache entries for path: ${path}`);
		}
		return removed;
	}

	/** Invalidate everything for a specific tool. */
	invalidateTool(toolName: string): number {
		let removed = 0;
		// We need to check the key derivation, but since we can't reverse
		// the hash, we keep a secondary index isn't worth it at 256 entries.
		// Just clear everything — fast enough.
		if (this.entries.size > 0) {
			removed = this.entries.size;
			this.entries.clear();
			log.info(`Invalidated all ${removed} entries (tool: ${toolName})`);
		}
		return removed;
	}

	/** Clear the entire cache. */
	clear(): void {
		this.entries.clear();
		log.debug("Cache cleared");
	}

	// ── Queries ──────────────────────────────────────────────────────────────

	/** Is this tool name eligible for caching? */
	isCacheable(toolName: string): boolean {
		return this.config.cacheableTools.has(toolName);
	}

	/** Snapshot of cache statistics. */
	getStats(): ToolCacheStats {
		const total = this.stats.hits + this.stats.misses;
		return {
			...this.stats,
			entries: this.entries.size,
			hitRate: total > 0 ? this.stats.hits / total : 0,
		};
	}

	// ── Internals ────────────────────────────────────────────────────────────

	/** Evict least-recently-accessed entries to stay within capacity. */
	private evictIfNeeded(): void {
		while (this.entries.size > this.config.maxEntries) {
			let oldestKey: string | null = null;
			let oldestTime = Number.POSITIVE_INFINITY;

			for (const [key, entry] of this.entries) {
				if (entry.lastAccessed < oldestTime) {
					oldestTime = entry.lastAccessed;
					oldestKey = key;
				}
			}

			if (oldestKey) {
				this.entries.delete(oldestKey);
				this.stats.evictions++;
				log.debug(`Evicted LRU entry [${oldestKey.slice(0, 8)}]`);
			}
		}
	}
}
