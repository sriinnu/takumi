/**
 * Prompt Cache Layer — Phase 34.
 *
 * Hash-based deduplication layer for LLM prompts. When the agent
 * sends the same (or near-identical) prompt twice, this layer
 * returns the cached response instead of making a network call.
 *
 * Cache key: SHA-256 of (model + system prompt + last N messages).
 * Near-duplicate detection: if the only difference between the
 * current prompt and a cached one is whitespace/formatting,
 * the cache hit still applies.
 *
 * Two cache tiers:
 *   1. In-memory LRU (hot path, ~100 entries)
 *   2. Disk-based JSON (warm path, persists across sessions)
 *
 * The cache respects time-to-live: entries expire after 1 hour
 * by default (configurable).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@takumi/core";

const log = createLogger("prompt-cache");

// ── Types ────────────────────────────────────────────────────────────────────

export interface CacheEntry {
	/** SHA-256 hash of the prompt. */
	key: string;
	/** The cached response text. */
	response: string;
	/** Timestamp when cached (epoch ms). */
	cachedAt: number;
	/** Model used for the response. */
	model: string;
	/** Estimated tokens saved by cache hit. */
	tokensSaved: number;
	/** Whether this entry has extended (pinned) retention. */
	pinned?: boolean;
}

export interface PromptCacheConfig {
	/** Maximum in-memory cache entries (default: 100). */
	maxMemoryEntries?: number;
	/** Time-to-live in ms (default: 1 hour). */
	ttlMs?: number;
	/** Directory for disk cache (default: .takumi/cache). */
	cacheDir?: string;
	/** Whether to persist to disk (default: true). */
	persistToDisk?: boolean;
	/** Extended retention TTL for pinned entries (default: 24 hours). */
	pinnedTtlMs?: number;
}

export interface CacheStats {
	hits: number;
	misses: number;
	evictions: number;
	memoryEntries: number;
	diskEntries: number;
	tokensSaved: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_PINNED_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const _DEFAULT_CACHE_DIR = ".takumi/cache";
const DISK_FILE = "prompt-cache.json";

// ── PromptCache class ────────────────────────────────────────────────────────

export class PromptCache {
	private memory = new Map<string, CacheEntry>();
	private readonly maxEntries: number;
	private readonly ttlMs: number;
	private readonly pinnedTtlMs: number;
	private readonly cacheDir: string | null;
	private stats: CacheStats = {
		hits: 0,
		misses: 0,
		evictions: 0,
		memoryEntries: 0,
		diskEntries: 0,
		tokensSaved: 0,
	};

	constructor(config: PromptCacheConfig = {}) {
		this.maxEntries = config.maxMemoryEntries ?? DEFAULT_MAX_ENTRIES;
		this.ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
		this.pinnedTtlMs = config.pinnedTtlMs ?? DEFAULT_PINNED_TTL_MS;
		this.cacheDir = config.persistToDisk !== false ? (config.cacheDir ?? null) : null;

		if (this.cacheDir) this.loadFromDisk();
	}

	/**
	 * Compute a cache key from prompt components.
	 * Normalizes whitespace before hashing for near-duplicate detection.
	 */
	computeKey(model: string, systemPrompt: string, messages: string[]): string {
		const normalized = [model, normalizeWhitespace(systemPrompt), ...messages.map(normalizeWhitespace)].join(
			"\n---SEPARATOR---\n",
		);

		return createHash("sha256").update(normalized).digest("hex");
	}

	/**
	 * Look up a cached response.
	 * Returns the cached response string or null on miss.
	 */
	get(key: string): string | null {
		const entry = this.memory.get(key);

		if (!entry) {
			this.stats.misses++;
			return null;
		}

		// Check TTL (pinned entries get extended retention)
		const effectiveTtl = entry.pinned ? this.pinnedTtlMs : this.ttlMs;
		if (Date.now() - entry.cachedAt > effectiveTtl) {
			this.memory.delete(key);
			this.stats.misses++;
			return null;
		}

		this.stats.hits++;
		this.stats.tokensSaved += entry.tokensSaved;
		log.debug(`Cache hit for ${key.slice(0, 12)}... (saved ~${entry.tokensSaved} tokens)`);
		return entry.response;
	}

	/**
	 * Store a response in the cache.
	 */
	set(key: string, response: string, model: string, estimatedTokens: number): void {
		// Evict oldest entries if at capacity
		if (this.memory.size >= this.maxEntries) {
			this.evictOldest();
		}

		const entry: CacheEntry = {
			key,
			response,
			cachedAt: Date.now(),
			model,
			tokensSaved: estimatedTokens,
		};

		this.memory.set(key, entry);
		this.stats.memoryEntries = this.memory.size;
	}

	/** Invalidate a specific cache entry. */
	invalidate(key: string): boolean {
		return this.memory.delete(key);
	}

	/** Pin an entry for extended retention (survives normal TTL expiry). */
	pin(key: string): boolean {
		const entry = this.memory.get(key);
		if (!entry) return false;
		entry.pinned = true;
		return true;
	}

	/** Unpin an entry, reverting to normal TTL. */
	unpin(key: string): boolean {
		const entry = this.memory.get(key);
		if (!entry) return false;
		entry.pinned = false;
		return true;
	}

	/** Clear all cache entries. */
	clear(): void {
		this.memory.clear();
		this.stats.memoryEntries = 0;
	}

	/** Get cache statistics. */
	getStats(): CacheStats {
		return { ...this.stats, memoryEntries: this.memory.size };
	}

	/** Persist the current memory cache to disk. */
	saveToDisk(cwd: string): void {
		if (!this.cacheDir) return;

		const dir = join(cwd, this.cacheDir);
		mkdirSync(dir, { recursive: true });

		const now = Date.now();
		const entries = [...this.memory.values()].filter((e) => {
			const ttl = e.pinned ? this.pinnedTtlMs : this.ttlMs;
			return now - e.cachedAt < ttl;
		});

		writeFileSync(join(dir, DISK_FILE), JSON.stringify(entries, null, "\t"), "utf-8");
		this.stats.diskEntries = entries.length;
		log.debug(`Saved ${entries.length} cache entries to disk`);
	}

	/** Load cache entries from disk. */
	loadFromDisk(cwd?: string): void {
		if (!this.cacheDir || !cwd) return;

		const filePath = join(cwd, this.cacheDir, DISK_FILE);
		if (!existsSync(filePath)) return;

		try {
			const raw = readFileSync(filePath, "utf-8");
			const entries = JSON.parse(raw) as CacheEntry[];
			const now = Date.now();
			let loaded = 0;

			for (const entry of entries) {
				const ttl = entry.pinned ? this.pinnedTtlMs : this.ttlMs;
				if (now - entry.cachedAt < ttl && loaded < this.maxEntries) {
					this.memory.set(entry.key, entry);
					loaded++;
				}
			}

			this.stats.diskEntries = loaded;
			this.stats.memoryEntries = this.memory.size;
			log.debug(`Loaded ${loaded} cache entries from disk`);
		} catch {
			log.warn("Failed to load disk cache, starting fresh");
		}
	}

	/** Get the hit rate as a percentage. */
	get hitRate(): number {
		const total = this.stats.hits + this.stats.misses;
		return total === 0 ? 0 : Math.round((this.stats.hits / total) * 100);
	}

	// ── Internal ─────────────────────────────────────────────────────────────

	private evictOldest(): void {
		let oldestKey: string | null = null;
		let oldestTime = Number.POSITIVE_INFINITY;
		let oldestUnpinnedKey: string | null = null;
		let oldestUnpinnedTime = Number.POSITIVE_INFINITY;

		for (const [key, entry] of this.memory) {
			if (!entry.pinned && entry.cachedAt < oldestUnpinnedTime) {
				oldestUnpinnedTime = entry.cachedAt;
				oldestUnpinnedKey = key;
			}
			if (entry.cachedAt < oldestTime) {
				oldestTime = entry.cachedAt;
				oldestKey = key;
			}
		}

		// Prefer evicting non-pinned entries first
		const target = oldestUnpinnedKey ?? oldestKey;
		if (target) {
			this.memory.delete(target);
			this.stats.evictions++;
		}
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalize whitespace for near-duplicate detection.
 * Collapses multiple spaces/newlines into single space, trims.
 */
function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}
