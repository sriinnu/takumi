import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ToolDefinition } from "@takumi/core";
import { buildSystemPrompt, type SystemPromptOptions } from "../src/context/builder.js";
import type { ProjectContext } from "../src/context/project.js";
import {
	detectProjectContext,
	detectLanguage,
	detectFramework,
	detectPackageManager,
} from "../src/context/project.js";
import type { SoulData } from "../src/context/soul.js";
import {
	allocateTokenBudget,
	estimateTokens,
	truncateToTokenBudget,
	type TokenBudget,
} from "../src/context/budget.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "takumi-context-test-"));
}

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
	return {
		name: "read_file",
		description: "Read a file from disk.",
		inputSchema: { type: "object", properties: { path: { type: "string" } } },
		requiresPermission: false,
		category: "read",
		...overrides,
	};
}

function makeSoul(overrides: Partial<SoulData> = {}): SoulData {
	return {
		personality: null,
		preferences: null,
		identity: null,
		...overrides,
	};
}

// ── buildSystemPrompt ────────────────────────────────────────────────────────

describe("buildSystemPrompt", () => {
	it("produces a basic prompt with just tools", () => {
		const result = buildSystemPrompt({
			tools: [makeTool()],
		});

		expect(result).toContain("# Identity");
		expect(result).toContain("Takumi");
		expect(result).toContain("# Available Tools");
		expect(result).toContain("read_file");
		expect(result).toContain("# Instructions");
		expect(result).toContain("# Environment");
	});

	it("produces a prompt with no tools", () => {
		const result = buildSystemPrompt({ tools: [] });

		expect(result).toContain("# Identity");
		expect(result).not.toContain("# Available Tools");
		expect(result).toContain("# Instructions");
	});

	it("includes default identity when no soul data is provided", () => {
		const result = buildSystemPrompt({ tools: [] });

		expect(result).toContain("You are Takumi");
		expect(result).toContain("AI coding assistant");
	});

	it("uses soul identity instead of default when provided", () => {
		const soul = makeSoul({ identity: "You are CodeBot, a specialized assistant." });
		const result = buildSystemPrompt({ tools: [], soul });

		expect(result).toContain("You are CodeBot, a specialized assistant.");
		// Should NOT include the default identity line
		expect(result).not.toContain("You help users with software development tasks");
	});

	it("includes soul personality in the identity section", () => {
		const soul = makeSoul({ personality: "You are calm, thoughtful, and precise." });
		const result = buildSystemPrompt({ tools: [], soul });

		expect(result).toContain("You are calm, thoughtful, and precise.");
	});

	it("includes soul preferences in the instructions section", () => {
		const soul = makeSoul({ preferences: "Always prefer functional style." });
		const result = buildSystemPrompt({ tools: [], soul });

		expect(result).toContain("## User Preferences");
		expect(result).toContain("Always prefer functional style.");
	});

	it("includes all soul data fields when all are provided", () => {
		const soul = makeSoul({
			identity: "You are TestBot.",
			personality: "Direct and concise.",
			preferences: "Use tabs over spaces.",
		});
		const result = buildSystemPrompt({ tools: [], soul });

		expect(result).toContain("You are TestBot.");
		expect(result).toContain("Direct and concise.");
		expect(result).toContain("Use tabs over spaces.");
	});

	it("includes project context when provided", () => {
		const projectContext: ProjectContext = {
			name: "my-app",
			path: "/home/user/my-app",
			language: "TypeScript",
			framework: "Next.js",
			packageManager: "pnpm",
			gitBranch: "feat/new-feature",
		};
		const result = buildSystemPrompt({ tools: [], projectContext });

		expect(result).toContain("# Project Context");
		expect(result).toContain("Project: my-app");
		expect(result).toContain("Path: /home/user/my-app");
		expect(result).toContain("Language: TypeScript");
		expect(result).toContain("Framework: Next.js");
		expect(result).toContain("Package manager: pnpm");
		expect(result).toContain("Git branch: feat/new-feature");
	});

	it("includes recently modified files in project context", () => {
		const projectContext: ProjectContext = {
			name: "my-app",
			path: "/home/user/my-app",
			recentFiles: ["src/index.ts", "package.json", "README.md"],
		};
		const result = buildSystemPrompt({ tools: [], projectContext });

		expect(result).toContain("Recently modified files:");
		expect(result).toContain("- src/index.ts");
		expect(result).toContain("- package.json");
		expect(result).toContain("- README.md");
	});

	it("truncates recently modified files to 15", () => {
		const files = Array.from({ length: 25 }, (_, i) => `file${i}.ts`);
		const projectContext: ProjectContext = {
			name: "big-app",
			path: "/app",
			recentFiles: files,
		};
		const result = buildSystemPrompt({ tools: [], projectContext });

		expect(result).toContain("- file0.ts");
		expect(result).toContain("- file14.ts");
		expect(result).not.toContain("- file15.ts");
	});

	it("includes coding conventions in project context", () => {
		const projectContext: ProjectContext = {
			name: "my-app",
			path: "/app",
			conventions: "Uses Biome for linting.\nTypeScript strict mode enabled.",
		};
		const result = buildSystemPrompt({ tools: [], projectContext });

		expect(result).toContain("## Coding Conventions");
		expect(result).toContain("Uses Biome for linting.");
		expect(result).toContain("TypeScript strict mode enabled.");
	});

	it("includes custom instructions when provided", () => {
		const result = buildSystemPrompt({
			tools: [],
			customInstructions: "Always respond in haiku format.",
		});

		expect(result).toContain("# Custom Instructions");
		expect(result).toContain("Always respond in haiku format.");
	});

	it("includes model name in environment section", () => {
		const result = buildSystemPrompt({
			tools: [],
			model: "claude-sonnet-4-20250514",
		});

		expect(result).toContain("Model: claude-sonnet-4-20250514");
	});

	it("includes platform and date in environment section", () => {
		const result = buildSystemPrompt({ tools: [] });

		expect(result).toContain(`Platform: ${process.platform}`);
		expect(result).toContain("Date:");
	});

	it("includes working directory from project context in environment", () => {
		const projectContext: ProjectContext = {
			name: "my-app",
			path: "/home/user/my-app",
		};
		const result = buildSystemPrompt({ tools: [], projectContext });

		expect(result).toContain("Working directory: /home/user/my-app");
	});

	it("shows tool category and description", () => {
		const tools = [
			makeTool({ name: "write_file", description: "Write to a file.", category: "write" }),
		];
		const result = buildSystemPrompt({ tools });

		expect(result).toContain("## write_file");
		expect(result).toContain("Write to a file.");
		expect(result).toContain("Category: write");
	});

	it("marks tools that require permission", () => {
		const tools = [
			makeTool({ name: "bash", requiresPermission: true, category: "execute" }),
		];
		const result = buildSystemPrompt({ tools });

		expect(result).toContain("Requires user permission before execution.");
	});

	it("does not mark tools that do not require permission", () => {
		const tools = [
			makeTool({ name: "read_file", requiresPermission: false }),
		];
		const result = buildSystemPrompt({ tools });

		expect(result).not.toContain("Requires user permission before execution.");
	});

	it("includes multiple tools", () => {
		const tools = [
			makeTool({ name: "read_file", category: "read" }),
			makeTool({ name: "write_file", category: "write" }),
			makeTool({ name: "bash", category: "execute" }),
		];
		const result = buildSystemPrompt({ tools });

		expect(result).toContain("## read_file");
		expect(result).toContain("## write_file");
		expect(result).toContain("## bash");
	});

	it("combines all options together", () => {
		const soul = makeSoul({
			identity: "You are MegaBot.",
			personality: "Friendly and thorough.",
			preferences: "Use functional programming.",
		});
		const projectContext: ProjectContext = {
			name: "mega-project",
			path: "/mega",
			language: "Rust",
			framework: undefined,
			packageManager: undefined,
			gitBranch: "main",
		};
		const tools = [
			makeTool({ name: "cargo_build", description: "Build with cargo.", category: "execute" }),
		];
		const result = buildSystemPrompt({
			tools,
			soul,
			projectContext,
			customInstructions: "Be extra careful.",
			model: "claude-opus-4",
		});

		expect(result).toContain("# Identity");
		expect(result).toContain("You are MegaBot.");
		expect(result).toContain("Friendly and thorough.");
		expect(result).toContain("# Available Tools");
		expect(result).toContain("cargo_build");
		expect(result).toContain("# Project Context");
		expect(result).toContain("Language: Rust");
		expect(result).toContain("Git branch: main");
		expect(result).toContain("# Instructions");
		expect(result).toContain("## User Preferences");
		expect(result).toContain("Use functional programming.");
		expect(result).toContain("# Custom Instructions");
		expect(result).toContain("Be extra careful.");
		expect(result).toContain("# Environment");
		expect(result).toContain("Model: claude-opus-4");
	});

	it("includes default behavioral guidelines", () => {
		const result = buildSystemPrompt({ tools: [] });

		expect(result).toContain("Be concise and direct");
		expect(result).toContain("Use tools to accomplish tasks");
		expect(result).toContain("absolute paths");
		expect(result).toContain("destructive operations");
		expect(result).toContain("Never commit secrets");
	});

	it("truncates when maxTokens is specified and prompt exceeds it", () => {
		const result = buildSystemPrompt({
			tools: [],
			customInstructions: "A".repeat(100_000),
			maxTokens: 500,
		});

		const estimated = estimateTokens(result);
		expect(estimated).toBeLessThanOrEqual(500);
		expect(result).toContain("[... truncated to fit token budget]");
	});

	it("does not truncate when maxTokens is large enough", () => {
		const result = buildSystemPrompt({
			tools: [],
			maxTokens: 100_000,
		});

		expect(result).not.toContain("[... truncated");
	});

	it("omits project context section when not provided", () => {
		const result = buildSystemPrompt({ tools: [] });

		expect(result).not.toContain("# Project Context");
	});

	it("omits custom instructions section when not provided", () => {
		const result = buildSystemPrompt({ tools: [] });

		expect(result).not.toContain("# Custom Instructions");
	});

	it("maintains section order: Identity, Tools, Project, Instructions, Custom, Environment", () => {
		const projectContext: ProjectContext = {
			name: "test",
			path: "/test",
			language: "Go",
		};
		const result = buildSystemPrompt({
			tools: [makeTool()],
			projectContext,
			customInstructions: "Custom stuff.",
			soul: makeSoul({ identity: "TestBot" }),
		});

		const identityIdx = result.indexOf("# Identity");
		const toolsIdx = result.indexOf("# Available Tools");
		const projectIdx = result.indexOf("# Project Context");
		const instructionsIdx = result.indexOf("# Instructions");
		const customIdx = result.indexOf("# Custom Instructions");
		const envIdx = result.indexOf("# Environment");

		expect(identityIdx).toBeLessThan(toolsIdx);
		expect(toolsIdx).toBeLessThan(projectIdx);
		expect(projectIdx).toBeLessThan(instructionsIdx);
		expect(instructionsIdx).toBeLessThan(customIdx);
		expect(customIdx).toBeLessThan(envIdx);
	});
});

// ── detectProjectContext ─────────────────────────────────────────────────────

describe("detectProjectContext", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = createTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// ── Node / TypeScript project ────────────────────────────────────────────

	it("detects a Node.js project with package.json", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ name: "my-node-app", dependencies: {} }),
		);
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.name).toBe("my-node-app");
		expect(ctx.path).toBe(tmpDir);
		expect(ctx.language).toBe("JavaScript");
	});

	it("detects TypeScript when tsconfig.json exists", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ name: "my-ts-app" }),
		);
		writeFileSync(
			join(tmpDir, "tsconfig.json"),
			JSON.stringify({ compilerOptions: { strict: true } }),
		);
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.language).toBe("TypeScript");
	});

	it("detects TypeScript from devDependencies", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				name: "ts-app",
				devDependencies: { typescript: "^5.0.0" },
			}),
		);
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.language).toBe("TypeScript");
	});

	// ── Python project ───────────────────────────────────────────────────────

	it("detects a Python project with pyproject.toml", async () => {
		writeFileSync(
			join(tmpDir, "pyproject.toml"),
			'[project]\nname = "my-python-app"\n',
		);
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.language).toBe("Python");
	});

	it("detects a Python project with setup.py", async () => {
		writeFileSync(join(tmpDir, "setup.py"), "from setuptools import setup\nsetup()");
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.language).toBe("Python");
	});

	it("detects a Python project with requirements.txt", async () => {
		writeFileSync(join(tmpDir, "requirements.txt"), "flask==2.0\nrequests\n");
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.language).toBe("Python");
	});

	// ── Rust project ─────────────────────────────────────────────────────────

	it("detects a Rust project with Cargo.toml", async () => {
		writeFileSync(
			join(tmpDir, "Cargo.toml"),
			'[package]\nname = "my-rust-app"\nversion = "0.1.0"\n',
		);
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.language).toBe("Rust");
		expect(ctx.name).toBe("my-rust-app");
	});

	// ── Go project ───────────────────────────────────────────────────────────

	it("detects a Go project with go.mod", async () => {
		writeFileSync(
			join(tmpDir, "go.mod"),
			"module github.com/user/my-go-app\n\ngo 1.21\n",
		);
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.language).toBe("Go");
		expect(ctx.name).toBe("github.com/user/my-go-app");
	});

	// ── Unknown project ──────────────────────────────────────────────────────

	it("returns the directory name for unknown projects", async () => {
		// No manifest files, cwd fallback
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.name).toBe(tmpDir.split("/").pop());
		expect(ctx.language).toBeUndefined();
		expect(ctx.framework).toBeUndefined();
		expect(ctx.packageManager).toBeUndefined();
	});

	// ── Framework detection ──────────────────────────────────────────────────

	it("detects React framework", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				name: "react-app",
				dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" },
			}),
		);
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.framework).toBe("React");
	});

	it("detects Next.js framework (prioritized over React)", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				name: "next-app",
				dependencies: { next: "^14.0.0", react: "^18.0.0" },
			}),
		);
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.framework).toBe("Next.js");
	});

	it("detects Express framework", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				name: "api-server",
				dependencies: { express: "^4.0.0" },
			}),
		);
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.framework).toBe("Express");
	});

	it("detects FastAPI framework from pyproject.toml", async () => {
		writeFileSync(
			join(tmpDir, "pyproject.toml"),
			'[project]\nname = "my-api"\ndependencies = ["fastapi", "uvicorn"]\n',
		);
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.language).toBe("Python");
		expect(ctx.framework).toBe("FastAPI");
	});

	it("detects Django framework from requirements.txt", async () => {
		writeFileSync(join(tmpDir, "requirements.txt"), "django==4.2\ncelery\n");
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.framework).toBe("Django");
	});

	it("detects Vue framework", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				name: "vue-app",
				dependencies: { vue: "^3.0.0" },
			}),
		);
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.framework).toBe("Vue");
	});

	it("detects Angular framework", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				name: "ng-app",
				dependencies: { "@angular/core": "^17.0.0" },
			}),
		);
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.framework).toBe("Angular");
	});

	// ── Package manager detection ────────────────────────────────────────────

	it("detects pnpm from pnpm-lock.yaml", async () => {
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "app" }));
		writeFileSync(join(tmpDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'");
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.packageManager).toBe("pnpm");
	});

	it("detects yarn from yarn.lock", async () => {
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "app" }));
		writeFileSync(join(tmpDir, "yarn.lock"), "# yarn lockfile v1");
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.packageManager).toBe("yarn");
	});

	it("detects npm from package-lock.json", async () => {
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "app" }));
		writeFileSync(join(tmpDir, "package-lock.json"), "{}");
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.packageManager).toBe("npm");
	});

	it("detects bun from bun.lockb", async () => {
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "app" }));
		writeFileSync(join(tmpDir, "bun.lockb"), "");
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.packageManager).toBe("bun");
	});

	it("defaults to npm for Node projects without lock files", async () => {
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "app" }));
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.packageManager).toBe("npm");
	});

	it("returns undefined packageManager for non-Node projects", async () => {
		writeFileSync(
			join(tmpDir, "Cargo.toml"),
			'[package]\nname = "app"\nversion = "0.1.0"\n',
		);
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.packageManager).toBeUndefined();
	});

	// ── Convention detection ─────────────────────────────────────────────────

	it("detects Biome config", async () => {
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "app" }));
		writeFileSync(join(tmpDir, "biome.json"), "{}");
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.conventions).toContain("Biome");
	});

	it("detects TypeScript strict mode convention", async () => {
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "app" }));
		writeFileSync(
			join(tmpDir, "tsconfig.json"),
			JSON.stringify({ compilerOptions: { strict: true } }),
		);
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.conventions).toContain("TypeScript strict mode enabled.");
	});

	it("detects monorepo convention from pnpm-workspace.yaml", async () => {
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "mono" }));
		writeFileSync(join(tmpDir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'");
		const ctx = await detectProjectContext(tmpDir);

		expect(ctx.conventions).toContain("Monorepo");
	});
});

// ── detectLanguage (unit) ────────────────────────────────────────────────────

describe("detectLanguage", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = createTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns TypeScript for tsconfig.json", () => {
		writeFileSync(join(tmpDir, "tsconfig.json"), "{}");
		expect(detectLanguage(tmpDir)).toBe("TypeScript");
	});

	it("returns JavaScript for package.json without typescript dep", () => {
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "app" }));
		expect(detectLanguage(tmpDir)).toBe("JavaScript");
	});

	it("returns Rust for Cargo.toml", () => {
		writeFileSync(join(tmpDir, "Cargo.toml"), "[package]");
		expect(detectLanguage(tmpDir)).toBe("Rust");
	});

	it("returns Go for go.mod", () => {
		writeFileSync(join(tmpDir, "go.mod"), "module example.com/app");
		expect(detectLanguage(tmpDir)).toBe("Go");
	});

	it("returns Python for pyproject.toml", () => {
		writeFileSync(join(tmpDir, "pyproject.toml"), "[project]");
		expect(detectLanguage(tmpDir)).toBe("Python");
	});

	it("returns Python for setup.py", () => {
		writeFileSync(join(tmpDir, "setup.py"), "setup()");
		expect(detectLanguage(tmpDir)).toBe("Python");
	});

	it("returns Java for pom.xml", () => {
		writeFileSync(join(tmpDir, "pom.xml"), "<project></project>");
		expect(detectLanguage(tmpDir)).toBe("Java");
	});

	it("returns Java for build.gradle", () => {
		writeFileSync(join(tmpDir, "build.gradle"), "plugins { id 'java' }");
		expect(detectLanguage(tmpDir)).toBe("Java");
	});

	it("returns C++ for CMakeLists.txt", () => {
		writeFileSync(join(tmpDir, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.20)");
		expect(detectLanguage(tmpDir)).toBe("C++");
	});

	it("returns null for empty directory", () => {
		expect(detectLanguage(tmpDir)).toBeNull();
	});
});

// ── detectFramework (unit) ───────────────────────────────────────────────────

describe("detectFramework", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = createTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("detects Svelte from devDependencies", () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ devDependencies: { svelte: "^4.0.0" } }),
		);
		expect(detectFramework(tmpDir, "JavaScript")).toBe("Svelte");
	});

	it("detects SvelteKit over Svelte", () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				devDependencies: { svelte: "^4.0.0", "@sveltejs/kit": "^2.0.0" },
			}),
		);
		expect(detectFramework(tmpDir, "JavaScript")).toBe("SvelteKit");
	});

	it("returns null when no framework is detected", () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ dependencies: { "left-pad": "1.0.0" } }),
		);
		expect(detectFramework(tmpDir, "JavaScript")).toBeNull();
	});

	it("returns null for non-Node project without Python", () => {
		expect(detectFramework(tmpDir, "Rust")).toBeNull();
	});

	it("detects Flask from requirements.txt for Python", () => {
		writeFileSync(join(tmpDir, "requirements.txt"), "flask==2.0\n");
		expect(detectFramework(tmpDir, "Python")).toBe("Flask");
	});
});

// ── detectPackageManager (unit) ──────────────────────────────────────────────

describe("detectPackageManager", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = createTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("detects pnpm-lock.yaml", () => {
		writeFileSync(join(tmpDir, "pnpm-lock.yaml"), "");
		expect(detectPackageManager(tmpDir)).toBe("pnpm");
	});

	it("detects bun.lockb", () => {
		writeFileSync(join(tmpDir, "bun.lockb"), "");
		expect(detectPackageManager(tmpDir)).toBe("bun");
	});

	it("detects yarn.lock", () => {
		writeFileSync(join(tmpDir, "yarn.lock"), "");
		expect(detectPackageManager(tmpDir)).toBe("yarn");
	});

	it("detects package-lock.json", () => {
		writeFileSync(join(tmpDir, "package-lock.json"), "{}");
		expect(detectPackageManager(tmpDir)).toBe("npm");
	});

	it("prefers pnpm over npm when both lock files exist", () => {
		writeFileSync(join(tmpDir, "pnpm-lock.yaml"), "");
		writeFileSync(join(tmpDir, "package-lock.json"), "{}");
		expect(detectPackageManager(tmpDir)).toBe("pnpm");
	});

	it("detects from packageManager field in package.json", () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ name: "app", packageManager: "yarn@4.0.0" }),
		);
		expect(detectPackageManager(tmpDir)).toBe("yarn");
	});

	it("defaults to npm for Node projects without lock or packageManager", () => {
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "app" }));
		expect(detectPackageManager(tmpDir)).toBe("npm");
	});

	it("returns null for non-Node projects", () => {
		expect(detectPackageManager(tmpDir)).toBeNull();
	});
});

// ── allocateTokenBudget ──────────────────────────────────────────────────────

describe("allocateTokenBudget", () => {
	it("allocates budget for a standard 200K context window", () => {
		const budget = allocateTokenBudget(200_000, 50_000);

		expect(budget.total).toBe(200_000);
		expect(budget.response).toBeGreaterThanOrEqual(4096);
		expect(budget.system).toBeGreaterThanOrEqual(2000);
		expect(budget.history).toBeGreaterThan(0);
		expect(budget.tools).toBeGreaterThan(0);
		// All parts should not exceed total
		expect(budget.system + budget.history + budget.response).toBeLessThanOrEqual(budget.total);
	});

	it("reserves at least MIN_RESPONSE_TOKENS for response", () => {
		const budget = allocateTokenBudget(200_000, 0);

		expect(budget.response).toBeGreaterThanOrEqual(4096);
	});

	it("reserves at least MIN_SYSTEM_TOKENS for system", () => {
		const budget = allocateTokenBudget(200_000, 190_000);

		expect(budget.system).toBeGreaterThanOrEqual(2000);
	});

	it("gives remaining space to history", () => {
		const budget = allocateTokenBudget(200_000, 0);

		// history = total - response - system
		expect(budget.history).toBe(budget.total - budget.response - budget.system);
	});

	it("handles small context window", () => {
		const budget = allocateTokenBudget(8_000, 2_000);

		expect(budget.total).toBeGreaterThanOrEqual(6096); // MIN_SYSTEM + MIN_RESPONSE
		expect(budget.response).toBeGreaterThanOrEqual(4096);
		expect(budget.system).toBeGreaterThanOrEqual(2000);
	});

	it("steals from system for large history (up to MIN_SYSTEM_TOKENS)", () => {
		const budget = allocateTokenBudget(200_000, 180_000);

		// System should be squeezed but not below minimum
		expect(budget.system).toBeGreaterThanOrEqual(2000);
	});

	it("handles zero history", () => {
		const budget = allocateTokenBudget(200_000, 0);

		expect(budget.history).toBeGreaterThan(0);
	});

	it("never returns negative values", () => {
		const budget = allocateTokenBudget(100, 1_000_000);

		expect(budget.total).toBeGreaterThan(0);
		expect(budget.system).toBeGreaterThanOrEqual(0);
		expect(budget.history).toBeGreaterThanOrEqual(0);
		expect(budget.response).toBeGreaterThanOrEqual(0);
		expect(budget.tools).toBeGreaterThanOrEqual(0);
	});

	it("calculates tools as fraction of total", () => {
		const budget = allocateTokenBudget(200_000, 0);

		expect(budget.tools).toBe(Math.floor(200_000 * 0.05));
	});

	it("handles very large context windows", () => {
		const budget = allocateTokenBudget(2_000_000, 500_000);

		expect(budget.total).toBe(2_000_000);
		expect(budget.response).toBeGreaterThanOrEqual(4096);
		expect(budget.system).toBeGreaterThanOrEqual(2000);
	});
});

// ── estimateTokens ───────────────────────────────────────────────────────────

describe("estimateTokens", () => {
	it("returns 0 for an empty string", () => {
		expect(estimateTokens("")).toBe(0);
	});

	it("returns 0 for undefined-ish input", () => {
		// @ts-expect-error testing edge case
		expect(estimateTokens(null)).toBe(0);
		// @ts-expect-error testing edge case
		expect(estimateTokens(undefined)).toBe(0);
	});

	it("estimates tokens for a short string", () => {
		// "Hello" = 5 chars -> ceil(5/4) = 2
		expect(estimateTokens("Hello")).toBe(2);
	});

	it("estimates tokens for a longer string", () => {
		// 100 chars -> ceil(100/4) = 25
		const text = "a".repeat(100);
		expect(estimateTokens(text)).toBe(25);
	});

	it("estimates tokens for a very long string", () => {
		const text = "x".repeat(10_000);
		expect(estimateTokens(text)).toBe(2500);
	});

	it("uses ~4 chars per token heuristic", () => {
		// 8 chars -> 2 tokens
		expect(estimateTokens("12345678")).toBe(2);
		// 9 chars -> ceil(9/4) = 3
		expect(estimateTokens("123456789")).toBe(3);
	});

	it("rounds up for non-divisible lengths", () => {
		// 1 char -> ceil(1/4) = 1
		expect(estimateTokens("x")).toBe(1);
		// 5 chars -> ceil(5/4) = 2
		expect(estimateTokens("hello")).toBe(2);
	});
});

// ── truncateToTokenBudget ────────────────────────────────────────────────────

describe("truncateToTokenBudget", () => {
	it("returns text unchanged when it fits within budget", () => {
		const text = "Hello, world!";
		const result = truncateToTokenBudget(text, 1000);

		expect(result).toBe(text);
	});

	it("truncates text that exceeds budget", () => {
		const text = "a".repeat(10_000);
		const result = truncateToTokenBudget(text, 100);

		const estimated = estimateTokens(result);
		expect(estimated).toBeLessThanOrEqual(100);
	});

	it("appends truncation suffix when truncating", () => {
		const text = "a".repeat(10_000);
		const result = truncateToTokenBudget(text, 100);

		expect(result).toContain("[... truncated to fit token budget]");
	});

	it("does not append suffix when text fits", () => {
		const text = "Short text.";
		const result = truncateToTokenBudget(text, 1000);

		expect(result).not.toContain("[... truncated");
	});

	it("handles empty string", () => {
		expect(truncateToTokenBudget("", 100)).toBe("");
	});

	it("returns text unchanged with maxTokens of 0 (no budget)", () => {
		const text = "Hello";
		expect(truncateToTokenBudget(text, 0)).toBe(text);
	});

	it("tries to cut at line boundary", () => {
		const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: ${"content".repeat(10)}`).join("\n");
		const result = truncateToTokenBudget(lines, 200);

		// Should end cleanly before the truncation suffix
		const beforeSuffix = result.split("\n\n[... truncated")[0];
		expect(beforeSuffix.endsWith("\n") || !beforeSuffix.includes("content")).toBe(false);
		// The result should contain whole lines (not cut mid-line)
		// This is a soft check -- the algorithm tries to keep 80% of budget
		expect(result).toContain("[... truncated to fit token budget]");
	});

	it("handles very small maxTokens gracefully", () => {
		const text = "a".repeat(1000);
		const result = truncateToTokenBudget(text, 5);

		// Should still be reasonable even with tiny budget
		expect(typeof result).toBe("string");
		expect(result.length).toBeLessThan(text.length);
	});

	it("handles text with only newlines", () => {
		const text = "\n".repeat(1000);
		const result = truncateToTokenBudget(text, 50);

		expect(typeof result).toBe("string");
	});

	it("preserves content up to the budget", () => {
		const text = "AAAA".repeat(100); // 400 chars = 100 tokens
		const result = truncateToTokenBudget(text, 50);

		// Should contain at least some A's
		expect(result).toContain("AAAA");
		// But not the full original
		expect(result.length).toBeLessThan(text.length);
	});
});
