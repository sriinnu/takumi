import type { TakumiConfig } from "@takumi/core";
import type { AppState } from "./state.js";

type FilesReportConfig = Pick<TakumiConfig, "workingDirectory">;

export function buildFilesReport(state: AppState, config: FilesReportConfig): string {
	const lines = ["File activity", ""];
	const workingDirectory = config.workingDirectory || process.cwd();
	const filesChanged = state.fileChanges.value;
	const filesRead = state.readFiles.value;

	lines.push("Session");
	lines.push(`  Working dir  ${workingDirectory}`);
	lines.push("  Tracking     live runtime only");
	lines.push(`  Changed      ${filesChanged.length}`);
	lines.push(`  Read         ${filesRead.length}`);

	lines.push("");
	lines.push("Changed files");
	if (filesChanged.length === 0) {
		lines.push("  Files        none tracked yet");
	} else {
		for (const [index, file] of filesChanged.entries()) {
			lines.push(`  ${index + 1}. ${file.status.padEnd(8)} ${file.path}`);
		}
	}

	lines.push("");
	lines.push("Read files");
	if (filesRead.length === 0) {
		lines.push("  Files        none tracked yet");
	} else {
		for (const [index, file] of filesRead.entries()) {
			lines.push(`  ${index + 1}. ${file}`);
		}
	}

	lines.push("");
	lines.push("Advice");
	if (filesChanged.length === 0 && filesRead.length === 0) {
		lines.push("  Takumi tracks successful read/write/edit file tool calls in this runtime.");
	} else {
		lines.push("  Tracking resets on session switch or restore until session transcripts persist tool events.");
	}

	return lines.join("\n");
}
