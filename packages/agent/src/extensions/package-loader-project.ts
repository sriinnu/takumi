import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export interface ManifestPackageRoot {
	rootPath: string;
	source: "workspace" | "dependency";
}

interface RootPackageJson {
	takumi?: unknown;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
}

/**
 * Discover Takumi packages declared by the active workspace package.json.
 *
 * This gives Takumi Pi-style package pluggability: if the current workspace or
 * one of its direct dependencies exposes a `takumi` manifest, startup can find
 * it without forcing users to copy files into `.takumi/packages` first.
 */
export function discoverManifestPackageRoots(cwd: string): ManifestPackageRoot[] {
	const manifestPath = join(cwd, "package.json");
	const rootPackage = readRootPackageJson(manifestPath);
	if (!rootPackage) {
		return [];
	}

	const discovered: ManifestPackageRoot[] = [];
	const seen = new Set<string>();
	const add = (rootPath: string, source: ManifestPackageRoot["source"]): void => {
		if (seen.has(rootPath)) {
			return;
		}
		seen.add(rootPath);
		discovered.push({ rootPath, source });
	};

	if (hasTakumiManifest(rootPackage)) {
		add(cwd, "workspace");
	}

	const requireFromWorkspace = createRequire(manifestPath);
	for (const packageName of collectDependencyNames(rootPackage)) {
		const dependencyRoot = resolveDependencyRoot(requireFromWorkspace, packageName);
		if (!dependencyRoot) {
			continue;
		}
		const dependencyPackage = readRootPackageJson(join(dependencyRoot, "package.json"));
		if (!dependencyPackage || !hasTakumiManifest(dependencyPackage)) {
			continue;
		}
		add(dependencyRoot, "dependency");
	}

	return discovered;
}

function readRootPackageJson(filePath: string): RootPackageJson | null {
	if (!existsSync(filePath)) {
		return null;
	}

	try {
		return JSON.parse(readFileSync(filePath, "utf-8")) as RootPackageJson;
	} catch {
		return null;
	}
}

function hasTakumiManifest(pkg: RootPackageJson): boolean {
	return Boolean(pkg.takumi && typeof pkg.takumi === "object" && !Array.isArray(pkg.takumi));
}

function collectDependencyNames(pkg: RootPackageJson): string[] {
	return [
		...new Set([
			...Object.keys(pkg.dependencies ?? {}),
			...Object.keys(pkg.devDependencies ?? {}),
			...Object.keys(pkg.optionalDependencies ?? {}),
		]),
	].sort((left, right) => left.localeCompare(right));
}

function resolveDependencyRoot(requireFromWorkspace: NodeJS.Require, packageName: string): string | null {
	try {
		return dirname(requireFromWorkspace.resolve(`${packageName}/package.json`));
	} catch {
		return null;
	}
}
