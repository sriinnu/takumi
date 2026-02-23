/**
 * Project detection -- finds project metadata, instructions files,
 * git information, language, framework, and package manager from the
 * working directory.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createLogger } from "@takumi/core";

const log = createLogger("project-detect");

// ── Types ────────────────────────────────────────────────────────────────────

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

export interface ProjectContext {
	/** Project name. */
	name: string;

	/** Project root path. */
	path: string;

	/** Primary programming language. */
	language?: string;

	/** Detected framework (React, Next.js, Express, FastAPI, etc.). */
	framework?: string;

	/** Package manager (npm, pnpm, yarn, bun). */
	packageManager?: string;

	/** Current git branch. */
	gitBranch?: string;

	/** Recently modified files (from git status). */
	recentFiles?: string[];

	/** Coding conventions (from config or detection). */
	conventions?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Instruction file names, in priority order. */
const INSTRUCTION_FILES = ["TAKUMI.md", "CLAUDE.md", ".takumi/instructions.md", ".claude/instructions.md"];

/** Project root marker files. */
const ROOT_MARKERS = [
	"package.json",
	".git",
	"Cargo.toml",
	"go.mod",
	"pyproject.toml",
	"setup.py",
	"build.gradle",
	"pom.xml",
	"CMakeLists.txt",
	"Makefile",
];

// ── Framework detection maps ─────────────────────────────────────────────────

/** npm dependency name -> framework name. */
const FRAMEWORK_MAP: Record<string, string> = {
	next: "Next.js",
	nuxt: "Nuxt",
	"@angular/core": "Angular",
	vue: "Vue",
	svelte: "Svelte",
	"@sveltejs/kit": "SvelteKit",
	react: "React",
	"react-native": "React Native",
	express: "Express",
	fastify: "Fastify",
	koa: "Koa",
	hono: "Hono",
	nestjs: "NestJS",
	"@nestjs/core": "NestJS",
	gatsby: "Gatsby",
	remix: "Remix",
	"@remix-run/node": "Remix",
	astro: "Astro",
	electron: "Electron",
	tauri: "Tauri",
	vite: "Vite",
};

/** Python dependency name -> framework name. */
const PYTHON_FRAMEWORK_MAP: Record<string, string> = {
	fastapi: "FastAPI",
	django: "Django",
	flask: "Flask",
	starlette: "Starlette",
	tornado: "Tornado",
	pyramid: "Pyramid",
	sanic: "Sanic",
	aiohttp: "aiohttp",
};

// ── detectProject (original API) ─────────────────────────────────────────────

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

// ── detectProjectContext (new rich API) ───────────────────────────────────────

/**
 * Auto-detect rich project context from a working directory.
 *
 * Detects:
 * - Language from manifest files (package.json, Cargo.toml, go.mod, pyproject.toml)
 * - Framework from dependency lists
 * - Package manager from lock files
 * - Git branch
 * - Recently modified files (git status)
 * - Coding conventions (from .editorconfig, tsconfig, biome, eslint, prettier)
 */
export async function detectProjectContext(cwd: string): Promise<ProjectContext> {
	const root = findProjectRoot(cwd) ?? cwd;
	const name = getProjectName(root);
	const language = detectLanguage(root);
	const framework = detectFramework(root, language);
	const packageManager = detectPackageManager(root);
	const gitBranch = existsSync(join(root, ".git")) ? (getGitBranch(root) ?? undefined) : undefined;
	const recentFiles = getRecentFiles(root);
	const conventions = detectConventions(root);

	return {
		name,
		path: root,
		language: language ?? undefined,
		framework: framework ?? undefined,
		packageManager: packageManager ?? undefined,
		gitBranch,
		recentFiles: recentFiles.length > 0 ? recentFiles : undefined,
		conventions: conventions ?? undefined,
	};
}

// ── Language detection ────────────────────────────────────────────────────────

/**
 * Detect the primary programming language from project manifest files.
 */
export function detectLanguage(root: string): string | null {
	// TypeScript (check tsconfig before package.json)
	if (existsSync(join(root, "tsconfig.json"))) {
		return "TypeScript";
	}

	// Node / JavaScript
	if (existsSync(join(root, "package.json"))) {
		// Check if TS is a devDependency
		try {
			const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
			const deps = { ...pkg.dependencies, ...pkg.devDependencies };
			if (deps.typescript) return "TypeScript";
		} catch {
			/* ignore */
		}
		return "JavaScript";
	}

	// Rust
	if (existsSync(join(root, "Cargo.toml"))) {
		return "Rust";
	}

	// Go
	if (existsSync(join(root, "go.mod"))) {
		return "Go";
	}

	// Python
	if (
		existsSync(join(root, "pyproject.toml")) ||
		existsSync(join(root, "setup.py")) ||
		existsSync(join(root, "setup.cfg")) ||
		existsSync(join(root, "requirements.txt"))
	) {
		return "Python";
	}

	// Java
	if (existsSync(join(root, "pom.xml")) || existsSync(join(root, "build.gradle"))) {
		return "Java";
	}

	// C/C++
	if (existsSync(join(root, "CMakeLists.txt"))) {
		return "C++";
	}

	return null;
}

// ── Framework detection ──────────────────────────────────────────────────────

/**
 * Detect the framework from project dependency files.
 */
export function detectFramework(root: string, language: string | null): string | null {
	// Node-based frameworks
	if (existsSync(join(root, "package.json"))) {
		try {
			const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
			const deps = {
				...pkg.dependencies,
				...pkg.devDependencies,
			};

			// Check in priority order (more specific frameworks first)
			const priorityOrder = [
				"next",
				"@remix-run/node",
				"remix",
				"nuxt",
				"@sveltejs/kit",
				"astro",
				"gatsby",
				"@nestjs/core",
				"nestjs",
				"express",
				"fastify",
				"koa",
				"hono",
				"react-native",
				"electron",
				"tauri",
				"@angular/core",
				"vue",
				"svelte",
				"react",
			];

			for (const dep of priorityOrder) {
				if (dep in deps && dep in FRAMEWORK_MAP) {
					return FRAMEWORK_MAP[dep];
				}
			}
		} catch {
			/* ignore parse errors */
		}
	}

	// Python frameworks
	if (language === "Python") {
		return detectPythonFramework(root);
	}

	return null;
}

/**
 * Detect Python framework from pyproject.toml or requirements.txt.
 */
function detectPythonFramework(root: string): string | null {
	// Try pyproject.toml
	const pyprojectPath = join(root, "pyproject.toml");
	if (existsSync(pyprojectPath)) {
		try {
			const content = readFileSync(pyprojectPath, "utf-8");
			for (const [dep, framework] of Object.entries(PYTHON_FRAMEWORK_MAP)) {
				if (content.includes(dep)) {
					return framework;
				}
			}
		} catch {
			/* ignore */
		}
	}

	// Try requirements.txt
	const reqPath = join(root, "requirements.txt");
	if (existsSync(reqPath)) {
		try {
			const content = readFileSync(reqPath, "utf-8").toLowerCase();
			for (const [dep, framework] of Object.entries(PYTHON_FRAMEWORK_MAP)) {
				if (content.includes(dep)) {
					return framework;
				}
			}
		} catch {
			/* ignore */
		}
	}

	return null;
}

// ── Package manager detection ────────────────────────────────────────────────

/**
 * Detect the package manager from lock files.
 */
export function detectPackageManager(root: string): string | null {
	// Order matters: more specific first
	if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
	if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) return "bun";
	if (existsSync(join(root, "yarn.lock"))) return "yarn";
	if (existsSync(join(root, "package-lock.json"))) return "npm";

	// Fallback: check packageManager field in package.json
	const pkgPath = join(root, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
			if (typeof pkg.packageManager === "string") {
				const pm = pkg.packageManager.split("@")[0];
				if (["pnpm", "yarn", "npm", "bun"].includes(pm)) {
					return pm;
				}
			}
		} catch {
			/* ignore */
		}

		// Default for Node projects
		return "npm";
	}

	return null;
}

// ── Git helpers ──────────────────────────────────────────────────────────────

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

/**
 * Get recently modified files from git status.
 * Returns up to 20 file paths relative to root.
 */
function getRecentFiles(root: string): string[] {
	if (!existsSync(join(root, ".git"))) return [];

	try {
		const output = execSync("git status --porcelain --short", {
			cwd: root,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();

		if (!output) return [];

		const files: string[] = [];
		for (const line of output.split("\n")) {
			// Format: "XY filename" or "XY filename -> newname"
			const trimmed = line.trim();
			if (!trimmed) continue;
			const filePart = trimmed.slice(3); // skip status chars + space
			const name = filePart.includes(" -> ") ? filePart.split(" -> ")[1] : filePart;
			if (name) files.push(name);
		}

		return files.slice(0, 20);
	} catch {
		return [];
	}
}

// ── Convention detection ─────────────────────────────────────────────────────

/**
 * Detect coding conventions from config files.
 */
function detectConventions(root: string): string | null {
	const conventions: string[] = [];

	// EditorConfig
	if (existsSync(join(root, ".editorconfig"))) {
		conventions.push("Uses EditorConfig for formatting.");
	}

	// Biome
	if (existsSync(join(root, "biome.json")) || existsSync(join(root, "biome.jsonc"))) {
		conventions.push("Uses Biome for linting and formatting.");
	}

	// ESLint
	const eslintFiles = [
		".eslintrc",
		".eslintrc.js",
		".eslintrc.cjs",
		".eslintrc.json",
		".eslintrc.yml",
		".eslintrc.yaml",
		"eslint.config.js",
		"eslint.config.mjs",
	];
	if (eslintFiles.some((f) => existsSync(join(root, f)))) {
		conventions.push("Uses ESLint for linting.");
	}

	// Prettier
	const prettierFiles = [
		".prettierrc",
		".prettierrc.js",
		".prettierrc.cjs",
		".prettierrc.json",
		".prettierrc.yml",
		".prettierrc.yaml",
		"prettier.config.js",
		"prettier.config.mjs",
	];
	if (prettierFiles.some((f) => existsSync(join(root, f)))) {
		conventions.push("Uses Prettier for formatting.");
	}

	// TypeScript strict mode
	const tsconfigPath = join(root, "tsconfig.json");
	if (existsSync(tsconfigPath)) {
		try {
			const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8"));
			if (tsconfig.compilerOptions?.strict) {
				conventions.push("TypeScript strict mode enabled.");
			}
		} catch {
			/* ignore */
		}
	}

	// Monorepo detection
	if (
		existsSync(join(root, "pnpm-workspace.yaml")) ||
		existsSync(join(root, "lerna.json")) ||
		existsSync(join(root, "nx.json"))
	) {
		conventions.push("Monorepo project structure.");
	}

	return conventions.length > 0 ? conventions.join("\n") : null;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Walk up to find the project root (has package.json, .git, or Cargo.toml). */
function findProjectRoot(from: string): string | null {
	let dir = from;

	for (let depth = 0; depth < 20; depth++) {
		for (const marker of ROOT_MARKERS) {
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
		} catch {
			/* ignore parse errors */
		}
	}

	// Try Cargo.toml
	const cargoPath = join(root, "Cargo.toml");
	if (existsSync(cargoPath)) {
		try {
			const content = readFileSync(cargoPath, "utf-8");
			const match = content.match(/name\s*=\s*"([^"]+)"/);
			if (match) return match[1];
		} catch {
			/* ignore */
		}
	}

	// Try go.mod
	const goModPath = join(root, "go.mod");
	if (existsSync(goModPath)) {
		try {
			const content = readFileSync(goModPath, "utf-8");
			const match = content.match(/module\s+(\S+)/);
			if (match) return match[1];
		} catch {
			/* ignore */
		}
	}

	return basename(root);
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
			} catch {
				/* ignore read errors */
			}
		}
	}
	return null;
}
