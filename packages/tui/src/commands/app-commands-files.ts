import { buildFilesReport } from "../files-report.js";
import type { AppCommandContext } from "./app-command-context.js";

export function registerFilesCommands(ctx: AppCommandContext): void {
	ctx.commands.register("/files", "Show tracked files read and changed in this runtime", async (args) => {
		if (args.trim().length > 0) {
			ctx.addInfoMessage("Usage: /files");
			return;
		}

		ctx.addInfoMessage(buildFilesReport(ctx.state, ctx.config));
	});
}
