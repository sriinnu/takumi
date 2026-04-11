import type { AppCommandContext } from "./app-command-context.js";
import { registerConventionInspectionCommands } from "./app-commands-conventions.js";
import { registerExtensionInspectionCommands } from "./app-commands-extension-inspection.js";
import { registerPackageInspectionCommand } from "./app-commands-packages.js";
import { registerToolInspectionCommands } from "./app-commands-tools.js";

/**
 * I keep the historical extension command entry-point as a thin aggregator so
 * the app wiring stays stable while the actual commands move behind builtin packs.
 */
export function registerExtensionCommands(ctx: AppCommandContext): void {
	registerExtensionInspectionCommands(ctx);
	registerToolInspectionCommands(ctx);
	registerConventionInspectionCommands(ctx);
	registerPackageInspectionCommand(ctx);
}
