import type { AppCommandContext } from "./app-command-context.js";
import { registerAutocycleCommands } from "./app-commands-autocycle.js";
import { registerCodingCommands } from "./app-commands-coding.js";
import { registerCoreCommands } from "./app-commands-core.js";
import { registerSteeringCommands } from "./app-commands-steer.js";
import { registerSessionTreeCommands } from "./app-commands-tree.js";

export function registerAppCommands(ctx: AppCommandContext): void {
	registerCoreCommands(ctx);
	registerCodingCommands(ctx);
	registerSessionTreeCommands(ctx);
	registerAutocycleCommands(ctx);
	registerSteeringCommands(ctx);
}
