import { spawnSync } from "node:child_process";
import { existsSync, constants as fsConstants, readFileSync } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { IS_LINUX, IS_MACOS, IS_WINDOWS } from "./platform-detect.js";

export const PROJECT_INSTRUCTION_FILES = [
	"TAKUMI.md",
	"CLAUDE.md",
	".takumi/instructions.md",
	".claude/instructions.md",
] as const;

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

interface LaunchCommand {
	command: string;
	args: string[];
}

export type ProjectInstructionPathKind = "takumi-root" | "claude-root" | "takumi-local" | "claude-local";

export interface ProjectInstructionPathEntry {
	path: string;
	kind: ProjectInstructionPathKind;
	exists: boolean;
}

export interface TakumiProjectInstructionsInspection {
	projectRoot: string;
	activePath: string | null;
	defaultPath: string;
	searchPaths: ProjectInstructionPathEntry[];
}

export interface EnsuredTakumiProjectInstructionsFile {
	filePath: string;
	created: boolean;
	projectRoot: string;
}

export function buildTakumiProjectInstructionsTemplate(projectName = basename(process.cwd())): string {
	return `${[
		"# TAKUMI.md",
		"",
		`Project-specific instructions for Takumi when working in **${projectName}**.`,
		"",
		"## Project overview",
		"",
		"- What this project does:",
		"- Key entrypoints or packages:",
		"- Important directories to understand first:",
		"",
		"## Development workflow",
		"",
		"- Install:",
		"- Build:",
		"- Test:",
		"- Lint or check:",
		"",
		"## Coding preferences",
		"",
		"- Architecture or patterns to preserve:",
		"- Naming conventions:",
		"- Error handling expectations:",
		"- Performance or UX constraints:",
		"",
		"## Change safety",
		"",
		"- Files or directories to treat carefully:",
		"- Required validations before finishing:",
		"- Changes that need explicit approval:",
		"",
		"## Notes for Takumi",
		"",
		"- Keep edits small and focused.",
		"- Preserve public APIs unless the task requires change.",
		"- Update tests and docs when behavior changes.",
	].join("\n")}
`;
}

export function formatTakumiProjectInstructionsFile(projectName?: string): string {
	return buildTakumiProjectInstructionsTemplate(projectName);
}

export function inspectTakumiProjectInstructions(cwd = process.cwd()): TakumiProjectInstructionsInspection {
	const projectRoot = findProjectRoot(cwd) ?? resolve(cwd);
	const searchPaths = PROJECT_INSTRUCTION_FILES.map((relativePath) => {
		const path = join(projectRoot, relativePath);
		return {
			path,
			kind: instructionPathKind(relativePath),
			exists: existsSync(path),
		} satisfies ProjectInstructionPathEntry;
	});

	return {
		projectRoot,
		activePath: searchPaths.find((entry) => entry.exists)?.path ?? null,
		defaultPath: join(projectRoot, PROJECT_INSTRUCTION_FILES[0]),
		searchPaths,
	};
}

export async function ensureTakumiProjectInstructionsFile(
	cwd = process.cwd(),
): Promise<EnsuredTakumiProjectInstructionsFile> {
	const inspection = inspectTakumiProjectInstructions(cwd);
	const filePath = inspection.defaultPath;
	try {
		await access(filePath, fsConstants.F_OK);
		return { filePath, created: false, projectRoot: inspection.projectRoot };
	} catch {
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, formatTakumiProjectInstructionsFile(detectProjectName(inspection.projectRoot)), "utf-8");
		return { filePath, created: true, projectRoot: inspection.projectRoot };
	}
}

export function getTakumiProjectInstructionsPath(cwd = process.cwd()): string {
	return inspectTakumiProjectInstructions(cwd).defaultPath;
}

export function formatTakumiProjectInstructionsInspection(inspection: TakumiProjectInstructionsInspection): string {
	const lines = [`Project root: ${inspection.projectRoot}`];

	if (inspection.activePath) {
		lines.push(`Active instructions: ${inspection.activePath}`);
	} else {
		lines.push(`No project instructions file found. Default Takumi path: ${inspection.defaultPath}`);
	}

	lines.push("Search order:");
	inspection.searchPaths.forEach((entry, index) => {
		const marker = entry.path === inspection.activePath ? "▶" : entry.exists ? "•" : "○";
		lines.push(`  ${marker} ${index + 1}. ${entry.path} (${formatInstructionPathKind(entry.kind)})`);
	});

	return lines.join("\n");
}

export function tryRevealTakumiProjectInstructionsFile(filePath: string): {
	opened: boolean;
	command?: string;
	error?: string;
} {
	const launch = resolveRevealCommand(filePath);
	if (!launch) {
		return { opened: false, error: "automatic file reveal is unavailable on this platform" };
	}

	const result = spawnSync(launch.command, launch.args, { stdio: "ignore" });
	if (result.error || (result.status ?? 0) !== 0) {
		const reason = result.error?.message ?? `command exited with status ${result.status ?? "unknown"}`;
		return {
			opened: false,
			command: [launch.command, ...launch.args].join(" "),
			error: reason,
		};
	}

	return {
		opened: true,
		command: [launch.command, ...launch.args].join(" "),
	};
}

function findProjectRoot(from: string): string | null {
	let dir = resolve(from);

	for (let depth = 0; depth < 20; depth++) {
		if (ROOT_MARKERS.some((marker) => existsSync(join(dir, marker)))) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	return null;
}

function detectProjectName(projectRoot: string): string {
	const packageJsonPath = join(projectRoot, "package.json");
	if (existsSync(packageJsonPath)) {
		try {
			const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { name?: string };
			if (typeof pkg.name === "string" && pkg.name.trim().length > 0) {
				return pkg.name.trim();
			}
		} catch {
			/* ignore */
		}
	}

	const cargoPath = join(projectRoot, "Cargo.toml");
	if (existsSync(cargoPath)) {
		try {
			const content = readFileSync(cargoPath, "utf-8");
			const match = content.match(/name\s*=\s*"([^"]+)"/);
			if (match?.[1]) return match[1];
		} catch {
			/* ignore */
		}
	}

	const goModPath = join(projectRoot, "go.mod");
	if (existsSync(goModPath)) {
		try {
			const content = readFileSync(goModPath, "utf-8");
			const match = content.match(/module\s+(\S+)/);
			if (match?.[1]) return match[1];
		} catch {
			/* ignore */
		}
	}

	return basename(projectRoot);
}

function instructionPathKind(relativePath: (typeof PROJECT_INSTRUCTION_FILES)[number]): ProjectInstructionPathKind {
	switch (relativePath) {
		case "TAKUMI.md":
			return "takumi-root";
		case "CLAUDE.md":
			return "claude-root";
		case ".takumi/instructions.md":
			return "takumi-local";
		case ".claude/instructions.md":
			return "claude-local";
	}
}

function formatInstructionPathKind(kind: ProjectInstructionPathKind): string {
	switch (kind) {
		case "takumi-root":
			return "project TAKUMI.md";
		case "claude-root":
			return "project CLAUDE.md";
		case "takumi-local":
			return "project .takumi/instructions.md";
		case "claude-local":
			return "project .claude/instructions.md";
	}
}

function resolveRevealCommand(filePath: string): LaunchCommand | null {
	if (IS_MACOS) {
		return { command: "open", args: [filePath] };
	}
	if (IS_LINUX) {
		return { command: "xdg-open", args: [filePath] };
	}
	if (IS_WINDOWS) {
		return { command: "cmd.exe", args: ["/c", "start", "", filePath] };
	}
	return null;
}
