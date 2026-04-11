import type {
	NormalizedPackageConfigEntry,
	NormalizedPluginConfigEntry,
	PackageConfig,
	PluginConfig,
} from "./types.js";

type NormalizableTakumiConfigPathEntry<TOptions = Record<string, unknown>> = {
	path?: string;
	name?: string;
	options?: TOptions;
};

type NormalizedTakumiConfigPathEntry<T extends NormalizableTakumiConfigPathEntry> = Omit<T, "name" | "path"> & {
	path: string;
};

function normalizeTakumiConfigPathEntries<T extends NormalizableTakumiConfigPathEntry>(
	entries: T[] | undefined,
): Array<NormalizedTakumiConfigPathEntry<T>> {
	if (!entries || entries.length === 0) {
		return [];
	}

	const normalized: Array<NormalizedTakumiConfigPathEntry<T>> = [];
	for (const entry of entries) {
		const path = entry.path?.trim() || entry.name?.trim() || "";
		if (!path) {
			continue;
		}
		const { name: _legacyName, path: _configuredPath, ...rest } = entry;
		normalized.push({
			...rest,
			path,
		});
	}

	return normalized;
}

/** Normalize configured plugin entries to the canonical `path` field. */
export function normalizePluginConfigEntries(entries: PluginConfig[] | undefined): NormalizedPluginConfigEntry[] {
	return normalizeTakumiConfigPathEntries(entries);
}

/** Normalize configured package entries to the canonical `path` field. */
export function normalizePackageConfigEntries(entries: PackageConfig[] | undefined): NormalizedPackageConfigEntry[] {
	return normalizeTakumiConfigPathEntries(entries);
}

/** Return normalized plugin paths in configuration order. */
export function getConfiguredPluginPaths(entries: PluginConfig[] | undefined): string[] {
	return normalizePluginConfigEntries(entries).map((entry) => entry.path);
}

/** Return normalized package roots in configuration order. */
export function getConfiguredPackagePaths(entries: PackageConfig[] | undefined): string[] {
	return normalizePackageConfigEntries(entries).map((entry) => entry.path);
}
