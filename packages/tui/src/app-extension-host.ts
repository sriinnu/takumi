/**
 * App extension host bridge.
 *
 * I register extension-defined commands and shortcuts into the TUI host
 * surfaces without letting extensions silently clobber built-ins.
 */

import { basename } from "node:path";
import type {
	ExtensionCommandContext,
	ExtensionRunner,
	LoadedExtension,
	RegisteredCommand,
	RegisteredShortcut,
} from "@takumi/agent";
import type { SessionData } from "@takumi/core";
import { createLogger, generateSessionId } from "@takumi/core";
import type { SlashCommandRegistry } from "./commands/commands.js";
import type { KeyBindingRegistry } from "./input/keybinds.js";
import { registerSlashCommandContribution } from "./slash-commands/pack.js";
import type { AppState } from "./state.js";

const log = createLogger("app-extension-host");

type ExtensionResidency = "project" | "global" | "package" | "unknown";

interface ExtensionOriginMetadata {
	residency: ExtensionResidency;
	packageId?: string;
	packageName?: string;
	packageSource?: string;
}

type HostLoadedExtension = LoadedExtension & {
	origin?: ExtensionOriginMetadata;
};

export interface ExtensionHostRegistrationReport {
	commandCount: number;
	shortcutCount: number;
	renamedCommands: string[];
	skippedShortcuts: string[];
	invalidCommands: string[];
}

export interface ExtensionHostSnapshotEntry {
	path: string;
	resolvedPath: string;
	commandPackId: string;
	residency: ExtensionResidency;
	packageId: string | null;
	packageName: string | null;
	packageSource: string | null;
	label: string;
	displayName: string;
	manifestName: string | null;
	version: string | null;
	description: string | null;
	author: string | null;
	homepage: string | null;
	commandCount: number;
	shortcutCount: number;
	toolCount: number;
	handlerCount: number;
	commands: string[];
	shortcuts: string[];
	tools: string[];
	events: string[];
}

export interface ExtensionHostSnapshot {
	extensionCount: number;
	commandCount: number;
	shortcutCount: number;
	toolCount: number;
	handlerCount: number;
	extensions: ExtensionHostSnapshotEntry[];
}

export interface RegisterExtensionHostSurfacesOptions {
	extensionRunner: ExtensionRunner;
	commands: SlashCommandRegistry;
	keybinds: KeyBindingRegistry;
	state: AppState;
	addInfoMessage(text: string): void;
	activateSession(session: SessionData, notice?: string, reason?: "new" | "resume"): Promise<void>;
	resumeSession(sessionId: string): Promise<void>;
}

/** Register extension commands and shortcuts into the TUI host. */
export function registerExtensionHostSurfaces(
	options: RegisterExtensionHostSurfacesOptions,
): ExtensionHostRegistrationReport {
	const extensionLookup = buildExtensionLookup(options.extensionRunner);
	const report: ExtensionHostRegistrationReport = {
		commandCount: 0,
		shortcutCount: 0,
		renamedCommands: [],
		skippedShortcuts: [],
		invalidCommands: [],
	};

	for (const { command, extensionPath } of options.extensionRunner.getAllCommands().values()) {
		registerExtensionCommand(options, report, command, extensionPath, extensionLookup.get(extensionPath));
	}

	for (const shortcut of options.extensionRunner.getAllShortcuts().values()) {
		registerExtensionShortcut(options, report, shortcut, extensionLookup.get(shortcut.extensionPath));
	}

	return report;
}

/** Format a compact operator-facing summary for extension host registration. */
export function formatExtensionHostReport(report: ExtensionHostRegistrationReport): string | null {
	const lines = [`Extensions ready`, `Commands: ${report.commandCount}`, `Shortcuts: ${report.shortcutCount}`];
	if (report.renamedCommands.length > 0) lines.push(`Renamed commands: ${report.renamedCommands.join(", ")}`);
	if (report.skippedShortcuts.length > 0) lines.push(`Skipped shortcuts: ${report.skippedShortcuts.join(", ")}`);
	if (report.invalidCommands.length > 0) lines.push(`Invalid commands: ${report.invalidCommands.join(", ")}`);
	return lines.length > 3 ? lines.join("\n") : null;
}

/**
 * I build a stable operator-facing snapshot of the loaded extension host.
 *
 * I keep this separate from registration so commands, diagnostics, and future
 * remote clients can inspect the same live extension picture.
 */
export function inspectExtensionHost(extensionRunner: ExtensionRunner): ExtensionHostSnapshot {
	const extensions = getLoadedExtensions(extensionRunner)
		.map((extension) => {
			const label = extensionLabel(extension.path, extension);
			const commandPackId = extensionPackId(extension.path, extension);
			const manifestName = extension.manifest?.name?.trim() || null;
			const events = [...extension.handlers.entries()]
				.filter(([, handlers]) => handlers.length > 0)
				.map(([event]) => event)
				.sort((left, right) => left.localeCompare(right));
			const commands = [...extension.commands.keys()].sort((left, right) => left.localeCompare(right));
			const shortcuts = [...extension.shortcuts.keys()].sort((left, right) => left.localeCompare(right));
			const tools = [...extension.tools.keys()].sort((left, right) => left.localeCompare(right));
			const handlerCount = [...extension.handlers.values()].reduce((total, handlers) => total + handlers.length, 0);
			return {
				path: extension.path,
				resolvedPath: extension.resolvedPath,
				commandPackId,
				residency: extension.origin?.residency ?? "unknown",
				packageId: extension.origin?.packageId ?? null,
				packageName: extension.origin?.packageName ?? null,
				packageSource: extension.origin?.packageSource ?? null,
				label,
				displayName: manifestName || label,
				manifestName,
				version: extension.manifest?.version?.trim() || null,
				description: extension.manifest?.description?.trim() || null,
				author: extension.manifest?.author?.trim() || null,
				homepage: extension.manifest?.homepage?.trim() || null,
				commandCount: commands.length,
				shortcutCount: shortcuts.length,
				toolCount: tools.length,
				handlerCount,
				commands,
				shortcuts,
				tools,
				events,
			} satisfies ExtensionHostSnapshotEntry;
		})
		.sort((left, right) => left.displayName.localeCompare(right.displayName));

	return {
		extensionCount: extensions.length,
		commandCount: extensions.reduce((total, extension) => total + extension.commandCount, 0),
		shortcutCount: extensions.reduce((total, extension) => total + extension.shortcutCount, 0),
		toolCount: extensions.reduce((total, extension) => total + extension.toolCount, 0),
		handlerCount: extensions.reduce((total, extension) => total + extension.handlerCount, 0),
		extensions,
	};
}

function registerExtensionCommand(
	options: RegisterExtensionHostSurfacesOptions,
	report: ExtensionHostRegistrationReport,
	command: RegisteredCommand,
	extensionPath: string,
	extension?: HostLoadedExtension,
): void {
	const requestedName = normalizeSlashCommandName(command.name);
	if (!requestedName) {
		report.invalidCommands.push(`${command.name} (${extensionLabel(extensionPath, extension)})`);
		log.warn(`Skipping invalid extension command "${command.name}" from ${extensionPath}`);
		return;
	}

	const resolvedName = allocateCommandName(options.commands, requestedName, extensionPath, extension);
	if (resolvedName !== requestedName) {
		report.renamedCommands.push(`${requestedName} -> ${resolvedName}`);
	}

	registerSlashCommandContribution(options.commands, {
		name: resolvedName,
		requestedName,
		source: "external",
		residency: extension?.origin?.residency,
		packId: extensionPackId(extensionPath, extension),
		packLabel: extensionLabel(extensionPath, extension),
		description: describeExtensionCommand(command, extensionPath, requestedName, resolvedName, extension),
		handler: async (args) => {
			try {
				const ctx = createCommandContext(options, extensionPath);
				await command.handler(args, ctx);
			} catch (error) {
				const message = (error as Error).message || String(error);
				log.error(`Extension command ${resolvedName} failed`, error);
				options.addInfoMessage(`Extension command ${resolvedName} failed: ${message}`);
			}
		},
		getArgumentCompletions: command.getArgumentCompletions
			? async (partial) => {
					try {
						return (
							(await command.getArgumentCompletions?.(partial, options.extensionRunner.createContext(extensionPath))) ??
							[]
						);
					} catch (error) {
						log.warn(`Extension command completions failed for ${resolvedName}`, error);
						return [];
					}
				}
			: undefined,
	});
	report.commandCount += 1;
}

function registerExtensionShortcut(
	options: RegisterExtensionHostSurfacesOptions,
	report: ExtensionHostRegistrationReport,
	shortcut: RegisteredShortcut,
	extension?: HostLoadedExtension,
): void {
	if (options.keybinds.get(shortcut.key)) {
		const skipped = `${shortcut.key} (${extensionLabel(shortcut.extensionPath, extension)})`;
		report.skippedShortcuts.push(skipped);
		log.warn(`Skipping extension shortcut ${shortcut.key} from ${shortcut.extensionPath}; key is already in use`);
		return;
	}

	options.keybinds.register(
		shortcut.key,
		describeExtensionShortcut(shortcut, extension),
		() => {
			void runExtensionShortcut(options, shortcut);
		},
		{ id: buildShortcutId(shortcut, extension) },
	);
	report.shortcutCount += 1;
}

async function runExtensionShortcut(
	options: RegisterExtensionHostSurfacesOptions,
	shortcut: RegisteredShortcut,
): Promise<void> {
	try {
		await shortcut.handler(options.extensionRunner.createContext(shortcut.extensionPath));
	} catch (error) {
		const message = (error as Error).message || String(error);
		log.error(`Extension shortcut ${shortcut.key} failed`, error);
		options.addInfoMessage(`Extension shortcut ${shortcut.key} failed: ${message}`);
	}
}

function createCommandContext(
	options: RegisterExtensionHostSurfacesOptions,
	extensionPath: string,
): ExtensionCommandContext {
	const ctx = Object.create(options.extensionRunner.createContext(extensionPath)) as ExtensionCommandContext;
	ctx.waitForIdle = () => waitForIdle(options.state);
	ctx.newSession = () => startNewSession(options);
	ctx.switchSession = (sessionId) => switchSession(options, sessionId);
	return ctx;
}

async function waitForIdle(state: AppState): Promise<void> {
	if (!state.isStreaming.value) return;
	await new Promise<void>((resolve) => {
		const MAX_WAIT = 30_000;
		const start = Date.now();
		const poll = setInterval(() => {
			if (!state.isStreaming.value || Date.now() - start > MAX_WAIT) {
				clearInterval(poll);
				resolve();
			}
		}, 20);
	});
}

async function startNewSession(options: RegisterExtensionHostSurfacesOptions): Promise<{ cancelled: boolean }> {
	await waitForIdle(options.state);
	const nextSessionId = generateSessionId();
	await options.activateSession(
		{
			id: nextSessionId,
			title: "Untitled session",
			createdAt: Date.now(),
			updatedAt: Date.now(),
			messages: [],
			model: options.state.model.value,
			tokenUsage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
		},
		`Started new session ${nextSessionId}.`,
		"new",
	);
	return { cancelled: options.state.sessionId.value !== nextSessionId };
}

async function switchSession(
	options: RegisterExtensionHostSurfacesOptions,
	sessionId: string,
): Promise<{ cancelled: boolean }> {
	await waitForIdle(options.state);
	await options.resumeSession(sessionId);
	return { cancelled: options.state.sessionId.value !== sessionId };
}

function allocateCommandName(
	commands: SlashCommandRegistry,
	requestedName: string,
	extensionPath: string,
	extension?: HostLoadedExtension,
): string {
	if (!commands.has(requestedName)) return requestedName;
	const suffix = extensionSlug(extensionPath, extension);
	let attempt = `${requestedName}.${suffix}`;
	let counter = 2;
	while (commands.has(attempt)) {
		attempt = `${requestedName}.${suffix}-${counter}`;
		counter += 1;
	}
	return attempt;
}

function buildShortcutId(shortcut: RegisteredShortcut, extension?: HostLoadedExtension): string {
	return `extension.${extensionSlug(shortcut.extensionPath, extension)}.${shortcut.key.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
}

function describeExtensionCommand(
	command: RegisteredCommand,
	extensionPath: string,
	requestedName: string,
	resolvedName: string,
	extension?: HostLoadedExtension,
): string {
	const label = extensionLabel(extensionPath, extension);
	const base = command.description?.trim() || `Extension command from ${label}`;
	if (requestedName === resolvedName) return `${base} [ext:${label}]`;
	return `${base} [ext:${label}, requested ${requestedName}]`;
}

function describeExtensionShortcut(shortcut: RegisteredShortcut, extension?: HostLoadedExtension): string {
	const base = shortcut.description?.trim() || "Extension shortcut";
	return `${base} [ext:${extensionLabel(shortcut.extensionPath, extension)}]`;
}

function normalizeSlashCommandName(name: string): string | null {
	const trimmed = name.trim();
	if (!trimmed) return null;
	const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
	return /\s/.test(normalized) ? null : normalized;
}

function getLoadedExtensions(extensionRunner: ExtensionRunner): HostLoadedExtension[] {
	return Array.isArray(extensionRunner._extensions) ? (extensionRunner._extensions as HostLoadedExtension[]) : [];
}

function buildExtensionLookup(extensionRunner: ExtensionRunner): Map<string, HostLoadedExtension> {
	const lookup = new Map<string, HostLoadedExtension>();
	for (const extension of getLoadedExtensions(extensionRunner)) {
		lookup.set(extension.path, extension);
		lookup.set(extension.resolvedPath, extension);
	}
	return lookup;
}

function extensionPackId(extensionPath: string, extension?: HostLoadedExtension): string {
	if (extension?.origin?.residency === "package" && extension.origin.packageId) {
		return `package:${extension.origin.packageId}`;
	}
	return `extension:${extensionSlug(extensionPath, extension)}`;
}

function extensionLabel(extensionPath: string, extension?: HostLoadedExtension): string {
	if (extension?.origin?.residency === "package" && extension.origin.packageName) {
		return extension.origin.packageName;
	}
	return basename(extensionPath).replace(/\.[^.]+$/, "") || "extension";
}

function extensionSlug(extensionPath: string, extension?: HostLoadedExtension): string {
	const base =
		extension?.origin?.residency === "package"
			? extension.origin.packageId || extension.origin.packageName
			: extensionLabel(extensionPath, extension);
	return (
		(base || extensionLabel(extensionPath, extension))
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "extension"
	);
}
