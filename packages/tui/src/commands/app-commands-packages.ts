import { createPackagesSlashCommandPack } from "../slash-commands/builtin/packages.js";
import { registerSlashCommandPack } from "../slash-commands/pack.js";
import type { AppCommandContext } from "./app-command-context.js";

/**
 * Register the Takumi package inspection surface.
 */
export function registerPackageInspectionCommand(ctx: AppCommandContext): void {
	registerSlashCommandPack(ctx.commands, createPackagesSlashCommandPack(ctx));
}
