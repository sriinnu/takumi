/**
 * SlashCommandRegistry — manages /commands that can be typed
 * in the input field.
 */

export interface SlashCommandMetadata {
	source?: "builtin" | "external";
	packId?: string;
	packLabel?: string;
	requestedName?: string;
	residency?: "project" | "global" | "package" | "unknown";
}

export interface SlashCommand {
	name: string;
	description: string;
	handler: (args: string) => void | Promise<void>;
	aliases: string[];
	getArgumentCompletions?: (partial: string) => string[] | Promise<string[]>;
	source?: SlashCommandMetadata["source"];
	packId?: string;
	packLabel?: string;
	requestedName?: string;
	residency?: SlashCommandMetadata["residency"];
}

export interface RegisterSlashCommandOptions {
	aliases?: string[];
	getArgumentCompletions?: (partial: string) => string[] | Promise<string[]>;
	metadata?: SlashCommandMetadata;
}

export class SlashCommandRegistry {
	private commands = new Map<string, SlashCommand>();

	/** Register a slash command. */
	register(
		name: string,
		description: string,
		handler: (args: string) => void | Promise<void>,
		aliasesOrOptions: string[] | RegisterSlashCommandOptions = [],
	): void {
		const options = Array.isArray(aliasesOrOptions) ? { aliases: aliasesOrOptions } : aliasesOrOptions;
		const cmd: SlashCommand = {
			name,
			description,
			handler,
			aliases: options.aliases ?? [],
			getArgumentCompletions: options.getArgumentCompletions,
			source: options.metadata?.source,
			packId: options.metadata?.packId,
			packLabel: options.metadata?.packLabel,
			requestedName: options.metadata?.requestedName,
			residency: options.metadata?.residency,
		};
		this.commands.set(name, cmd);
		for (const alias of cmd.aliases) {
			this.commands.set(alias, cmd);
		}
	}

	/** Unregister a command by name. */
	unregister(name: string): boolean {
		const cmd = this.commands.get(name);
		if (!cmd) return false;
		this.commands.delete(name);
		for (const alias of cmd.aliases) {
			this.commands.delete(alias);
		}
		return true;
	}

	/**
	 * Try to execute a slash command from input text.
	 * Returns true if a command was found and executed.
	 */
	async execute(input: string): Promise<boolean> {
		if (!input.startsWith("/")) return false;

		const spaceIndex = input.indexOf(" ");
		const commandName = spaceIndex === -1 ? input : input.slice(0, spaceIndex);
		const args = spaceIndex === -1 ? "" : input.slice(spaceIndex + 1).trim();

		const cmd = this.commands.get(commandName);
		if (!cmd) return false;

		await cmd.handler(args);
		return true;
	}

	/** Get completions for partial command input. */
	getCompletions(partial: string): SlashCommand[] {
		if (!partial.startsWith("/")) return [];

		const results: SlashCommand[] = [];
		const seen = new Set<string>();

		for (const cmd of this.commands.values()) {
			if (seen.has(cmd.name)) continue;
			if (cmd.name.startsWith(partial)) {
				results.push(cmd);
				seen.add(cmd.name);
			}
		}

		return results.sort((a, b) => a.name.localeCompare(b.name));
	}

	/** List all unique commands (not aliases). */
	list(): SlashCommand[] {
		const seen = new Set<string>();
		const result: SlashCommand[] = [];

		for (const cmd of this.commands.values()) {
			if (!seen.has(cmd.name)) {
				result.push(cmd);
				seen.add(cmd.name);
			}
		}

		return result.sort((a, b) => a.name.localeCompare(b.name));
	}

	/** Check if a command exists. */
	has(name: string): boolean {
		return this.commands.has(name);
	}

	/** Get a command by canonical name or alias. */
	get(name: string): SlashCommand | undefined {
		return this.commands.get(name);
	}
}
