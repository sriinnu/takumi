import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { IS_LINUX, IS_MACOS, IS_WINDOWS, resolveConfigDir } from "@takumi/core";
import type { KeyBindingRegistry } from "./keybinds.js";

export interface ResolvedKeybindingDefinition {
	id: string;
	key: string;
	description: string;
	aliases: string[];
	enabled: boolean;
}

export interface KeybindingConfigEntry {
	key?: string;
	aliases?: string[];
	enabled?: boolean;
	description?: string;
}

export interface KeybindingConfigFile {
	version: 1;
	bindings: Record<string, KeybindingConfigEntry>;
}

export interface KeybindingConfigLoadResult {
	filePath: string;
	found: boolean;
	definitions: ResolvedKeybindingDefinition[];
	skipped: string[];
	error?: string;
}

interface LaunchCommand {
	command: string;
	args: string[];
}

export const DEFAULT_KEYBINDING_DEFINITIONS: readonly ResolvedKeybindingDefinition[] = [
	{ id: "app.quit", key: "ctrl+q", description: "Quit", aliases: [], enabled: true },
	{ id: "app.screen.clear", key: "ctrl+l", description: "Clear screen", aliases: [], enabled: true },
	{
		id: "app.command-palette.toggle",
		key: "ctrl+k",
		description: "Command palette",
		aliases: [],
		enabled: true,
	},
	{ id: "app.preview.toggle", key: "ctrl+p", description: "Toggle preview", aliases: [], enabled: true },
	{ id: "app.model-picker.toggle", key: "alt+m", description: "Model picker", aliases: [], enabled: true },
	{ id: "app.sidebar.toggle", key: "ctrl+b", description: "Toggle sidebar", aliases: [], enabled: true },
	{
		id: "app.cluster-status.toggle",
		key: "ctrl+shift+c",
		description: "Toggle cluster status",
		aliases: [],
		enabled: true,
	},
	{ id: "app.sessions.list", key: "ctrl+o", description: "Session list", aliases: [], enabled: true },
	{ id: "app.sessions.tree", key: "ctrl+t", description: "Session tree", aliases: [], enabled: true },
	{
		id: "app.exit-if-editor-empty",
		key: "ctrl+d",
		description: "Exit when editor is empty",
		aliases: [],
		enabled: true,
	},
	{ id: "app.thinking.cycle", key: "shift+tab", description: "Toggle thinking", aliases: [], enabled: true },
	{ id: "app.model.cycle", key: "ctrl+shift+m", description: "Cycle model", aliases: [], enabled: true },
	{ id: "app.editor.external", key: "ctrl+g", description: "External editor", aliases: [], enabled: true },
];

const KEYBINDINGS_FILE_NAME = "keybindings.json";

export function getUserKeybindingConfigPath(): string {
	return join(resolveConfigDir(), KEYBINDINGS_FILE_NAME);
}

export function buildKeybindingConfigFile(
	definitions: readonly ResolvedKeybindingDefinition[] = DEFAULT_KEYBINDING_DEFINITIONS,
): KeybindingConfigFile {
	return {
		version: 1,
		bindings: Object.fromEntries(
			definitions.map((definition) => [
				definition.id,
				{
					key: definition.key,
					aliases: [...definition.aliases],
					enabled: definition.enabled,
					description: definition.description,
				},
			]),
		),
	};
}

export function formatKeybindingConfigFile(
	definitions: readonly ResolvedKeybindingDefinition[] = DEFAULT_KEYBINDING_DEFINITIONS,
): string {
	return `${JSON.stringify(buildKeybindingConfigFile(definitions), null, "\t")}\n`;
}

export async function ensureUserKeybindingConfigFile(
	filePath = getUserKeybindingConfigPath(),
): Promise<{ filePath: string; created: boolean }> {
	try {
		await access(filePath, constants.F_OK);
		return { filePath, created: false };
	} catch {
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, formatKeybindingConfigFile(), "utf-8");
		return { filePath, created: true };
	}
}

export async function loadUserKeybindingDefinitions(
	filePath = getUserKeybindingConfigPath(),
): Promise<KeybindingConfigLoadResult> {
	let raw: string;
	try {
		raw = await readFile(filePath, "utf-8");
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
			return {
				filePath,
				found: false,
				definitions: cloneDefinitions(),
				skipped: [],
			};
		}
		return {
			filePath,
			found: false,
			definitions: cloneDefinitions(),
			skipped: [],
			error: error instanceof Error ? error.message : String(error),
		};
	}

	try {
		const parsed = parseKeybindingConfigFile(raw);
		const resolved = resolveKeybindingDefinitions(parsed);
		return {
			filePath,
			found: true,
			definitions: resolved.definitions,
			skipped: resolved.skipped,
		};
	} catch (error) {
		return {
			filePath,
			found: true,
			definitions: cloneDefinitions(),
			skipped: [],
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export function syncDefaultKeybindingRegistry(
	registry: KeyBindingRegistry,
	handlers: Record<string, () => void>,
	definitions: readonly ResolvedKeybindingDefinition[] = DEFAULT_KEYBINDING_DEFINITIONS,
): void {
	for (const definition of DEFAULT_KEYBINDING_DEFINITIONS) {
		registry.unregisterById(definition.id);
	}

	for (const definition of definitions) {
		const handler = handlers[definition.id];
		if (!handler) {
			continue;
		}
		registry.register(definition.key, definition.description, handler, {
			id: definition.id,
			aliases: definition.aliases,
		});
		registry.setEnabledById(definition.id, definition.enabled);
	}
}

export function formatKeybindingReloadSummary(result: KeybindingConfigLoadResult): string {
	const lines: string[] = [];

	if (result.error) {
		lines.push("Keybindings reloaded with errors.");
		lines.push(`Using built-in defaults because ${result.error}`);
	} else if (!result.found) {
		lines.push("No custom keybindings file found — using built-in defaults.");
	} else {
		lines.push("Keybindings reloaded.");
	}

	lines.push(`File: ${result.filePath}`);

	if (result.skipped.length > 0) {
		lines.push("");
		lines.push("Skipped entries:");
		lines.push(...result.skipped.map((entry) => `  - ${entry}`));
	}

	lines.push("");
	lines.push("Edit the file and run /keybindings reload again, or restart Takumi.");
	return lines.join("\n");
}

export function formatKeybindingStartupNotice(result: KeybindingConfigLoadResult): string | null {
	if (!result.error && result.skipped.length === 0) {
		return null;
	}

	const lines: string[] = ["Keybindings config note:"];
	if (result.error) {
		lines.push(`Using built-in defaults because ${result.error}`);
	} else {
		lines.push(
			`Loaded ${result.filePath} with ${result.skipped.length} skipped entr${result.skipped.length === 1 ? "y" : "ies"}.`,
		);
	}
	if (result.skipped.length > 0) {
		lines.push(...result.skipped.map((entry) => `  - ${entry}`));
	}
	return lines.join("\n");
}

export function tryRevealKeybindingConfigFile(filePath: string): { opened: boolean; command?: string; error?: string } {
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

function cloneDefinitions(): ResolvedKeybindingDefinition[] {
	return DEFAULT_KEYBINDING_DEFINITIONS.map((definition) => ({
		...definition,
		aliases: [...definition.aliases],
	}));
}

function parseKeybindingConfigFile(raw: string): KeybindingConfigFile {
	const parsed = JSON.parse(raw) as unknown;
	if (!isRecord(parsed)) {
		throw new Error("the keybindings config must be a JSON object");
	}
	if (parsed.version !== 1) {
		throw new Error("the keybindings config must declare version 1");
	}
	if (!isRecord(parsed.bindings)) {
		throw new Error("the keybindings config must include a bindings object");
	}

	const bindings: Record<string, KeybindingConfigEntry> = {};
	for (const [id, value] of Object.entries(parsed.bindings)) {
		if (!isRecord(value)) {
			throw new Error(`binding "${id}" must be an object`);
		}

		const entry: KeybindingConfigEntry = {};
		if (value.key !== undefined) {
			if (typeof value.key !== "string" || !value.key.trim()) {
				throw new Error(`binding "${id}".key must be a non-empty string`);
			}
			entry.key = value.key.trim();
		}
		if (value.aliases !== undefined) {
			if (!Array.isArray(value.aliases) || value.aliases.some((alias) => typeof alias !== "string" || !alias.trim())) {
				throw new Error(`binding "${id}".aliases must be an array of non-empty strings`);
			}
			entry.aliases = value.aliases.map((alias) => alias.trim());
		}
		if (value.enabled !== undefined) {
			if (typeof value.enabled !== "boolean") {
				throw new Error(`binding "${id}".enabled must be true or false`);
			}
			entry.enabled = value.enabled;
		}
		if (value.description !== undefined) {
			if (typeof value.description !== "string") {
				throw new Error(`binding "${id}".description must be a string`);
			}
			entry.description = value.description;
		}
		bindings[id.trim().toLowerCase()] = entry;
	}

	return { version: 1, bindings };
}

function resolveKeybindingDefinitions(config: KeybindingConfigFile): {
	definitions: ResolvedKeybindingDefinition[];
	skipped: string[];
} {
	const knownIds = new Set(DEFAULT_KEYBINDING_DEFINITIONS.map((definition) => definition.id));
	const skipped = Object.keys(config.bindings)
		.filter((id) => !knownIds.has(id))
		.map((id) => `${id} (unknown action)`);

	const definitions = DEFAULT_KEYBINDING_DEFINITIONS.map((definition) => {
		const override = config.bindings[definition.id];
		return {
			...definition,
			key: override?.key ?? definition.key,
			aliases: override?.aliases ? [...override.aliases] : [...definition.aliases],
			enabled: override?.enabled ?? definition.enabled,
		};
	});

	return { definitions, skipped };
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
