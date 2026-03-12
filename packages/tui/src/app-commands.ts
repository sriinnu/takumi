import type { AppCommandContext } from "./app-command-context.js";
import { registerAutocycleCommands } from "./app-commands-autocycle.js";
import { registerCodingCommands } from "./app-commands-coding.js";
import { registerCoreCommands } from "./app-commands-core.js";
import { registerProductivityCommands } from "./app-commands-productivity.js";
import { registerSteeringCommands } from "./app-commands-steer.js";
import { registerSessionTreeCommands } from "./app-commands-tree.js";
import { registerWorkflowCommands } from "./app-commands-workflow.js";

export function registerAppCommands(ctx: AppCommandContext): void {
	registerCoreCommands(ctx);
	registerCodingCommands(ctx);
	registerWorkflowCommands(ctx);
	registerProductivityCommands(ctx);
	registerSessionTreeCommands(ctx);
	registerAutocycleCommands(ctx);
	registerSteeringCommands(ctx);
}
