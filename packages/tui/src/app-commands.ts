import type { AppCommandContext } from "./app-command-context.js";
import { registerCodingCommands } from "./app-commands-coding.js";
import { registerCoreCommands } from "./app-commands-core.js";

export function registerAppCommands(ctx: AppCommandContext): void {
	registerCoreCommands(ctx);
	registerCodingCommands(ctx);
}
