import { createTemplateSlashCommandPack } from "../slash-commands/builtin/template.js";
import { registerSlashCommandPack } from "../slash-commands/pack.js";
import type { AppCommandContext } from "./app-command-context.js";

export function registerTemplateCommands(ctx: AppCommandContext): void {
	registerSlashCommandPack(ctx.commands, createTemplateSlashCommandPack(ctx));
}
