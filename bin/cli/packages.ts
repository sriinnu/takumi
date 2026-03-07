import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { LoadedTakumiPackage } from "@takumi/agent";
import { discoverTakumiPackages } from "@takumi/agent";
import type { TakumiConfig } from "@takumi/core";

export interface PackageListView {
	name: string;
	version: string;
	source: string;
	provenance: string;
	rootPath: string;
	description: string | null;
	maintainer: string | null;
	warnings: string[];
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

export interface PackageDoctorReport {
	total: number;
	ready: number;
	warning: number;
	errors: Array<{ path: string; error: string }>;
	packages: PackageListView[];
}

function configuredPackagePaths(config: TakumiConfig): string[] {
	return config.packages?.map((entry) => entry.name) ?? [];
}

function loadPackages(config: TakumiConfig): ReturnType<typeof discoverTakumiPackages> {
	return discoverTakumiPackages(configuredPackagePaths(config), process.cwd());
}

export function toPackageListView(pkg: LoadedTakumiPackage): PackageListView {
	return {
		name: pkg.packageName,
		version: pkg.version ?? "0.0.0",
		source: pkg.source,
		provenance: pkg.governance.provenance,
		rootPath: pkg.rootPath,
		description: pkg.description ?? null,
		maintainer: pkg.governance.maintainer ?? null,
		warnings: [...pkg.warnings],
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

export function buildPackageDoctorReport(result: ReturnType<typeof discoverTakumiPackages>): PackageDoctorReport {
	const packages = result.packages.map(toPackageListView).sort((left, right) => left.name.localeCompare(right.name));
	const warning = packages.filter((pkg) => pkg.warnings.length > 0).length;
	return {
		total: packages.length,
		ready: packages.length - warning,
		warning,
		errors: [...result.errors],
		packages,
	};
}

export function formatPackageDoctorReport(report: PackageDoctorReport): string {
	const lines = [
		"Takumi Packages",
		"",
		`Discovered: ${report.total}`,
		`Ready:      ${report.ready}`,
		`Warnings:   ${report.warning}`,
		`Errors:     ${report.errors.length}`,
	];

	if (report.packages.length > 0) {
		lines.push("", "Packages:");
		for (const pkg of report.packages) {
			const status = pkg.warnings.length > 0 ? "warn" : "ready";
			lines.push(
				`  - ${pkg.name}@${pkg.version} [${status}] ${pkg.source}/${pkg.provenance} · ext ${pkg.resources.extensions} · skills ${pkg.resources.skills}`,
			);
			if (pkg.description) {
				lines.push(`    ${pkg.description}`);
			}
			if (pkg.capabilitiesRequested.length > 0) {
				lines.push(`    capabilities: ${pkg.capabilitiesRequested.join(", ")}`);
			}
			for (const warning of pkg.warnings) {
				lines.push(`    warning: ${warning}`);
			}
		}
	}

	if (report.errors.length > 0) {
		lines.push("", "Errors:");
		for (const error of report.errors) {
			lines.push(`  - ${error.path}: ${error.error}`);
		}
	}

	return lines.join("\n");
}

export function findPackage(packages: LoadedTakumiPackage[], query: string): LoadedTakumiPackage | null {
	const normalized = query.trim().toLowerCase();
	return (
		packages.find((pkg) => pkg.packageName.toLowerCase() === normalized) ??
		packages.find((pkg) => pkg.packageName.split("/").pop()?.toLowerCase() === normalized) ??
		packages.find((pkg) => pkg.rootPath.toLowerCase() === normalized) ??
		null
	);
}

export function formatPackageDetails(pkg: LoadedTakumiPackage): string {
	const lines = [
		`${pkg.packageName}${pkg.version ? `@${pkg.version}` : ""}`,
		`Source: ${pkg.source}`,
		`Root:   ${pkg.rootPath}`,
	];
	if (pkg.description) {
		lines.push(`About:  ${pkg.description}`);
	}
	lines.push(`Trust:  ${pkg.governance.provenance}`);
	if (pkg.governance.maintainer) {
		lines.push(`Owner:  ${pkg.governance.maintainer}`);
	}
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
	if (pkg.warnings.length > 0) {
		lines.push("Warnings:");
		for (const warning of pkg.warnings) lines.push(`  - ${warning}`);
	}
	return lines.join("\n");
}

function slugifyPackageName(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/^@takumi\//, "")
		.split(/[\\/]+/)
		.map((segment) => segment.replace(/[^a-z0-9-_.]+/g, "-").replace(/^\.+|\.+$/g, ""))
		.filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
		.join("-");
}

export async function scaffoldPackage(name: string, cwd = process.cwd()): Promise<string> {
	const slug = slugifyPackageName(name);
	if (!slug) {
		throw new Error("Package name must contain at least one alphanumeric character");
	}
	const packagesRoot = resolve(cwd, ".takumi", "packages");
	const rootPath = resolve(packagesRoot, slug);
	if (rootPath !== packagesRoot && !rootPath.startsWith(`${packagesRoot}${sep}`)) {
		throw new Error("Package name resolves outside the local Takumi packages directory");
	}
	if (existsSync(rootPath)) {
		throw new Error(`Package already exists: ${rootPath}`);
	}

	await mkdir(join(rootPath, "skills"), { recursive: true });
	await writeFile(
		join(rootPath, "package.json"),
		JSON.stringify(
			{
				name: slug.startsWith("@takumi/") ? slug : `@takumi/${slug.replace(/^\//, "")}`,
				version: "0.1.0",
				description: "Takumi workflow package",
				takumi: {
					extensions: ["./index.mjs"],
					skills: ["./skills"],
					systemPrompt: "./system-prompt.md",
					toolRules: "./tool-rules.json",
					provenance: "local",
					capabilitiesRequested: ["workflow.review"],
					compatibility: {
						takumi: "^0.1.0",
						packageApi: "1",
					},
					evals: {
						coverage: ["smoke", "doctor"],
						suite: "local-smoke",
					},
					maintainer: "your-team",
				},
			},
			null,
			2,
		),
		"utf-8",
	);
	await writeFile(
		join(rootPath, "index.mjs"),
		[
			"export default function packageExtension(api) {",
			"\tapi.registerCommand('package:hello', {",
			"\t\tdescription: 'Example package command',",
			"\t\thandler: async () => {},",
			"\t});",
			"}",
		].join("\n"),
		"utf-8",
	);
	await writeFile(join(rootPath, "system-prompt.md"), "Describe how this package should influence Takumi.\n", "utf-8");
	await writeFile(join(rootPath, "tool-rules.json"), "[]\n", "utf-8");
	await writeFile(
		join(rootPath, "skills", "package-skill.md"),
		[
			"---",
			"name: Package Skill",
			"description: Guidance bundled with this Takumi package",
			"tags: package,workflow",
			"---",
			"Use this skill to steer package-specific review and workflow behavior.",
		].join("\n"),
		"utf-8",
	);
	return rootPath;
}

export async function cmdPackage(
	config: TakumiConfig,
	action = "list",
	args: string[] = [],
	asJson = false,
): Promise<void> {
	if (action === "scaffold" || action === "init" || action === "new") {
		const name = args[0];
		if (!name) {
			console.error("Usage: takumi package scaffold <name>");
			process.exit(1);
		}
		const rootPath = await scaffoldPackage(name);
		if (asJson) {
			console.log(JSON.stringify({ created: true, rootPath }, null, 2));
			return;
		}
		console.log(`Created package scaffold: ${rootPath}`);
		return;
	}

	const result = loadPackages(config);
	if (action === "doctor" || action === "validate") {
		const report = buildPackageDoctorReport(result);
		if (asJson) {
			console.log(JSON.stringify(report, null, 2));
			return;
		}
		console.log(formatPackageDoctorReport(report));
		return;
	}

	if (action === "inspect" || action === "show" || action === "status") {
		const query = args[0];
		if (!query) {
			console.error("Usage: takumi package inspect <name>");
			process.exit(1);
		}
		const pkg = findPackage(result.packages, query);
		if (!pkg) {
			console.error(`Package not found: ${query}`);
			process.exit(1);
		}
		if (asJson) {
			console.log(JSON.stringify(pkg, null, 2));
			return;
		}
		console.log(formatPackageDetails(pkg));
		return;
	}

	const packages = result.packages.map(toPackageListView).sort((left, right) => left.name.localeCompare(right.name));
	if (asJson) {
		console.log(JSON.stringify({ packages, errors: result.errors }, null, 2));
		return;
	}
	if (packages.length === 0) {
		console.log("No Takumi packages discovered.");
		if (result.errors.length > 0) {
			for (const error of result.errors) console.log(`- ${error.path}: ${error.error}`);
		}
		return;
	}
	console.log(`\nTakumi packages (${packages.length}):\n`);
	for (const pkg of packages) {
		const warningSuffix = pkg.warnings.length > 0 ? ` · ${pkg.warnings.length} warning(s)` : "";
		console.log(`  ${pkg.name}@${pkg.version} [${pkg.source}/${pkg.provenance}]${warningSuffix}`);
		console.log(`    Root:        ${pkg.rootPath}`);
		console.log(`    Resources:   ext ${pkg.resources.extensions} · skills ${pkg.resources.skills} · prompt ${pkg.resources.systemPrompt ? "yes" : "no"} · rules ${pkg.resources.toolRules ? "yes" : "no"}`);
		if (pkg.capabilitiesRequested.length > 0) {
			console.log(`    Capabilities:${pkg.capabilitiesRequested.join(", ")}`);
		}
		if (pkg.compatibility.takumi || pkg.compatibility.packageApi) {
			console.log(`    Compat:      takumi ${pkg.compatibility.takumi ?? "unspecified"} · api ${pkg.compatibility.packageApi ?? "unspecified"}`);
		}
		if (pkg.description) {
			console.log(`    Description: ${pkg.description}`);
		}
		if (pkg.maintainer) {
			console.log(`    Maintainer:  ${pkg.maintainer}`);
		}
		console.log();
	}
	if (result.errors.length > 0) {
		console.log("Errors:");
		for (const error of result.errors) console.log(`  - ${error.path}: ${error.error}`);
	}
}
