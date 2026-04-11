import { buildContextReport } from "../context-report.js";
import type { AppCommandContext } from "./app-command-context.js";

export function registerContextCommands(ctx: AppCommandContext): void {
	ctx.commands.register("/context", "Inspect live context, cost, and runtime state", (args) => {
		if (args.trim()) {
			ctx.addInfoMessage("Usage: /context");
			return;
		}

		ctx.addInfoMessage(buildContextReport(ctx.state, ctx.config));
	});
}
