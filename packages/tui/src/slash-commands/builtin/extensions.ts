import { inspectExtensionHost } from "../../app-extension-host.js";
import type { AppCommandContext } from "../../commands/app-command-context.js";
import type { SlashCommandPack } from "../pack.js";

const EXTENSIONS_USAGE = "Usage: /extensions [list|summary|show <index|name|path>]";

function formatExtensionResidency(extension: ReturnType<typeof inspectExtensionHost>["extensions"][number]): string {
	if (extension.residency === "package") {
		const packageLabel = extension.packageName ?? extension.packageId ?? "package";
		return extension.packageSource ? `package:${packageLabel} [${extension.packageSource}]` : `package:${packageLabel}`;
	}
	return extension.residency;
}

function formatExtensionSummary(snapshot: ReturnType<typeof inspectExtensionHost>): string {
	return [
		`Extensions: ${snapshot.extensionCount}`,
		`Commands: ${snapshot.commandCount}`,
		`Shortcuts: ${snapshot.shortcutCount}`,
		`Tools: ${snapshot.toolCount}`,
		`Handlers: ${snapshot.handlerCount}`,
	].join("\n");
}

function formatExtensionList(snapshot: ReturnType<typeof inspectExtensionHost>): string {
	return [
		formatExtensionSummary(snapshot),
		"",
		...snapshot.extensions.map((extension, index) => {
			const headline = `${index + 1}. ${extension.displayName}${extension.version ? `@${extension.version}` : ""}`;
			const description = extension.description ? `   ${extension.description}` : null;
			const origin = extension.residency === "unknown" ? null : `   origin:${formatExtensionResidency(extension)}`;
			const counts =
				`   commands:${extension.commandCount} shortcuts:${extension.shortcutCount} ` +
				`tools:${extension.toolCount} handlers:${extension.handlerCount}`;
			return [headline, description, origin, counts].filter(Boolean).join("\n");
		}),
		"",
		"Use /extensions show <index|name|path> for details.",
	].join("\n");
}

function formatCollection(values: string[]): string {
	return values.length > 0 ? values.join(", ") : "none";
}

function getRegisteredExtensionCommands(
	ctx: AppCommandContext,
	extension: ReturnType<typeof inspectExtensionHost>["extensions"][number],
): string[] {
	return ctx.commands
		.list()
		.filter((command) => command.source === "external" && command.packId === extension.commandPackId)
		.map((command) =>
			command.requestedName && command.requestedName !== command.name
				? `${command.name} (requested ${command.requestedName})`
				: command.name,
		)
		.sort((left, right) => left.localeCompare(right));
}

function haveSameEntries(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function formatExtensionDetail(
	ctx: AppCommandContext,
	extension: ReturnType<typeof inspectExtensionHost>["extensions"][number],
): string {
	const registeredCommands = getRegisteredExtensionCommands(ctx, extension);
	const shouldShowRegisteredCommands =
		registeredCommands.length > 0 && !haveSameEntries(registeredCommands, extension.commands);
	const lines = [
		`${extension.displayName}${extension.version ? `@${extension.version}` : ""}`,
		`Residency: ${formatExtensionResidency(extension)}`,
		`Path: ${extension.path}`,
	];
	if (extension.resolvedPath !== extension.path) {
		lines.push(`Resolved: ${extension.resolvedPath}`);
	}
	if (extension.packageName) {
		lines.push(`Package: ${extension.packageName}`);
	}
	if (extension.packageSource) {
		lines.push(`Package source: ${extension.packageSource}`);
	}
	if (extension.description) {
		lines.push(`Description: ${extension.description}`);
	}
	if (extension.author) {
		lines.push(`Author: ${extension.author}`);
	}
	if (extension.homepage) {
		lines.push(`Homepage: ${extension.homepage}`);
	}
	if (shouldShowRegisteredCommands) {
		lines.push(`Requested commands (${extension.commandCount}): ${formatCollection(extension.commands)}`);
		lines.push(`Registered slash commands (${registeredCommands.length}): ${formatCollection(registeredCommands)}`);
	} else {
		lines.push(
			`Commands (${registeredCommands.length > 0 ? registeredCommands.length : extension.commandCount}): ${formatCollection(
				registeredCommands.length > 0 ? registeredCommands : extension.commands,
			)}`,
		);
	}
	lines.push(
		`Shortcuts (${extension.shortcutCount}): ${formatCollection(extension.shortcuts)}`,
		`Tools (${extension.toolCount}): ${formatCollection(extension.tools)}`,
		`Handlers (${extension.handlerCount}): ${formatCollection(extension.events)}`,
	);
	return lines.join("\n");
}

function selectExtension(
	snapshot: ReturnType<typeof inspectExtensionHost>,
	selector: string,
): ReturnType<typeof inspectExtensionHost>["extensions"][number] | null {
	if (!selector) return null;
	const index = Number.parseInt(selector, 10);
	if (Number.isInteger(index) && index > 0) {
		return snapshot.extensions[index - 1] ?? null;
	}

	const normalized = selector.trim().toLowerCase();
	return (
		snapshot.extensions.find((extension) =>
			[extension.displayName, extension.manifestName, extension.label, extension.path, extension.resolvedPath]
				.filter((value): value is string => typeof value === "string" && value.length > 0)
				.some((value) => value.toLowerCase().includes(normalized)),
		) ?? null
	);
}

/**
 * I keep the extension-runtime inspection surface in its own builtin pack so it
 * can evolve independently from tool or convention inspection commands.
 */
export function createExtensionsSlashCommandPack(ctx: AppCommandContext): SlashCommandPack {
	return {
		id: "builtin.extensions",
		label: "Extensions",
		source: "builtin",
		commands: [
			{
				name: "/extensions",
				description: "Inspect loaded extensions",
				handler: (args) => {
					const extensionRunner = ctx.getExtensionRunner();
					if (!extensionRunner) {
						ctx.addInfoMessage("No extension runtime is active.");
						return;
					}

					const snapshot = inspectExtensionHost(extensionRunner);
					if (snapshot.extensionCount === 0) {
						ctx.addInfoMessage("Extension runtime is active, but no extensions are loaded.");
						return;
					}

					const trimmed = args.trim();
					if (!trimmed || trimmed === "list") {
						ctx.addInfoMessage(formatExtensionList(snapshot));
						return;
					}

					if (trimmed === "summary") {
						ctx.addInfoMessage(formatExtensionSummary(snapshot));
						return;
					}

					if (trimmed.startsWith("show ")) {
						const selected = selectExtension(snapshot, trimmed.slice(5).trim());
						if (!selected) {
							ctx.addInfoMessage(
								`Unknown extension: ${trimmed.slice(5).trim() || "(empty)"}\nUse /extensions to list loaded extensions.`,
							);
							return;
						}
						ctx.addInfoMessage(formatExtensionDetail(ctx, selected));
						return;
					}

					ctx.addInfoMessage(EXTENSIONS_USAGE);
				},
			},
		],
	};
}
