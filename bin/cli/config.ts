import {
	ensureTakumiConfigFile,
	formatTakumiConfigInspection,
	getTakumiConfigPath,
	inspectTakumiUserConfig,
	tryRevealTakumiConfigFile,
	type EnsuredTakumiConfigFile,
	type TakumiConfigFileTarget,
} from "@takumi/core";

const CONFIG_ACTIONS = new Set(["", "open", "active", "show", "path", "global", "project"]);

export async function cmdConfig(action = "open"): Promise<void> {
	const normalized = action.trim().toLowerCase();
	if (!CONFIG_ACTIONS.has(normalized)) {
		console.error("Usage: takumi config [show|path|global|project]");
		process.exit(1);
	}

	if (normalized === "path") {
		const inspection = inspectTakumiUserConfig();
		console.log(inspection.activePath ?? getTakumiConfigPath("global"));
		return;
	}

	if (normalized === "show") {
		console.log(formatTakumiConfigInspection(inspectTakumiUserConfig()));
		return;
	}

	const target = normalizeConfigTarget(normalized);
	const ensured = await ensureTakumiConfigFile(target);
	const inspection = inspectTakumiUserConfig();
	const reveal = tryRevealTakumiConfigFile(ensured.filePath);
	console.log(formatConfigCommandMessage(ensured, inspection, reveal));
}

function normalizeConfigTarget(action: string): TakumiConfigFileTarget {
	if (action === "global" || action === "project") {
		return action;
	}
	return "active";
}

function formatConfigCommandMessage(
	ensured: EnsuredTakumiConfigFile,
	inspection: ReturnType<typeof inspectTakumiUserConfig>,
	reveal: ReturnType<typeof tryRevealTakumiConfigFile>,
): string {
	const lines = [
		ensured.created ? `Created Takumi config: ${ensured.filePath}` : `Takumi config: ${ensured.filePath}`,
		"",
		formatTakumiConfigInspection(inspection),
		"",
	];

	if (reveal.opened) {
		lines.push("Opened it with your system default editor.");
	} else if (reveal.error) {
		lines.push(`Could not open it automatically: ${reveal.error}`);
	}

	lines.push("Project-local configs override global ones. Restart Takumi after edits to apply changes.");
	lines.push(
		"Credentials usually come from environment variables or CLI auth helpers; the config file is best for defaults like model, theme, and thinking.",
	);
	return lines.join("\n");
}