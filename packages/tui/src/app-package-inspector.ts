import type { LoadedTakumiPackage, PackageDoctorReport, PackageInspection, PackageListView } from "@takumi/agent";
import {
	buildPackageDoctorReport,
	formatPackageDetails as formatSharedPackageDetails,
	inspectTakumiPackages as inspectSharedTakumiPackages,
	selectTakumiPackage as selectSharedTakumiPackage,
} from "@takumi/agent";
import type { TakumiConfig } from "@takumi/core";

/**
 * I inspect the configured Takumi package roots from the current runtime config.
 */
export function inspectTakumiPackages(config: TakumiConfig): PackageInspection {
	return inspectSharedTakumiPackages(config);
}

/**
 * I format the high-level package inspection counts.
 */
export function formatPackageSummary(inspection: PackageInspection): string {
	const report = buildPackageDoctorReport(inspection);
	return formatPackageSummaryReport(report);
}

function formatPackageSummaryReport(report: PackageDoctorReport): string {
	return [
		`Packages: ${report.total}`,
		`Ready: ${report.ready}`,
		`Degraded: ${report.degraded}`,
		`Rejected: ${report.rejected}`,
	].join("\n");
}

/**
 * I format the default package list view for operators.
 */
export function formatPackageList(inspection: PackageInspection): string {
	const report = buildPackageDoctorReport(inspection);
	if (report.total === 0 && report.rejected === 0) {
		return "No Takumi packages are discovered.";
	}
	return [
		formatPackageSummaryReport(report),
		"",
		...report.packages.map((pkg, index) => formatPackageHeadline(pkg, index)),
		...formatPackageErrors(report.rejectedEntries),
		"",
		"Use /packages show <index|name|path> for details.",
	]
		.filter((line, index, lines) => line.length > 0 || (index > 0 && lines[index - 1] !== ""))
		.join("\n");
}

/**
 * I format the detail view for one selected package.
 */
export function formatPackageDetail(pkg: LoadedTakumiPackage, inspection?: PackageInspection): string {
	return formatSharedPackageDetails(pkg, inspection);
}

/**
 * I pick one package by index, name, or path from the inspection result.
 */
export function selectTakumiPackage(inspection: PackageInspection, selector: string): LoadedTakumiPackage | null {
	return selectSharedTakumiPackage(inspection, selector);
}

/**
 * I format one compact package list entry.
 */
function formatPackageHeadline(pkg: PackageListView, index: number): string {
	const diagnosticSuffix = pkg.diagnostics.length > 0 ? ` · diagnostics:${pkg.diagnostics.length}` : "";
	const description = pkg.description ? `\n   ${pkg.description}` : "";
	return (
		`${index + 1}. ${pkg.name}${pkg.version ? `@${pkg.version}` : ""} ` +
		`[${pkg.state}] ${pkg.source}/${pkg.provenance} ext:${pkg.resources.extensions} skills:${pkg.resources.skills}${diagnosticSuffix}` +
		description
	);
}

/**
 * I format package discovery errors without pretending they are package rows.
 */
function formatPackageErrors(errors: PackageDoctorReport["rejectedEntries"]): string[] {
	if (errors.length === 0) {
		return [];
	}
	return ["", "Rejected:", ...errors.map((error) => `- ${error.path}: ${error.error}`)];
}
