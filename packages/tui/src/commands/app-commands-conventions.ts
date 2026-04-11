import { createConventionInspectionSlashCommandPack } from "../slash-commands/builtin/conventions.js";
import { registerSlashCommandPack } from "../slash-commands/pack.js";
import type { AppCommandContext } from "./app-command-context.js";

export function registerConventionInspectionCommands(ctx: AppCommandContext): void {
	registerSlashCommandPack(ctx.commands, createConventionInspectionSlashCommandPack(ctx));
}
