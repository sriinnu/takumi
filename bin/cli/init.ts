import {
	ensureTakumiProjectInstructionsFile,
	formatTakumiProjectInstructionsInspection,
	getTakumiProjectInstructionsPath,
	inspectTakumiProjectInstructions,
	tryRevealTakumiProjectInstructionsFile,
	type EnsuredTakumiProjectInstructionsFile,
} from "@takumi/core";

const INIT_ACTIONS = new Set(["", "open", "show", "path"]);

export async function cmdInit(action = "open"): Promise<void> {
	const normalized = action.trim().toLowerCase();
	if (!INIT_ACTIONS.has(normalized)) {
		console.error("Usage: takumi init [show|path]");
		process.exit(1);
	}

	if (normalized === "path") {
		console.log(getTakumiProjectInstructionsPath());
		return;
	}

	if (normalized === "show") {
		console.log(formatTakumiProjectInstructionsInspection(inspectTakumiProjectInstructions()));
		return;
	}

	const ensured = await ensureTakumiProjectInstructionsFile();
	const inspection = inspectTakumiProjectInstructions();
	const reveal = tryRevealTakumiProjectInstructionsFile(ensured.filePath);
	console.log(formatInitCommandMessage(ensured, inspection, reveal));
}

function formatInitCommandMessage(
	ensured: EnsuredTakumiProjectInstructionsFile,
	inspection: ReturnType<typeof inspectTakumiProjectInstructions>,
	reveal: ReturnType<typeof tryRevealTakumiProjectInstructionsFile>,
): string {
	const lines = [
		ensured.created
			? `Created project instructions: ${ensured.filePath}`
			: `Project instructions: ${ensured.filePath}`,
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