import { createExtensionsSlashCommandPack } from "../slash-commands/builtin/extensions.js";
import { registerSlashCommandPack } from "../slash-commands/pack.js";
import type { AppCommandContext } from "./app-command-context.js";

export function registerExtensionInspectionCommands(ctx: AppCommandContext): void {
	registerSlashCommandPack(ctx.commands, createExtensionsSlashCommandPack(ctx));
}
