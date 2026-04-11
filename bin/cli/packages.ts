import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import {
	buildPackageDoctorReport,
	findPackage,
	formatPackageDetails,
	formatPackageDoctorReport,
	inspectTakumiPackages,
	toPackageListView,
} from "@takumi/agent";
import type { LoadedTakumiPackage, PackageInspection, PackageListView } from "@takumi/agent";
import type { TakumiConfig } from "@takumi/core";

export { buildPackageDoctorReport, findPackage, formatPackageDetails, toPackageListView };

function loadPackageInspection(config: TakumiConfig): PackageInspection {
	return inspectTakumiPackages(config);
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

function globalPackagesDir(): string {
	return join(homedir(), ".config", "takumi", "packages");
}

async function installPackage(source: string): Promise<string> {
	const absSource = resolve(source);
	if (!existsSync(absSource)) {
		throw new Error(`Source not found: ${absSource}`);
	}
	const name = absSource.split(sep).pop() ?? "unknown";
	const dest = join(globalPackagesDir(), slugifyPackageName(name) ?? name);
	if (existsSync(dest)) throw new Error(`Package already installed: ${dest}`);
	const { cp } = await import("node:fs/promises");
	await cp(absSource, dest, { recursive: true });
	return dest;
}

async function removePackage(name: string, config: TakumiConfig): Promise<boolean> {
	const slug = slugifyPackageName(name) ?? name;
	const projectRoot = config.workingDirectory || process.cwd();
	const candidates = [
		join(globalPackagesDir(), slug),
		join(projectRoot, ".takumi", "packages", slug),
	];
	for (const dir of candidates) {
		if (existsSync(dir)) {
			await rm(dir, { recursive: true, force: true });
			return true;
		}
	}
	return false;
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

	if (action === "install" || action === "add") {
		const source = args[0];
		if (!source) {
			console.error("Usage: takumi package install <path>");
			process.exit(1);
		}
		const installed = await installPackage(source);
		if (asJson) {
			console.log(JSON.stringify({ installed: true, path: installed }, null, 2));
			return;
		}
		console.log(`Installed package to: ${installed}`);
		return;
	}

	if (action === "remove" || action === "uninstall" || action === "rm") {
		const name = args[0];
		if (!name) {
			console.error("Usage: takumi package remove <name>");
			process.exit(1);
		}
		const removed = await removePackage(name, config);
		if (asJson) {
			console.log(JSON.stringify({ removed, name }, null, 2));
			return;
		}
		if (removed) console.log(`Removed package: ${name}`);
		else console.error(`Package not found: ${name}`);
		return;
	}

	const inspection = loadPackageInspection(config);
	if (action === "doctor" || action === "validate") {
		const report = buildPackageDoctorReport(inspection);
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
		const pkg = findPackage(inspection.packages, query);
		if (!pkg) {
			console.error(`Package not found: ${query}`);
			process.exit(1);
		}
		if (asJson) {
			console.log(JSON.stringify(pkg, null, 2));
			return;
		}
		console.log(formatPackageDetails(pkg, inspection));
		return;
	}

	const report = buildPackageDoctorReport(inspection);
	const packages = report.packages;
	if (asJson) {
		console.log(
			JSON.stringify(
				{
					packages,
					ready: report.ready,
					degraded: report.degraded,
					rejected: report.rejected,
					shadowed: report.shadowed,
					conflicts: report.conflicts,
					rejectedEntries: report.rejectedEntries,
					errors: report.errors,
				},
				null,
				2,
			),
		);
		return;
	}
	if (packages.length === 0) {
		console.log("No Takumi packages discovered.");
		if (report.rejectedEntries.length > 0) {
			for (const error of report.rejectedEntries) console.log(`- ${error.path}: ${error.error}`);
		}
		return;
	}
	console.log(`\nTakumi packages (${packages.length}):\n`);
	for (const pkg of packages) {
		const diagnosticSuffix = pkg.diagnostics.length > 0 ? ` · ${pkg.diagnostics.length} diagnostic(s)` : "";
		console.log(`  ${pkg.name}@${pkg.version} [${pkg.state}] ${pkg.source}/${pkg.provenance}${diagnosticSuffix}`);
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
		for (const diagnostic of pkg.diagnostics) {
			console.log(`    Diagnostic:  ${diagnostic.message}`);
		}
		console.log();
	}
	if (report.rejectedEntries.length > 0) {
		console.log("Rejected:");
		for (const error of report.rejectedEntries) console.log(`  - ${error.path}: ${error.error}`);
	}
}
