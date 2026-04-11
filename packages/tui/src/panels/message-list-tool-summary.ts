import type { ToolResultBlock, ToolUseBlock } from "@takumi/core";
import { type DiffFile, isDiffContent, parseDiff } from "@takumi/render";

const TOOL_ICONS: Record<string, string> = {
	read: "📖",
	write: "✏️",
	edit: "🛠️",
	bash: "💻",
	glob: "🔎",
	grep: "🔍",
	ask: "❓",
};

const MAX_DIFF_FILE_DETAILS = 3;
const MAX_PREVIEW_CHARS = 72;

export type ToolBlockStatus = "running" | "success" | "error";
export type ToolSummaryTone = "neutral" | "success" | "warning" | "error";

export interface ToolSummaryLine {
	label: string;
	value: string;
	tone: ToolSummaryTone;
}

export interface ToolBlockSummary {
	icon: string;
	subject: string;
	status: ToolBlockStatus;
	statusChar: string;
	statusLabel: string;
	collapsedSummary: string | null;
	summaryLines: ToolSummaryLine[];
}

/**
 * Build the operator-facing summary shown in compact and expanded tool blocks.
 */
export function summarizeToolBlock(toolUse: ToolUseBlock, toolResult: ToolResultBlock | null): ToolBlockSummary {
	const icon = TOOL_ICONS[toolUse.name] ?? "⚙️";
	const subject = getToolSubject(toolUse);

	if (!toolResult) {
		return {
			icon,
			subject,
			status: "running",
			statusChar: "…",
			statusLabel: "running",
			collapsedSummary: "waiting for result",
			summaryLines: [{ label: "status", value: "Running... waiting for tool result", tone: "warning" }],
		};
	}

	if (toolResult.content.length === 0) {
		return {
			icon,
			subject,
			status: toolResult.isError ? "error" : "success",
			statusChar: toolResult.isError ? "✗" : "✓",
			statusLabel: toolResult.isError ? "error" : "ok",
			collapsedSummary: "empty result",
			summaryLines: [{ label: "result", value: "(empty result)", tone: toolResult.isError ? "error" : "neutral" }],
		};
	}

	if (!toolResult.isError && isDiffContent(toolResult.content)) {
		const diffSummary = summarizeDiffResult(toolResult.content);
		if (diffSummary) {
			return {
				icon,
				subject,
				status: "success",
				statusChar: "✓",
				statusLabel: "ok",
				collapsedSummary: diffSummary.headline,
				summaryLines: diffSummary.summaryLines,
			};
		}
	}

	if (toolResult.isError) {
		return summarizeErrorResult(icon, subject, toolResult.content);
	}

	return summarizeTextResult(icon, subject, toolResult.content);
}

function summarizeTextResult(icon: string, subject: string, content: string): ToolBlockSummary {
	const stats = measureTextContent(content);
	const preview = getFirstMeaningfulLine(content);
	const summary = formatContentStats(stats.lineCount, stats.charCount);
	const summaryLines: ToolSummaryLine[] = [{ label: "result", value: summary, tone: "neutral" }];
	if (preview) {
		summaryLines.push({ label: "preview", value: preview, tone: "neutral" });
	}

	return {
		icon,
		subject,
		status: "success",
		statusChar: "✓",
		statusLabel: "ok",
		collapsedSummary: preview ?? summary,
		summaryLines,
	};
}

function summarizeErrorResult(icon: string, subject: string, content: string): ToolBlockSummary {
	const stats = measureTextContent(content);
	const preview = getFirstMeaningfulLine(content) ?? formatContentStats(stats.lineCount, stats.charCount);
	const summaryLines: ToolSummaryLine[] = [{ label: "error", value: preview, tone: "error" }];
	if (stats.lineCount > 1) {
		summaryLines.push({
			label: "result",
			value: formatContentStats(stats.lineCount, stats.charCount),
			tone: "neutral",
		});
	}

	return {
		icon,
		subject,
		status: "error",
		statusChar: "✗",
		statusLabel: "error",
		collapsedSummary: preview,
		summaryLines,
	};
}

function summarizeDiffResult(content: string): { headline: string; summaryLines: ToolSummaryLine[] } | null {
	const files = parseDiff(content);
	if (files.length === 0) {
		return null;
	}

	const fileSummaries = files.map(summarizeDiffFile);
	const additions = fileSummaries.reduce((total, file) => total + file.additions, 0);
	const deletions = fileSummaries.reduce((total, file) => total + file.deletions, 0);
	const headline = `${files.length} file${files.length === 1 ? "" : "s"} • +${additions} -${deletions}`;
	const summaryLines: ToolSummaryLine[] = [{ label: "diff", value: headline, tone: "success" }];

	for (const file of fileSummaries.slice(0, MAX_DIFF_FILE_DETAILS)) {
		summaryLines.push({
			label: "file",
			value: `${file.path} (+${file.additions} -${file.deletions})`,
			tone: "neutral",
		});
	}

	if (fileSummaries.length > MAX_DIFF_FILE_DETAILS) {
		summaryLines.push({
			label: "files",
			value: `+${fileSummaries.length - MAX_DIFF_FILE_DETAILS} more changed file${
				fileSummaries.length - MAX_DIFF_FILE_DETAILS === 1 ? "" : "s"
			}`,
			tone: "neutral",
		});
	}

	return { headline, summaryLines };
}

function summarizeDiffFile(file: DiffFile): { path: string; additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;
	for (const hunk of file.hunks) {
		for (const line of hunk.lines) {
			if (line.type === "add") additions++;
			if (line.type === "remove") deletions++;
		}
	}

	return {
		path: truncateValue(file.newPath !== "/dev/null" ? file.newPath : file.oldPath),
		additions,
		deletions,
	};
}

function getToolSubject(toolUse: ToolUseBlock): string {
	const priorityKeys = ["file_path", "path", "command", "pattern", "query", "url", "glob"];
	for (const key of priorityKeys) {
		const value = toolUse.input[key];
		if (typeof value === "string" && value.trim()) {
			return truncateValue(value.trim());
		}
	}

	for (const value of Object.values(toolUse.input)) {
		if (typeof value === "string" && value.trim()) {
			return truncateValue(value.trim());
		}
	}

	return "";
}

function getFirstMeaningfulLine(content: string): string | null {
	for (const rawLine of content.split("\n")) {
		const line = rawLine.trim();
		if (line.length > 0) {
			return truncateValue(line);
		}
	}
	return null;
}

function measureTextContent(content: string): { lineCount: number; charCount: number } {
	return {
		lineCount: content.length === 0 ? 0 : content.split("\n").length,
		charCount: content.length,
	};
}

function formatContentStats(lineCount: number, charCount: number): string {
	return `${lineCount} line${lineCount === 1 ? "" : "s"} • ${charCount} char${charCount === 1 ? "" : "s"}`;
}

function truncateValue(value: string, maxChars = MAX_PREVIEW_CHARS): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars - 1)}…`;
}
