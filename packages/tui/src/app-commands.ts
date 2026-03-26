import type { AppCommandContext } from "./app-command-context.js";
import { registerAutocycleCommands } from "./app-commands-autocycle.js";
import { registerCodingCommands } from "./app-commands-coding.js";
import { registerCoreCommands } from "./app-commands-core.js";
import { registerHandoffCommands } from "./app-commands-handoff.js";
import { registerHubCommands } from "./app-commands-hub.js";
import { registerImageCommands } from "./app-commands-image.js";
import { registerProductivityCommands } from "./app-commands-productivity.js";
import { registerPTrackCommands } from "./app-commands-ptrack.js";
import { registerSharingCommands } from "./app-commands-sharing.js";
import { registerSideLaneCommands } from "./app-commands-side-lanes.js";
import { registerSteeringCommands } from "./app-commands-steer.js";
import { registerTemplateCommands } from "./app-commands-template.js";
import { registerSessionTreeCommands } from "./app-commands-tree.js";
import { registerWorkflowCommands } from "./app-commands-workflow.js";

export function registerAppCommands(ctx: AppCommandContext): void {
	registerCoreCommands(ctx);
	registerCodingCommands(ctx);
	registerWorkflowCommands(ctx);
	registerSideLaneCommands(ctx);
	registerProductivityCommands(ctx);
	registerHandoffCommands(ctx);
	registerSessionTreeCommands(ctx);
	registerAutocycleCommands(ctx);
	registerSteeringCommands(ctx);
	registerHubCommands(ctx);
	registerPTrackCommands(ctx);
	registerImageCommands(ctx);
	registerTemplateCommands(ctx);
	registerSharingCommands(ctx);
}
