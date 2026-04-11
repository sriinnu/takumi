import { execFile, spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { currentPlatform, IS_LINUX, IS_MACOS, IS_WINDOWS } from "./platform-detect.js";

export type IdeLauncherId = "cursor" | "vscode" | "vscode-insiders" | "windsurf" | "zed" | "sublime" | "system";

export interface IdeLauncherDefinition {
	id: IdeLauncherId;
	label: string;
	command: string;
	aliases: string[];
	source: "cli" | "system";
	probeArgs: string[];
	launchArgs?: string[];
}

export interface IdeLauncherAvailability extends IdeLauncherDefinition {
	available: boolean;
	reason?: string;
}

export interface OpenInIdeOptions {
	selector?: string;
	targetPath?: string;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	availability?: IdeLauncherAvailability[];
	probe?: CommandProbe;
	spawnDetached?: SpawnDetached;
}

export interface OpenInIdeResult {
	opened: boolean;
	targetPath: string;
	launcher?: IdeLauncherAvailability;
	error?: string;
}

export interface FormatIdeStatusOptions {
	targetPath: string;
	launchers: IdeLauncherAvailability[];
	env?: NodeJS.ProcessEnv;
	usageLine?: string;
}

export type CommandProbe = (command: string, args: string[]) => Promise<boolean>;
export type SpawnDetached = (command: string, args: string[]) => Promise<void>;

const CLI_LAUNCHERS: readonly IdeLauncherDefinition[] = [
	{
		id: "cursor",
		label: "Cursor",
		command: "cursor",
		aliases: ["cursor-ai"],
		source: "cli",
		probeArgs: ["--version"],
	},
	{
		id: "vscode",
		label: "VS Code",
		command: "code",
		aliases: ["vscode", "vs-code"],
		source: "cli",
		probeArgs: ["--version"],
	},
	{
		id: "vscode-insiders",
		label: "VS Code Insiders",
		command: "code-insiders",
		aliases: ["insiders", "vscode-insiders", "vs-code-insiders"],
		source: "cli",
		probeArgs: ["--version"],
	},
	{
		id: "windsurf",
		label: "Windsurf",
		command: "windsurf",
		aliases: ["wave", "windsurf-editor"],
		source: "cli",
		probeArgs: ["--version"],
	},
	{
		id: "zed",
		label: "Zed",
		command: "zed",
		aliases: [],
		source: "cli",
		probeArgs: ["--version"],
	},
	{
		id: "sublime",
		label: "Sublime Text",
		command: "subl",
		aliases: ["sublime"],
		source: "cli",
		probeArgs: ["--version"],
	},
];

function getSystemLauncher(): IdeLauncherDefinition {
	if (IS_MACOS) {
		return {
			id: "system",
			label: "System default",
			command: "open",
			aliases: ["default", "system", "finder"],
			source: "system",
			probeArgs: [],
		};
	}

	if (IS_WINDOWS) {
		return {
			id: "system",
			label: "System default",
			command: "explorer",
			aliases: ["default", "system", "explorer"],
			source: "system",
			probeArgs: [],
		};
	}

	if (IS_LINUX) {
		return {
			id: "system",
			label: "System default",
			command: "xdg-open",
			aliases: ["default", "system"],
			source: "system",
			probeArgs: ["--help"],
		};
	}

	return {
		id: "system",
		label: "System default",
		command: "open",
		aliases: ["default", "system"],
		source: "system",
		probeArgs: [],
	};
}

function normalizeSelector(value: string): string {
	return value.trim().toLowerCase();
}

function stripExecutableSuffix(value: string): string {
	return value.replace(/\.(cmd|exe|bat)$/i, "");
}

function extractCommandToken(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	const match = trimmed.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
	const token = match?.[1] ?? match?.[2] ?? match?.[3];
	if (!token) return undefined;
	return stripExecutableSuffix(path.basename(token)).toLowerCase();
}

function matchLauncherSelector<T extends { id: string; command: string; aliases: string[] }>(
	launchers: readonly T[],
	selector: string,
): T | null {
	const normalized = normalizeSelector(selector);
	if (!normalized) return null;
	return (
		launchers.find((launcher) => {
			const candidates = [launcher.id, launcher.command, ...launcher.aliases].map((candidate) =>
				normalizeSelector(stripExecutableSuffix(candidate)),
			);
			return candidates.includes(normalized);
		}) ?? null
	);
}

function defaultProbe(command: string, args: string[]): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const child = execFile(command, args, { timeout: 2000 }, (error) => {
			resolve(!error);
		});
		child.once("error", () => resolve(false));
	});
}

function defaultSpawnDetached(command: string, args: string[]): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, {
			detached: true,
			stdio: "ignore",
			windowsHide: true,
		});

		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
}

export function listIdeLaunchers(): IdeLauncherDefinition[] {
	return [...CLI_LAUNCHERS, getSystemLauncher()];
}

export function listIdeLauncherIds(): string[] {
	return listIdeLaunchers().map((launcher) => launcher.id);
}

export function findIdeLauncher(selector: string): IdeLauncherDefinition | null {
	return matchLauncherSelector(listIdeLaunchers(), selector);
}

export function resolveConfiguredIdeSelector(env: NodeJS.ProcessEnv = process.env): string | undefined {
	return extractCommandToken(env.TAKUMI_IDE) ?? extractCommandToken(env.VISUAL) ?? extractCommandToken(env.EDITOR);
}

export function resolveIdeTargetPath(targetPath?: string, cwd = process.cwd()): string {
	const raw = targetPath?.trim();
	if (!raw) return cwd;
	if (raw === "~") return homedir();
	if (raw.startsWith("~/")) return path.join(homedir(), raw.slice(2));
	return path.resolve(cwd, raw);
}

export async function detectAvailableIdeLaunchers(options?: {
	env?: NodeJS.ProcessEnv;
	probe?: CommandProbe;
}): Promise<IdeLauncherAvailability[]> {
	const probe = options?.probe ?? defaultProbe;
	const launchers = listIdeLaunchers();

	return Promise.all(
		launchers.map(async (launcher) => {
			let available = false;
			if (launcher.source === "system" && (currentPlatform() === "macos" || currentPlatform() === "windows")) {
				available = true;
			} else {
				available = await probe(launcher.command, launcher.probeArgs);
			}

			return {
				...launcher,
				available,
				reason: available ? undefined : `${launcher.command} not found`,
			};
		}),
	);
}

export function selectIdeLauncher(
	launchers: readonly IdeLauncherAvailability[],
	selector?: string,
	env: NodeJS.ProcessEnv = process.env,
): IdeLauncherAvailability | null {
	if (selector) {
		const requested = matchLauncherSelector(launchers, selector);
		return requested?.available ? requested : null;
	}

	const configured = resolveConfiguredIdeSelector(env);
	if (configured) {
		const preferred = matchLauncherSelector(launchers, configured);
		if (preferred?.available) return preferred;
	}

	return (
		launchers.find((launcher) => launcher.available && launcher.source === "cli") ??
		launchers.find((launcher) => launcher.available) ??
		null
	);
}

export function formatIdeStatus(options: FormatIdeStatusOptions): string {
	const defaultLauncher = selectIdeLauncher(options.launchers, undefined, options.env);
	const configured = resolveConfiguredIdeSelector(options.env);
	const available = options.launchers.filter((launcher) => launcher.available);
	const unavailable = options.launchers.filter((launcher) => !launcher.available);
	const lines = [
		`IDE target: ${options.targetPath}`,
		`Default launcher: ${defaultLauncher ? `${defaultLauncher.label} (${defaultLauncher.command})` : "none detected"}`,
		`Available launchers: ${available.length > 0 ? available.map((launcher) => `${launcher.label} [${launcher.id}]`).join(", ") : "none"}`,
	];

	if (configured) {
		lines.push(`Configured via env: ${configured}`);
	}

	if (unavailable.length > 0) {
		lines.push(
			`Unavailable launchers: ${unavailable.map((launcher) => `${launcher.label} [${launcher.id}]`).join(", ")}`,
		);
	}

	if (options.usageLine) {
		lines.push(options.usageLine);
	}

	return lines.join("\n");
}

export async function openInIde(options: OpenInIdeOptions = {}): Promise<OpenInIdeResult> {
	const cwd = options.cwd ?? process.cwd();
	const targetPath = resolveIdeTargetPath(options.targetPath, cwd);
	const launchers =
		options.availability ?? (await detectAvailableIdeLaunchers({ env: options.env, probe: options.probe }));

	let launcher: IdeLauncherAvailability | null = null;
	if (options.selector) {
		const requested = matchLauncherSelector(launchers, options.selector);
		if (!requested) {
			return {
				opened: false,
				targetPath,
				error: `Unknown IDE launcher: ${options.selector}. Known launchers: ${listIdeLauncherIds().join(", ")}`,
			};
		}
		if (!requested.available) {
			return {
				opened: false,
				targetPath,
				launcher: requested,
				error: `${requested.label} is not available (${requested.reason ?? "not detected"})`,
			};
		}
		launcher = requested;
	} else {
		launcher = selectIdeLauncher(launchers, undefined, options.env);
	}

	if (!launcher) {
		return {
			opened: false,
			targetPath,
			error: "No IDE launcher is available. Install a launcher like Cursor/VS Code/Zed or set TAKUMI_IDE.",
		};
	}

	try {
		const spawnDetached = options.spawnDetached ?? defaultSpawnDetached;
		await spawnDetached(launcher.command, [...(launcher.launchArgs ?? []), targetPath]);
		return {
			opened: true,
			targetPath,
			launcher,
		};
	} catch (error) {
		return {
			opened: false,
			targetPath,
			launcher,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
