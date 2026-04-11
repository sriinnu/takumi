import type { TakumiConfig } from "@takumi/core";
import { discoverTakumiPackages } from "./package-loader.js";
import {
	getConfiguredTakumiPackagePaths,
	type PackageResolverReport,
	resolveTakumiPackageCandidates,
} from "./package-resolver.js";
import { buildPackageResourceViews, type PackageResourceViews } from "./package-resource-views.js";

/**
 * One shared package-runtime truth for startup and operator surfaces.
 */
export interface PackageRuntimeSnapshot {
	cwd: string;
	configuredPackagePaths: string[];
	report: PackageResolverReport;
	views: PackageResourceViews;
}

/**
 * Build the shared package-runtime snapshot from runtime config.
 */
export function buildPackageRuntimeSnapshot(
	config: Pick<TakumiConfig, "packages" | "workingDirectory">,
	cwd = config.workingDirectory || process.cwd(),
): PackageRuntimeSnapshot {
	const configuredPackagePaths = getConfiguredTakumiPackagePaths(config);
	return buildPackageRuntimeSnapshotFromPaths(cwd, configuredPackagePaths);
}

/**
 * Build the shared package-runtime snapshot from already-resolved config paths.
 */
export function buildPackageRuntimeSnapshotFromPaths(
	cwd: string,
	configuredPackagePaths: string[],
): PackageRuntimeSnapshot {
	const report = resolveTakumiPackageCandidates(discoverTakumiPackages(configuredPackagePaths, cwd));
	const views = buildPackageResourceViews(report);
	return {
		cwd,
		configuredPackagePaths: [...configuredPackagePaths],
		report,
		views,
	};
}
