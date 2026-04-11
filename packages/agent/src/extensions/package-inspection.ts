import type { TakumiConfig } from "@takumi/core";
import type { LoadedTakumiPackage } from "./package-loader.js";
import type { PackageResolverConflict, PackageResolverReport } from "./package-resolver.js";
import { resolveTakumiPackageGraph } from "./package-resolver.js";

export type PackageState = "ready" | "degraded" | "rejected";

export interface PackageDiagnosticView {
	kind: "warning" | PackageResolverConflict["kind"];
	severity: "warning" | "error";
	message: string;
}

export interface PackageRejectedEntry {
	state: "rejected";
	path: string;
	error: string;
}

/**
 * Shared package inspection snapshot used by CLI and TUI surfaces.
 */
export interface PackageInspection {
	packages: LoadedTakumiPackage[];
	shadowedPackages: LoadedTakumiPackage[];
	conflicts: PackageResolverConflict[];
	errors: Array<{ path: string; error: string }>;
}

/**
 * Compact view model for tabular package diagnostics.
 */
export interface PackageListView {
	name: string;
	version: string;
	state: Exclude<PackageState, "rejected">;
	source: string;
	provenance: string;
	rootPath: string;
	description: string | null;
	maintainer: string | null;
	warnings: string[];
	diagnostics: PackageDiagnosticView[];
	capabilitiesRequested: string[];
	compatibility: {
		takumi: string | null;
		packageApi: string | null;
	};
	evals: {
		coverage: string[];
		score: number | null;
		suite: string | null;
	};
	resources: {
		extensions: number;
		skills: number;
		systemPrompt: boolean;
		toolRules: boolean;
	};
}

/**
 * Doctor-style aggregate view over discovered packages.
 */
export interface PackageDoctorReport {
	total: number;
	ready: number;
	degraded: number;
	rejected: number;
	warning: number;
	shadowed: number;
	conflicts: PackageResolverConflict[];
	errors: Array<{ path: string; error: string }>;
	rejectedEntries: PackageRejectedEntry[];
	packages: PackageListView[];
	shadowedPackages: PackageListView[];
}

/**
 * Project one resolver report into the shared package inspection shape.
 */
export function buildPackageInspection(report: PackageResolverReport): PackageInspection {
	return {
		packages: report.packages.slice().sort((left, right) => left.packageName.localeCompare(right.packageName)),
		shadowedPackages: report.shadowedPackages
			.slice()
			.sort((left, right) => left.packageName.localeCompare(right.packageName)),
		conflicts: [...report.conflicts],
		errors: [...report.errors].sort((left, right) => left.path.localeCompare(right.path)),
	};
}

/**
 * Discover Takumi packages from the current runtime config and return a stable,
 * operator-friendly snapshot.
 */
export function inspectTakumiPackages(config: Pick<TakumiConfig, "packages" | "workingDirectory">): PackageInspection {
	return buildPackageInspection(resolveTakumiPackageGraph(config));
}

function getPackageConflicts(
	conflicts: PackageResolverConflict[],
	pkg: LoadedTakumiPackage,
): PackageResolverConflict[] {
	return conflicts.filter(
		(conflict) => conflict.winner.rootPath === pkg.rootPath && conflict.winner.packageName === pkg.packageName,
	);
}

function toPackageDiagnostics(pkg: LoadedTakumiPackage, conflicts: PackageResolverConflict[]): PackageDiagnosticView[] {
	return [
		...pkg.warnings.map((message) => ({ kind: "warning", severity: "warning", message }) as PackageDiagnosticView),
		...conflicts.map(
			(conflict) =>
				({ kind: conflict.kind, severity: conflict.severity, message: conflict.message }) as PackageDiagnosticView,
		),
	];
}

function toRejectedEntries(errors: Array<{ path: string; error: string }>): PackageRejectedEntry[] {
	return errors.map((error) => ({ state: "rejected", ...error }));
}

export function toPackageListView(
	pkg: LoadedTakumiPackage,
	conflicts: PackageResolverConflict[] = [],
): PackageListView {
	const diagnostics = toPackageDiagnostics(pkg, conflicts);
	return {
		name: pkg.packageName,
		version: pkg.version ?? "0.0.0",
		state: diagnostics.length > 0 ? "degraded" : "ready",
		source: pkg.source,
		provenance: pkg.governance.provenance,
		rootPath: pkg.rootPath,
		description: pkg.description ?? null,
		maintainer: pkg.governance.maintainer ?? null,
		warnings: [...pkg.warnings],
		diagnostics,
		capabilitiesRequested: [...pkg.governance.capabilitiesRequested],
		compatibility: {
			takumi: pkg.governance.compatibility.takumi ?? null,
			packageApi: pkg.governance.compatibility.packageApi ?? null,
		},
		evals: {
			coverage: [...(pkg.governance.evals.coverage ?? [])],
			score: pkg.governance.evals.score ?? null,
			suite: pkg.governance.evals.suite ?? null,
		},
		resources: {
			extensions: pkg.extensions.length,
			skills: pkg.skillPaths.length,
			systemPrompt: Boolean(pkg.systemPromptPath),
			toolRules: Boolean(pkg.toolRulesPath),
		},
	};
}

export function buildPackageDoctorReport(inspection: PackageInspection): PackageDoctorReport {
	const packages = inspection.packages
		.map((pkg) => toPackageListView(pkg, getPackageConflicts(inspection.conflicts, pkg)))
		.sort((left, right) => left.name.localeCompare(right.name));
	const shadowedPackages = (inspection.shadowedPackages ?? [])
		.map((pkg) => toPackageListView(pkg))
		.sort((left, right) => left.name.localeCompare(right.name));
	const degraded = packages.filter((pkg) => pkg.state === "degraded").length;
	const rejectedEntries = toRejectedEntries(inspection.errors);
	return {
		total: packages.length,
		ready: packages.length - degraded,
		degraded,
		rejected: rejectedEntries.length,
		warning: degraded,
		shadowed: shadowedPackages.length,
		conflicts: [...(inspection.conflicts ?? [])],
		errors: [...inspection.errors],
		rejectedEntries,
		packages,
		shadowedPackages,
	};
}

export function formatPackageDoctorReport(report: PackageDoctorReport): string {
	const lines = [
		"Takumi Packages",
		"",
		`Discovered: ${report.total}`,
		`Ready:      ${report.ready}`,
		`Degraded:  ${report.degraded}`,
		`Rejected:  ${report.rejected}`,
		`Shadowed:   ${report.shadowed}`,
		`Conflicts:  ${report.conflicts.length}`,
	];

	if (report.packages.length > 0) {
		lines.push("", "Packages:");
		for (const pkg of report.packages) {
			lines.push(
				`  - ${pkg.name}@${pkg.version} [${pkg.state}] ${pkg.source}/${pkg.provenance} · ext ${pkg.resources.extensions} · skills ${pkg.resources.skills}`,
			);
			if (pkg.description) lines.push(`    ${pkg.description}`);
			if (pkg.capabilitiesRequested.length > 0) {
				lines.push(`    capabilities: ${pkg.capabilitiesRequested.join(", ")}`);
			}
			for (const diagnostic of pkg.diagnostics) {
				const label = diagnostic.kind === "warning" ? "warning" : "diagnostic";
				lines.push(`    ${label}: ${diagnostic.message}`);
			}
		}
	}

	if (report.shadowedPackages.length > 0) {
		lines.push("", "Shadowed:");
		for (const pkg of report.shadowedPackages) {
			lines.push(`  - ${pkg.name}@${pkg.version} [shadowed] ${pkg.source}/${pkg.provenance}`);
			lines.push(`    Root: ${pkg.rootPath}`);
		}
	}

	if (report.conflicts.length > 0) {
		lines.push("", "Conflicts:");
		for (const conflict of report.conflicts) {
			lines.push(`  - [${conflict.kind}] ${conflict.message}`);
		}
	}

	if (report.rejectedEntries.length > 0) {
		lines.push("", "Rejected:");
		for (const error of report.rejectedEntries) {
			lines.push(`  - ${error.path}: ${error.error}`);
		}
	}

	return lines.join("\n");
}

/**
 * Select one discovered package by index, exact-ish name, or path.
 */
export function selectTakumiPackage(inspection: PackageInspection, selector: string): LoadedTakumiPackage | null {
	if (!selector) return null;
	const trimmed = selector.trim();
	if (/^[1-9]\d*$/.test(trimmed)) {
		const index = Number.parseInt(trimmed, 10);
		return inspection.packages[index - 1] ?? null;
	}
	return findPackage(inspection.packages, selector);
}

export function findPackage(packages: LoadedTakumiPackage[], query: string): LoadedTakumiPackage | null {
	const normalized = query.trim().toLowerCase();
	return (
		packages.find((pkg) => pkg.packageName.toLowerCase() === normalized) ??
		packages.find((pkg) => pkg.packageName.split("/").pop()?.toLowerCase() === normalized) ??
		packages.find((pkg) => pkg.rootPath.toLowerCase() === normalized) ??
		packages.find((pkg) => pkg.manifestPath.toLowerCase() === normalized) ??
		null
	);
}

export function formatPackageDetails(pkg: LoadedTakumiPackage, inspection?: PackageInspection): string {
	const conflicts = inspection ? getPackageConflicts(inspection.conflicts, pkg) : [];
	const view = toPackageListView(pkg, conflicts);
	const lines = [
		`${pkg.packageName}${pkg.version ? `@${pkg.version}` : ""}`,
		`State:  ${view.state}`,
		`Source: ${pkg.source}`,
		`Root:   ${pkg.rootPath}`,
	];
	if (pkg.description) lines.push(`About:  ${pkg.description}`);
	lines.push(`Trust:  ${pkg.governance.provenance}`);
	if (pkg.governance.maintainer) lines.push(`Owner:  ${pkg.governance.maintainer}`);
	lines.push(
		`Resources: extensions=${pkg.extensions.length}, skills=${pkg.skillPaths.length}, systemPrompt=${pkg.systemPromptPath ? "yes" : "no"}, toolRules=${pkg.toolRulesPath ? "yes" : "no"}`,
	);
	if (pkg.governance.capabilitiesRequested.length > 0) {
		lines.push(`Capabilities: ${pkg.governance.capabilitiesRequested.join(", ")}`);
	}
	if (pkg.governance.compatibility.takumi || pkg.governance.compatibility.packageApi) {
		lines.push(
			`Compatibility: takumi=${pkg.governance.compatibility.takumi ?? "unspecified"}, packageApi=${pkg.governance.compatibility.packageApi ?? "unspecified"}`,
		);
	}
	if (pkg.governance.evals.coverage?.length || pkg.governance.evals.score || pkg.governance.evals.suite) {
		lines.push(
			`Evals: coverage=${(pkg.governance.evals.coverage ?? []).join(", ") || "none"}, score=${pkg.governance.evals.score ?? "n/a"}, suite=${pkg.governance.evals.suite ?? "n/a"}`,
		);
	}
	if (pkg.resources.extensions.length > 0) {
		lines.push("Declared extensions:");
		for (const value of pkg.resources.extensions) lines.push(`  - ${value}`);
	}
	if (pkg.resources.skills.length > 0) {
		lines.push("Declared skills:");
		for (const value of pkg.resources.skills) lines.push(`  - ${value}`);
	}
	if (pkg.resources.systemPrompt) lines.push(`Declared system prompt: ${pkg.resources.systemPrompt}`);
	if (pkg.resources.toolRules) lines.push(`Declared tool rules: ${pkg.resources.toolRules}`);
	if (view.diagnostics.length > 0) {
		lines.push("Diagnostics:");
		for (const diagnostic of view.diagnostics) {
			lines.push(`  - [${diagnostic.kind}] ${diagnostic.message}`);
		}
	}
	return lines.join("\n");
}
