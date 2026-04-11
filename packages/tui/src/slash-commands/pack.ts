import type {
	RegisterSlashCommandOptions,
	SlashCommand,
	SlashCommandMetadata,
	SlashCommandRegistry,
} from "../commands/commands.js";

export interface SlashCommandContributionSpec {
	name: string;
	description: string;
	handler: (args: string) => void | Promise<void>;
	aliases?: string[];
	getArgumentCompletions?: (partial: string) => string[] | Promise<string[]>;
}

export interface SlashCommandContribution extends SlashCommandContributionSpec {
	source: "builtin" | "external";
	packId: string;
	packLabel: string;
	requestedName: string;
	residency?: SlashCommandMetadata["residency"];
}

export interface SlashCommandPack {
	id: string;
	label: string;
	source: "builtin" | "external";
	commands: SlashCommandContributionSpec[];
}

function toRegisterOptions(contribution: SlashCommandContribution): RegisterSlashCommandOptions {
	return {
		aliases: contribution.aliases,
		getArgumentCompletions: contribution.getArgumentCompletions,
		metadata: {
			source: contribution.source,
			packId: contribution.packId,
			packLabel: contribution.packLabel,
			requestedName: contribution.requestedName,
			residency: contribution.residency,
		},
	};
}

export function registerSlashCommandContribution(
	registry: SlashCommandRegistry,
	contribution: SlashCommandContribution,
): void {
	registry.register(contribution.name, contribution.description, contribution.handler, toRegisterOptions(contribution));
}

export function registerSlashCommandPack(registry: SlashCommandRegistry, pack: SlashCommandPack): void {
	for (const command of pack.commands) {
		registerSlashCommandContribution(registry, {
			...command,
			source: pack.source,
			packId: pack.id,
			packLabel: pack.label,
			requestedName: command.name,
		});
	}
}

export function formatSlashCommandOrigin(
	command: Pick<SlashCommand, "name" | "source" | "packId" | "packLabel" | "requestedName" | "residency">,
): string | null {
	if (!command.source) {
		return null;
	}

	const base =
		command.source === "builtin"
			? `builtin:${command.packLabel ?? command.packId ?? "command-pack"}`
			: command.residency
				? `external:${command.residency}:${command.packLabel ?? command.packId ?? "contrib-pack"}`
				: `external:${command.packLabel ?? command.packId ?? "contrib-pack"}`;
	if (command.requestedName && command.requestedName !== command.name) {
		return `${base} (requested ${command.requestedName})`;
	}
	return base;
}
