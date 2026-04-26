/**
 * @file kosha-catalog.ts
 * @module cli/kosha-catalog
 *
 * Resolution layer that pulls the kosha (कोश) provider/model catalog and
 * unions it onto Takumi's static fallback so the picker reflects what
 * actually exists in the world — not just the four entries we hardcoded.
 *
 * Failures here log once at warn level so the operator (or a tail-of-logs
 * triage path) can tell *why* the picker fell back to static instead of
 * silently shrugging.
 *
 * ## Why this lives here
 * `kosha-bridge.ts` exposes thin pass-through helpers over the kosha-discovery
 * library. This file is the *consumer* side: failure-tolerant fetch, defensive
 * shape validation, and per-provider deduped union. It runs once at startup
 * before the chitragupta inventory gets a chance to override.
 *
 * ## Resolution chain (high → low priority)
 * 1. Chitragupta inventory  — when running with direct-session providers,
 *    `deriveStartupProviderTruth` flips to strict mode and this layer is
 *    ignored entirely. That's by design — chitragupta is the brain.
 * 2. Kosha (this layer)     — when chitragupta is silent, kosha's universal
 *    registry (~/.kosha/registry.json + runtime discovery) wins. Pricing,
 *    aliases, and model lists all come along.
 * 3. Static catalog          — `PROVIDER_MODELS` in completion.ts. Last-
 *    resort starter pack of curated models per provider.
 *
 * ## Failure mode
 * If kosha-discovery isn't installed, throws on import, returns garbage, or
 * the disk cache is missing/corrupt — `fetchKoshaProviderCatalogSafe` returns
 * `null` and the caller falls through to the static catalog. Startup never
 * fails because of kosha; the underlying error is logged once at warn level.
 */

import { createLogger } from "@takumi/core";

const log = createLogger("kosha-catalog");

/**
 * Pull kosha's discovered provider/model catalog without ever throwing.
 *
 * Returns:
 * - `null`  — kosha-discovery couldn't be loaded, threw, or otherwise
 *             didn't respond. Caller should fall back to the static catalog.
 * - `Record<string, string[]>` — kosha responded; the object may still be
 *             empty if no providers had chat models, but it's a real answer.
 *
 * The `null` vs `{}` distinction lets future telemetry surface "kosha is
 * down" separately from "kosha says you have no providers." Defensive shape
 * validation strips any non-string model entries so downstream callers can
 * treat the result as a strict map without re-checking types.
 */
export async function fetchKoshaProviderCatalogSafe(): Promise<Record<string, string[]> | null> {
	try {
		const { koshaProviderModels } = await import("./kosha-bridge.js");
		const catalog = await koshaProviderModels();
		const result: Record<string, string[]> = {};
		for (const [provider, models] of Object.entries(catalog)) {
			if (Array.isArray(models)) {
				const filtered = models.filter((m): m is string => typeof m === "string" && m.length > 0);
				if (filtered.length > 0) result[provider] = filtered;
			}
		}
		return result;
	} catch (err) {
		log.warn("Kosha catalog unavailable — falling back to static", err);
		return null;
	}
}

/**
 * Union two `provider → models[]` catalogs, deduped per provider.
 *
 * The `overlay` argument's models appear first (kosha usually carries the
 * freshest data), with any base-only models appended. Providers appearing
 * on only one side pass through with their full list.
 *
 * Used to layer kosha onto the static starter catalog before chitragupta
 * gets a chance to override the result via `deriveStartupProviderTruth`.
 *
 * @param base    The lower-priority catalog (typically static `PROVIDER_MODELS`).
 * @param overlay The higher-priority catalog (typically kosha's discovered list).
 * @returns       New catalog object — neither input is mutated.
 */
export function unionPerProvider(
	base: Record<string, string[]>,
	overlay: Record<string, string[]>,
): Record<string, string[]> {
	const merged: Record<string, string[]> = {};
	const allProviders = new Set([...Object.keys(base), ...Object.keys(overlay)]);
	for (const provider of allProviders) {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const model of overlay[provider] ?? []) {
			if (!seen.has(model)) {
				seen.add(model);
				out.push(model);
			}
		}
		for (const model of base[provider] ?? []) {
			if (!seen.has(model)) {
				seen.add(model);
				out.push(model);
			}
		}
		if (out.length > 0) merged[provider] = out;
	}
	return merged;
}
