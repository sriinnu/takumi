/**
 * Project detection — finds project metadata, instructions files,
 * and git information from the working directory.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { execSync } from "node:child_process";
import { createLogger } from "@takumi/core";

const log = createLogger("project-detect");

export interface ProjectInfo {
	/** Project name (from package.json or directory). */
	name: string;

	/** Project root directory. */
	root: string;

	/** Whether this is a git repository. */
	isGit: boolean;

	/** Current git branch. */
	gitBranch: string | null;

	/** Instructions from CLAUDE.md, TAKUMI.md, or similar. */
	instructions: string | null;
}

/** Instruction file names, in priority order. */
const INSTRUCTION_FILES = [
	"TAKUMI.md",
	"CLAUDE.md",
	".takumi/instructions.md",
	".claude/instructions.md",
];

/**
 * Detect project information from the working directory.
 */
export async function detectProject(cwd: string): Promise<ProjectInfo | null> {
	try {
		const root = findProjectRoot(cwd);
		if (!root) return null;

		const name = getProjectName(root);
		const isGit = existsSync(join(root, ".git"));
		const gitBranch = isGit ? getGitBranch(root) : null;
		const instructions = findInstructions(root);

		return { name, root, isGit, gitBranch, instructions };
	} catch (err) {
		log.error("Project detection failed", err);
		return null;
	}
}

/** Walk up to find the project root (has package.json, .git, or Cargo.toml). */
function findProjectRoot(from: string): string | null {
	const markers = ["package.json", ".git", "Cargo.toml", "go.mod", "pyproject.toml"];
	let dir = from;

	for (let depth = 0; depth < 20; depth++) {
		for (const marker of markers) {
			if (existsSync(join(dir, marker))) {
				return dir;
			}
		}
		const parent = join(dir, "..");
		if (parent === dir) break; // reached filesystem root
		dir = parent;
	}

	return null;
}

/** Get project name from package.json or directory name. */
function getProjectName(root: string): string {
	const pkgPath = join(root, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
			if (pkg.name) return pkg.name;
		} catch { /* ignore parse errors */ }
	}
	return basename(root);
}

/** Get the current git branch. */
function getGitBranch(root: string): string | null {
	try {
		const branch = execSync("git rev-parse --abbrev-ref HEAD", {
			cwd: root,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		return branch || null;
	} catch {
		return null;
	}
}

/** Find and read the first matching instructions file. */
function findInstructions(root: string): string | null {
	for (const file of INSTRUCTION_FILES) {
		const fullPath = join(root, file);
		if (existsSync(fullPath)) {
			try {
				const content = readFileSync(fullPath, "utf-8").trim();
				if (content) {
					log.info(`Found instructions: ${fullPath}`);
					return content;
				}
			} catch { /* ignore read errors */ }
		}
	}
	return null;
}
