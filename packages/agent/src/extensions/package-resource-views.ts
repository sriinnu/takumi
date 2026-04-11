import type { TakumiPackageSource } from "./package-loader.js";
import type { PackageResolverReport, ResolvedTakumiPackage } from "./package-resolver.js";
import type { SkillRoot } from "./skills-loader.js";

/**
 * Shared metadata describing one resolved package-provided resource path.
 */
export interface PackageResourcePathEntry {
	packageId: string;
	packageName: string;
	rootPath: string;
	source: TakumiPackageSource;
	path: string;
}

/**
 * Shared ordered views over resolved package resources.
 *
 * Different runtime consumers need different precedence directions:
 * - extensions load high → low because first registration wins for tools/commands
 * - skills, prompt addons, and tool rules load low → high so later roots win
 */
export interface PackageResourceViews {
	extensionEntryPoints: PackageResourcePathEntry[];
	skillRoots: Array<SkillRoot & Omit<PackageResourcePathEntry, "source">>;
	systemPrompts: PackageResourcePathEntry[];
	toolRules: PackageResourcePathEntry[];
}

/**
 * Build consumer-specific ordered resource views from one resolver report.
 */
export function buildPackageResourceViews(report: PackageResolverReport): PackageResourceViews {
	const extensionPackages = sortResolvedPackages(report.resolvedPackages, "high-to-low");
	const conventionPackages = sortResolvedPackages(report.resolvedPackages, "low-to-high");

	return {
		extensionEntryPoints: extensionPackages.flatMap((resolved) =>
			resolved.package.extensions.map((path) => toResourcePathEntry(resolved, path)),
		),
		skillRoots: conventionPackages.flatMap((resolved) =>
			resolved.package.skillPaths.map((path) => ({
				...toResourcePathEntry(resolved, path),
				source: "package" as const,
			})),
		),
		systemPrompts: conventionPackages.flatMap((resolved) =>
			resolved.package.systemPromptPath ? [toResourcePathEntry(resolved, resolved.package.systemPromptPath)] : [],
		),
		toolRules: conventionPackages.flatMap((resolved) =>
			resolved.package.toolRulesPath ? [toResourcePathEntry(resolved, resolved.package.toolRulesPath)] : [],
		),
	};
}

type ResourcePrecedenceDirection = "high-to-low" | "low-to-high";

function sortResolvedPackages(
	packages: ResolvedTakumiPackage[],
	direction: ResourcePrecedenceDirection,
): ResolvedTakumiPackage[] {
	return packages.slice().sort((left, right) => {
		const rankDiff =
			direction === "high-to-low"
				? right.precedence.sourceRank - left.precedence.sourceRank
				: left.precedence.sourceRank - right.precedence.sourceRank;
		if (rankDiff !== 0) {
			return rankDiff;
		}

		const rootDiff = left.package.rootPath.localeCompare(right.package.rootPath);
		if (rootDiff !== 0) {
			return rootDiff;
		}

		return left.package.packageName.localeCompare(right.package.packageName);
	});
}

function toResourcePathEntry(resolved: ResolvedTakumiPackage, path: string): PackageResourcePathEntry {
	return {
		packageId: resolved.packageId,
		packageName: resolved.package.packageName,
		rootPath: resolved.package.rootPath,
		source: resolved.package.source,
		path,
	};
}
