import type { LoadedTakumiPackage } from "@takumi/agent";
import { discoverTakumiPackages } from "@takumi/agent";
import type { TakumiConfig } from "@takumi/core";

/**
 * I describe the read-only package inspection snapshot the TUI can render.
 */
export interface PackageInspection {
	packages: LoadedTakumiPackage[];
	errors: Array<{ path: string; error: string }>;
}

/**
 * I inspect the configured Takumi package roots from the current runtime config.
 */
export function inspectTakumiPackages(config: TakumiConfig): PackageInspection {
	const configuredPaths = config.packages?.map((entry) => entry.name) ?? [];
	const cwd = config.workingDirectory || process.cwd();
	const result = discoverTakumiPackages(configuredPaths, cwd);
	return {
		packages: result.packages.slice().sort((left, right) => left.packageName.localeCompare(right.packageName)),
		errors: [...result.errors].sort((left, right) => left.path.localeCompare(right.path)),
	};
}

/**
 * I format the high-level package inspection counts.
 */
export function formatPackageSummary(inspection: PackageInspection): string {
	const warningCount = inspection.packages.filter((pkg) => pkg.warnings.length > 0).length;
	return [
		`Packages: ${inspection.packages.length}`,
		`Warnings: ${warningCount}`,
		`Errors: ${inspection.errors.length}`,
	].join("\n");
}

/**
 * I format the default package list view for operators.
 */
export function formatPackageList(inspection: PackageInspection): string {
	if (inspection.packages.length === 0 && inspection.errors.length === 0) {
		return "No Takumi packages are discovered.";
	}
	return [
		formatPackageSummary(inspection),
		"",
		...inspection.packages.map((pkg, index) => formatPackageHeadline(pkg, index)),
		...formatPackageErrors(inspection.errors),
		"",
		"Use /packages show <index|name|path> for details.",
	]
		.filter((line, index, lines) => line.length > 0 || (index > 0 && lines[index - 1] !== ""))
		.join("\n");
}

/**
 * I format the detail view for one selected package.
 */
export function formatPackageDetail(pkg: LoadedTakumiPackage): string {
	const lines = [
		`${pkg.packageName}${pkg.version ? `@${pkg.version}` : ""}`,
		`Source: ${pkg.source}/${pkg.governance.provenance}`,
		`Root: ${pkg.rootPath}`,
		`Manifest: ${pkg.manifestPath}`,
	];
	if (pkg.description) {
		lines.push(`Description: ${pkg.description}`);
	}
	if (pkg.governance.maintainer) {
		lines.push(`Maintainer: ${pkg.governance.maintainer}`);
	}
	lines.push(
		`Resources: extensions=${pkg.extensions.length}, skills=${pkg.skillPaths.length}, systemPrompt=${pkg.systemPromptPath ? "yes" : "no"}, toolRules=${pkg.toolRulesPath ? "yes" : "no"}`,
		`Capabilities: ${pkg.governance.capabilitiesRequested.length > 0 ? pkg.governance.capabilitiesRequested.join(", ") : "none"}`,
		`Compatibility: takumi=${pkg.governance.compatibility.takumi ?? "unspecified"}, packageApi=${pkg.governance.compatibility.packageApi ?? "unspecified"}`,
		`Evals: coverage=${pkg.governance.evals.coverage?.join(", ") || "none"}, score=${pkg.governance.evals.score ?? "n/a"}, suite=${pkg.governance.evals.suite ?? "n/a"}`,
	);
	if (pkg.extensions.length > 0) {
		lines.push("Declared extensions:");
		for (const extensionPath of pkg.extensions) {
			lines.push(`- ${extensionPath}`);
		}
	}
	if (pkg.skillPaths.length > 0) {
		lines.push("Declared skills:");
		for (const skillPath of pkg.skillPaths) {
			lines.push(`- ${skillPath}`);
		}
	}
	if (pkg.systemPromptPath) {
		lines.push(`System prompt: ${pkg.systemPromptPath}`);
	}
	if (pkg.toolRulesPath) {
		lines.push(`Tool rules: ${pkg.toolRulesPath}`);
	}
	if (pkg.warnings.length > 0) {
		lines.push("Warnings:");
		for (const warning of pkg.warnings) {
			lines.push(`- ${warning}`);
		}
	}
	return lines.join("\n");
}

/**
 * I pick one package by index, name, or path from the inspection result.
 */
export function selectTakumiPackage(inspection: PackageInspection, selector: string): LoadedTakumiPackage | null {
	if (!selector) {
		return null;
	}
	const index = Number.parseInt(selector, 10);
	if (Number.isInteger(index) && index > 0) {
		return inspection.packages[index - 1] ?? null;
	}

	// I match against the most useful operator-facing identifiers first.
	const normalized = selector.trim().toLowerCase();
	return (
		inspection.packages.find((pkg) =>
			[pkg.packageName, pkg.rootPath, pkg.manifestPath].some((value) => value.toLowerCase().includes(normalized)),
		) ?? null
	);
}

/**
 * I format one compact package list entry.
 */
function formatPackageHeadline(pkg: LoadedTakumiPackage, index: number): string {
	const warningSuffix = pkg.warnings.length > 0 ? ` · warnings:${pkg.warnings.length}` : "";
	const description = pkg.description ? `\n   ${pkg.description}` : "";
	return (
		`${index + 1}. ${pkg.packageName}${pkg.version ? `@${pkg.version}` : ""} ` +
		`[${pkg.source}/${pkg.governance.provenance}] ext:${pkg.extensions.length} skills:${pkg.skillPaths.length}${warningSuffix}` +
		description
	);
}

/**
 * I format package discovery errors without pretending they are package rows.
 */
function formatPackageErrors(errors: PackageInspection["errors"]): string[] {
	if (errors.length === 0) {
		return [];
	}
	return ["", "Discovery errors:", ...errors.map((error) => `- ${error.path}: ${error.error}`)];
}
