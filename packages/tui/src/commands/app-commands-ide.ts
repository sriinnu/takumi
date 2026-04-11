import { createIdeSlashCommandPack } from "../slash-commands/builtin/ide.js";
import { registerSlashCommandPack } from "../slash-commands/pack.js";
import type { AppCommandContext } from "./app-command-context.js";

export function registerIdeCommands(ctx: AppCommandContext): void {
	registerSlashCommandPack(ctx.commands, createIdeSlashCommandPack(ctx));
}
