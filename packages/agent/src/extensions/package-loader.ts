import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { createLogger } from "@takumi/core";
import { discoverManifestPackageRoots } from "./package-loader-project.js";

const log = createLogger("package-loader");

export type TakumiPackageSource = "workspace" | "dependency" | "project" | "global" | "configured";

export type TakumiPackageProvenance = "builtin" | "verified" | "community" | "local";

export interface TakumiPackageCompatibility {
	takumi?: string;
	packageApi?: string;
}

export interface TakumiPackageEvals {
	coverage?: string[];
	score?: number;
	suite?: string;
}

interface TakumiPackageManifest {
	description?: string;
	extensions?: string[];
	skills?: string[];
	systemPrompt?: string;
	toolRules?: string;
	provenance?: TakumiPackageProvenance;
	capabilitiesRequested?: string[];
	compatibility?: TakumiPackageCompatibility;
	evals?: TakumiPackageEvals;
	maintainer?: string;
}

export interface TakumiPackageResources {
	extensions: string[];
	skills: string[];
	systemPrompt?: string;
	toolRules?: string;
}

export interface TakumiPackageGovernance {
	provenance: TakumiPackageProvenance;
	capabilitiesRequested: string[];
	compatibility: TakumiPackageCompatibility;
	evals: TakumiPackageEvals;
	maintainer?: string;
}

export interface LoadedTakumiPackage {
	rootPath: string;
	manifestPath: string;
	packageName: string;
	description?: string;
	version?: string;
	source: TakumiPackageSource;
	resources: TakumiPackageResources;
	governance: TakumiPackageGovernance;
	extensions: string[];
	skillPaths: string[];
	systemPromptPath: string | null;
	toolRulesPath: string | null;
	warnings: string[];
}

export interface LoadTakumiPackagesResult {
	packages: LoadedTakumiPackage[];
	errors: Array<{ path: string; error: string }>;
}

function globalPackagesDir(): string {
	return join(homedir(), ".config", "takumi", "packages");
}

function localPackagesDir(cwd: string): string {
	return join(cwd, ".takumi", "packages");
}

function resolvePathFrom(baseDir: string, target: string): string {
	const expanded = target.startsWith("~/") ? join(homedir(), target.slice(2)) : target;
	return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
}

function readJson(filePath: string): unknown {
	return JSON.parse(readFileSync(filePath, "utf-8"));
}

function toStringArray(values: unknown): string[] {
	return Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : [];
}

function toOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function toCompatibility(value: unknown): TakumiPackageCompatibility {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	const compatibility = value as Record<string, unknown>;
	return {
		takumi: toOptionalString(compatibility.takumi),
		packageApi: toOptionalString(compatibility.packageApi),
	};
}

function toEvals(value: unknown): TakumiPackageEvals {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	const evals = value as Record<string, unknown>;
	const score = typeof evals.score === "number" && Number.isFinite(evals.score) ? evals.score : undefined;
	return {
		coverage: toStringArray(evals.coverage),
		score,
		suite: toOptionalString(evals.suite),
	};
}

function inferProvenance(value: unknown, source: TakumiPackageSource): TakumiPackageProvenance {
	if (value === "builtin" || value === "verified" || value === "community" || value === "local") {
		return value;
	}
	return source === "global" || source === "dependency" ? "community" : "local";
}

function addGovernanceWarnings(
	warnings: string[],
	governance: TakumiPackageGovernance,
	resources: TakumiPackageResources,
): void {
	const requested = governance.capabilitiesRequested;
	const privileged = requested.filter((capability) =>
		/write|execute|network|mcp|shell|auth|route|daemon/i.test(capability),
	);
	if (privileged.length > 0 && governance.provenance !== "builtin" && governance.provenance !== "verified") {
		warnings.push(`Unverified package requests privileged capabilities: ${privileged.join(", ")}`);
	}

	const hasExecutableSurface = resources.extensions.length > 0;
	if (hasExecutableSurface && (governance.evals.coverage?.length ?? 0) === 0) {
		warnings.push("Executable package has no eval coverage metadata");
	}

	if (!governance.compatibility.takumi) {
		warnings.push("Package does not declare takumi compatibility");
	}
	if (!governance.compatibility.packageApi) {
		warnings.push("Package does not declare package API compatibility");
	}
}

function resolvePaths(baseDir: string, values: string[] | undefined): { resolved: string[]; missing: string[] } {
	if (!values) return { resolved: [], missing: [] };
	const resolved: string[] = [];
	const missing: string[] = [];
	for (const value of values) {
		const target = resolvePathFrom(baseDir, value);
		if (existsSync(target)) {
			resolved.push(target);
		} else {
			missing.push(value);
		}
	}
	return { resolved, missing };
}

function resolveFilePath(
	baseDir: string,
	value: string | undefined,
): { resolved: string | null; missing: string | null } {
	if (!value) return { resolved: null, missing: null };
	const resolved = resolvePathFrom(baseDir, value);
	return existsSync(resolved) ? { resolved, missing: null } : { resolved: null, missing: value };
}

function parsePackage(rootPath: string, source: TakumiPackageSource): LoadedTakumiPackage | null {
	const manifestPath = join(rootPath, "package.json");
	if (!existsSync(manifestPath)) {
		return null;
	}

	try {
		const parsed = readJson(manifestPath) as {
			name?: string;
			description?: string;
			version?: string;
			takumi?: TakumiPackageManifest;
		};
		if (!parsed?.takumi || typeof parsed.takumi !== "object") {
			return null;
		}

		const warnings: string[] = [];
		const governance: TakumiPackageGovernance = {
			provenance: inferProvenance(parsed.takumi.provenance, source),
			capabilitiesRequested: toStringArray(parsed.takumi.capabilitiesRequested),
			compatibility: toCompatibility(parsed.takumi.compatibility),
			evals: toEvals(parsed.takumi.evals),
			maintainer: toOptionalString(parsed.takumi.maintainer),
		};
		const resources: TakumiPackageResources = {
			extensions: parsed.takumi.extensions ?? [],
			skills: parsed.takumi.skills ?? [],
			systemPrompt: parsed.takumi.systemPrompt,
			toolRules: parsed.takumi.toolRules,
		};
		const extensions = resolvePaths(rootPath, parsed.takumi.extensions);
		const skills = resolvePaths(rootPath, parsed.takumi.skills);
		const systemPromptPath = resolveFilePath(rootPath, parsed.takumi.systemPrompt);
		const toolRulesPath = resolveFilePath(rootPath, parsed.takumi.toolRules);
		for (const missing of extensions.missing) {
			warnings.push(`Missing extension entry: ${missing}`);
		}
		for (const missing of skills.missing) {
			warnings.push(`Missing skill path: ${missing}`);
		}
		if (systemPromptPath.missing) {
			warnings.push(`Missing system prompt: ${systemPromptPath.missing}`);
		}
		if (toolRulesPath.missing) {
			warnings.push(`Missing tool rules: ${toolRulesPath.missing}`);
		}
		addGovernanceWarnings(warnings, governance, resources);

		return {
			rootPath,
			manifestPath,
			packageName: parsed.name || basename(rootPath),
			description: parsed.description,
			version: parsed.version,
			source,
			resources,
			governance,
			extensions: extensions.resolved,
			skillPaths: skills.resolved,
			systemPromptPath: systemPromptPath.resolved,
			toolRulesPath: toolRulesPath.resolved,
			warnings,
		};
	} catch (err) {
		throw new Error(`Failed to parse package manifest: ${(err as Error).message}`);
	}
}

function discoverPackageRoots(collectionDir: string): string[] {
	if (!existsSync(collectionDir)) {
		return [];
	}

	try {
		return readdirSync(collectionDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => join(collectionDir, entry.name));
	} catch {
		return [];
	}
}

function addPackage(result: LoadTakumiPackagesResult, seen: Set<string>, pkg: LoadedTakumiPackage | null): void {
	if (!pkg || seen.has(pkg.rootPath)) {
		return;
	}
	seen.add(pkg.rootPath);
	result.packages.push(pkg);
	log.info(`Discovered Takumi package: ${pkg.packageName} (${pkg.source})`);
}

function tryLoadPackage(
	result: LoadTakumiPackagesResult,
	seen: Set<string>,
	rootPath: string,
	source: TakumiPackageSource,
	required: boolean,
): void {
	try {
		const pkg = parsePackage(rootPath, source);
		if (!pkg) {
			if (required) {
				result.errors.push({ path: rootPath, error: "Not a Takumi package (missing package.json takumi manifest)" });
			}
			return;
		}
		addPackage(result, seen, pkg);
	} catch (err) {
		result.errors.push({
			path: rootPath,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

export function discoverTakumiPackages(configuredPaths: string[], cwd: string): LoadTakumiPackagesResult {
	const result: LoadTakumiPackagesResult = { packages: [], errors: [] };
	const seen = new Set<string>();

	// Workspace and dependency manifests are the Pi-style pluggable path: install
	// a Takumi-aware package and let normal startup discover it automatically.
	for (const discovered of discoverManifestPackageRoots(cwd)) {
		tryLoadPackage(result, seen, discovered.rootPath, discovered.source, false);
	}

	for (const rootPath of discoverPackageRoots(localPackagesDir(cwd))) {
		tryLoadPackage(result, seen, rootPath, "project", false);
	}

	for (const rootPath of discoverPackageRoots(globalPackagesDir())) {
		tryLoadPackage(result, seen, rootPath, "global", false);
	}

	for (const configuredPath of configuredPaths) {
		const resolved = resolvePathFrom(cwd, configuredPath);
		if (!existsSync(resolved)) {
			result.errors.push({ path: configuredPath, error: "Configured package path does not exist" });
			continue;
		}

		if (statSync(resolved).isDirectory() && existsSync(join(resolved, "package.json"))) {
			tryLoadPackage(result, seen, resolved, "configured", true);
			continue;
		}

		if (statSync(resolved).isDirectory()) {
			const before = result.packages.length;
			for (const rootPath of discoverPackageRoots(resolved)) {
				tryLoadPackage(result, seen, rootPath, "configured", false);
			}
			if (result.packages.length === before) {
				result.errors.push({ path: configuredPath, error: "No Takumi packages found in configured directory" });
			}
			continue;
		}

		result.errors.push({ path: configuredPath, error: "Configured package path must be a directory" });
	}

	return result;
}
