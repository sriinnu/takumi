import { createToolsSlashCommandPack } from "../slash-commands/builtin/tools.js";
import { registerSlashCommandPack } from "../slash-commands/pack.js";
import type { AppCommandContext } from "./app-command-context.js";

export function registerToolInspectionCommands(ctx: AppCommandContext): void {
	registerSlashCommandPack(ctx.commands, createToolsSlashCommandPack(ctx));
}
