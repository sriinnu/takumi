import { ensureUserKeybindingConfigFile, tryRevealKeybindingConfigFile } from "@takumi/tui";

export async function cmdKeybindings(action = "open"): Promise<void> {
	const normalized = action.trim().toLowerCase();
	if (normalized && normalized !== "open" && normalized !== "path" && normalized !== "show") {
		console.error("Usage: takumi keybindings [path]");
		process.exit(1);
	}

	const ensured = await ensureUserKeybindingConfigFile();
	if (normalized === "path" || normalized === "show") {
		console.log(ensured.filePath);
		return;
	}

	const reveal = tryRevealKeybindingConfigFile(ensured.filePath);
	const lines = [
		ensured.created ? `Created keybindings config: ${ensured.filePath}` : `Keybindings config: ${ensured.filePath}`,
	];

	if (reveal.opened) {
		lines.push("Opened it with your system default editor.");
	} else if (reveal.error) {
		lines.push(`Could not open it automatically: ${reveal.error}`);
	}

	lines.push("Takumi loads this file on startup. In the TUI, run /keybindings reload after edits.");
	console.log(lines.join("\n"));
}