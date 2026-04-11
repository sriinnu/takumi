import { getConfiguredPackagePaths, type TakumiConfig } from "@takumi/core";
import {
	discoverTakumiPackages,
	type LoadedTakumiPackage,
	type LoadTakumiPackagesResult,
	type TakumiPackageSource,
} from "./package-loader.js";

/**
 * Winner chosen for a logical package identity after precedence resolution.
 */
export interface ResolvedTakumiPackage {
	packageId: string;
	package: LoadedTakumiPackage;
	shadowedPackages: LoadedTakumiPackage[];
	precedence: {
		sourceRank: number;
		reason: string;
	};
}

/**
 * Conflict emitted when multiple discovered package candidates resolve to the
 * same logical package identity.
 */
export interface PackageResolverConflict {
	kind: "shadowed-package" | "same-tier-identity-collision";
	packageId: string;
	severity: "warning" | "error";
	winner: LoadedTakumiPackage;
	shadowed: LoadedTakumiPackage[];
	message: string;
}

/**
 * Stable resolver report shared by inspection and runtime consumers.
 */
export interface PackageResolverReport {
	packages: LoadedTakumiPackage[];
	resolvedPackages: ResolvedTakumiPackage[];
	shadowedPackages: LoadedTakumiPackage[];
	conflicts: PackageResolverConflict[];
	errors: LoadTakumiPackagesResult["errors"];
}

/** Precedence ladder for duplicate logical package identities. */
const SOURCE_RANK: Record<TakumiPackageSource, number> = {
	global: 0,
	dependency: 1,
	workspace: 2,
	project: 3,
	configured: 4,
};

/**
 * Extract configured package roots from runtime config.
 *
 * `path` is the canonical field, while `.name` remains as a legacy alias for
 * older configs until the wider config contract cleanup lands.
 */
export function getConfiguredTakumiPackagePaths(config: Pick<TakumiConfig, "packages">): string[] {
	return getConfiguredPackagePaths(config.packages);
}

/**
 * Resolve the current runtime config into one precedence-aware package report.
 */
export function resolveTakumiPackageGraph(
	config: Pick<TakumiConfig, "packages" | "workingDirectory">,
): PackageResolverReport {
	const configuredPaths = getConfiguredTakumiPackagePaths(config);
	const cwd = config.workingDirectory || process.cwd();
	const discovery = discoverTakumiPackages(configuredPaths, cwd);
	return resolveTakumiPackageCandidates(discovery);
}

/**
 * Resolve an already-discovered package candidate set into winners, shadowed
 * candidates, and operator-friendly conflict metadata.
 */
export function resolveTakumiPackageCandidates(discovery: LoadTakumiPackagesResult): PackageResolverReport {
	const grouped = groupPackagesByIdentity(discovery.packages);
	const resolvedPackages: ResolvedTakumiPackage[] = [];
	const shadowedPackages: LoadedTakumiPackage[] = [];
	const conflicts: PackageResolverConflict[] = [];

	for (const packages of grouped.values()) {
		const ordered = packages.slice().sort(comparePackagesByPrecedence);
		const winner = ordered[0];
		const shadowed = ordered.slice(1);
		if (!winner) {
			continue;
		}

		resolvedPackages.push({
			packageId: toPackageId(winner),
			package: winner,
			shadowedPackages: shadowed,
			precedence: {
				sourceRank: SOURCE_RANK[winner.source],
				reason: describeWinnerReason(winner, shadowed),
			},
		});

		if (shadowed.length > 0) {
			shadowedPackages.push(...shadowed);
			conflicts.push({
				kind: "shadowed-package",
				packageId: toPackageId(winner),
				severity: "warning",
				winner,
				shadowed,
				message: `Package ${winner.packageName} selected ${winner.source} package at ${winner.rootPath} over ${shadowed.length} shadowed candidate(s).`,
			});
		}

		const sameTierShadowed = shadowed.filter((candidate) => candidate.source === winner.source);
		if (sameTierShadowed.length > 0) {
			conflicts.push({
				kind: "same-tier-identity-collision",
				packageId: toPackageId(winner),
				severity: "warning",
				winner,
				shadowed: sameTierShadowed,
				message: `Package ${winner.packageName} had ${sameTierShadowed.length} same-source collision(s) in ${winner.source}; lexical rootPath tie-break chose ${winner.rootPath}.`,
			});
		}
	}

	return {
		packages: resolvedPackages.map((entry) => entry.package),
		resolvedPackages,
		shadowedPackages,
		conflicts,
		errors: [...discovery.errors].sort((left, right) => left.path.localeCompare(right.path)),
	};
}

function groupPackagesByIdentity(packages: LoadedTakumiPackage[]): Map<string, LoadedTakumiPackage[]> {
	const grouped = new Map<string, LoadedTakumiPackage[]>();
	for (const pkg of packages) {
		const key = toPackageId(pkg);
		const existing = grouped.get(key) ?? [];
		existing.push(pkg);
		grouped.set(key, existing);
	}
	return new Map([...grouped.entries()].sort((left, right) => left[0].localeCompare(right[0])));
}

function comparePackagesByPrecedence(left: LoadedTakumiPackage, right: LoadedTakumiPackage): number {
	const rankDiff = SOURCE_RANK[right.source] - SOURCE_RANK[left.source];
	if (rankDiff !== 0) {
		return rankDiff;
	}
	return left.rootPath.localeCompare(right.rootPath);
}

function toPackageId(pkg: LoadedTakumiPackage): string {
	return pkg.packageName.trim().toLowerCase();
}

function describeWinnerReason(winner: LoadedTakumiPackage, shadowed: LoadedTakumiPackage[]): string {
	if (shadowed.length === 0) {
		return `Unique ${winner.source} package`;
	}
	const strongestShadowed = shadowed[0];
	if (!strongestShadowed) {
		return `Selected ${winner.source} package`;
	}
	if (strongestShadowed.source === winner.source) {
		return `Selected by lexical rootPath tie-break inside ${winner.source}`;
	}
	return `Selected higher-precedence ${winner.source} package over ${strongestShadowed.source}`;
}
