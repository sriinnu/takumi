import {
	type EnsuredTakumiProjectInstructionsFile,
	ensureTakumiProjectInstructionsFile,
	formatTakumiProjectInstructionsInspection,
	getTakumiProjectInstructionsPath,
	inspectTakumiProjectInstructions,
	tryRevealTakumiProjectInstructionsFile,
} from "@takumi/core";
import type { AppCommandContext } from "./app-command-context.js";

const INIT_ACTIONS = new Set(["", "open", "show", "path"]);

export function registerInitCommands(ctx: AppCommandContext): void {
	ctx.commands.register(
		"/init",
		"Create or inspect project TAKUMI.md instructions",
		async (args) => {
			const normalized = args.trim().toLowerCase();
			const cwd = ctx.config.workingDirectory || process.cwd();

			if (!INIT_ACTIONS.has(normalized)) {
				ctx.addInfoMessage("Usage: /init [open|show|path]");
				return;
			}

			if (normalized === "path") {
				ctx.addInfoMessage(getTakumiProjectInstructionsPath(cwd));
				return;
			}

			if (normalized === "show") {
				ctx.addInfoMessage(formatTakumiProjectInstructionsInspection(inspectTakumiProjectInstructions(cwd)));
				return;
			}

			const ensured = await ensureTakumiProjectInstructionsFile(cwd);
			const inspection = inspectTakumiProjectInstructions(cwd);
			const reveal = tryRevealTakumiProjectInstructionsFile(ensured.filePath);
			ctx.addInfoMessage(formatInitCommandMessage(ensured, inspection, reveal));
		},
		{ getArgumentCompletions: getInitCommandCompletions },
	);
}

function getInitCommandCompletions(partial: string): string[] {
	const options = ["open", "show", "path"];
	const trimmed = partial.trim().toLowerCase();
	if (!trimmed) return options;
	return options.filter((option) => option.startsWith(trimmed));
}

function formatInitCommandMessage(
	ensured: EnsuredTakumiProjectInstructionsFile,
	inspection: ReturnType<typeof inspectTakumiProjectInstructions>,
	reveal: ReturnType<typeof tryRevealTakumiProjectInstructionsFile>,
): string {
	const lines = [
		ensured.created ? `Created project instructions: ${ensured.filePath}` : `Project instructions: ${ensured.filePath}`,
		"",
		formatTakumiProjectInstructionsInspection(inspection),
		"",
	];

	if (reveal.opened) {
		lines.push("Opened it with your system default editor.");
	} else if (reveal.error) {
		lines.push(`Could not open it automatically: ${reveal.error}`);
	}

	lines.push("TAKUMI.md takes precedence over CLAUDE.md when both are present.");
	lines.push("Fill in repo-specific workflow, safety rails, and validation steps before relying on it.");
	return lines.join("\n");
}
