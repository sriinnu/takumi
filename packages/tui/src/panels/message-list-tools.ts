/**
 * Tool block rendering helpers for the message list panel.
 */

import type { Message, ToolResultBlock, ToolUseBlock } from "@takumi/core";
import { getTheme, hexToRgb, isDiffContent } from "@takumi/render";
import type { AppState } from "../state.js";
import { summarizeToolBlock } from "./message-list-tool-summary.js";
import type { LineSegment, RenderedLine } from "./message-list-types.js";
import { rgbTo256 } from "./message-list-types.js";

/** Maximum lines of tool result content shown in expanded view. */
const MAX_EXPANDED_RESULT_LINES = 30;

/** Build a map from tool_use ID to its matching ToolResultBlock. */
export function buildToolResultMap(allMessages: Message[]): Map<string, ToolResultBlock> {
	const map = new Map<string, ToolResultBlock>();
	for (const msg of allMessages) {
		for (const block of msg.content) {
			if (block.type === "tool_result") {
				map.set(block.toolUseId, block);
			}
		}
	}
	return map;
}

/** Build a set of tool_use IDs that have both use + result blocks. */
export function buildPairedResultIds(allMessages: Message[], resultMap: Map<string, ToolResultBlock>): Set<string> {
	const paired = new Set<string>();
	for (const msg of allMessages) {
		for (const block of msg.content) {
			if (block.type === "tool_use" && resultMap.has(block.id)) {
				paired.add(block.id);
			}
		}
	}
	return paired;
}

/**
 * Render a paired tool_use + tool_result as a collapsible block.
 */
export function renderToolBlock(
	state: AppState,
	toolUse: ToolUseBlock,
	toolResult: ToolResultBlock | null,
	width: number,
	renderedLines: RenderedLine[],
	toolBlockLineMap: Map<number, string>,
): void {
	const theme = getTheme();
	const [pr, pg, pb] = hexToRgb(theme.primary);
	const primaryFg = rgbTo256(pr, pg, pb);
	const [sr, sg, sb] = hexToRgb(theme.success);
	const successFg = rgbTo256(sr, sg, sb);
	const [er, eg, eb] = hexToRgb(theme.error);
	const errorFg = rgbTo256(er, eg, eb);
	const [wr, wg, wb] = hexToRgb(theme.warning);
	const warningFg = rgbTo256(wr, wg, wb);
	const [mr, mg, mb] = hexToRgb(theme.muted);
	const mutedFg = rgbTo256(mr, mg, mb);
	const summary = summarizeToolBlock(toolUse, toolResult);

	const isRunning = toolResult === null;
	const isError = toolResult?.isError ?? false;
	const isCollapsedView = isRunning ? false : !state.isToolCollapsed(toolUse.id);
	const headerLineIdx = renderedLines.length;

	if (isCollapsedView) {
		renderedLines.push(
			buildToolHeaderLine({
				arrow: "\u25B6",
				mutedFg,
				primaryFg,
				successFg,
				errorFg,
				warningFg,
				toolName: toolUse.name,
				subject: truncateArg(summary.subject, Math.max(16, Math.floor(width * 0.25))),
				icon: summary.icon,
				status: summary.status,
				statusChar: summary.statusChar,
				statusLabel: summary.statusLabel,
				trailingSummary: summary.collapsedSummary
					? truncateArg(summary.collapsedSummary, Math.max(18, Math.floor(width * 0.35)))
					: "",
			}),
		);
		toolBlockLineMap.set(headerLineIdx, toolUse.id);
		return;
	}

	renderedLines.push(
		buildToolHeaderLine({
			arrow: isRunning ? "\u27F3" : "\u25BC",
			mutedFg,
			primaryFg,
			successFg,
			errorFg,
			warningFg,
			toolName: toolUse.name,
			subject: truncateArg(summary.subject, Math.max(18, Math.floor(width * 0.3))),
			icon: summary.icon,
			status: summary.status,
			statusChar: summary.statusChar,
			statusLabel: summary.statusLabel,
			trailingSummary: "",
		}),
	);
	toolBlockLineMap.set(headerLineIdx, toolUse.id);

	for (const detail of summary.summaryLines) {
		pushSummaryLine(
			renderedLines,
			detail.label,
			detail.value,
			resolveSummaryTone(detail.tone, mutedFg, successFg, warningFg, errorFg),
		);
	}

	if (isRunning) return;

	for (const [key, value] of Object.entries(toolUse.input)) {
		const strVal = typeof value === "string" ? value : JSON.stringify(value);
		const truncated = strVal.length > 60 ? `${strVal.slice(0, 57)}...` : strVal;
		pushSummaryLine(renderedLines, key, truncated, mutedFg);
	}
	const sep = "\u2500".repeat(Math.min(40, width - 4));
	pushPrefixedLine(renderedLines, `\u2502 ${sep}`, -1, mutedFg);

	if (!toolResult) return;
	if (!toolResult.content) {
		pushSummaryLine(renderedLines, "result", "empty result", mutedFg);
		return;
	}

	if (!isError && isDiffContent(toolResult.content)) {
		const diffTheme = getTheme();
		const lines = toolResult.content.split("\n");
		const showLines = Math.min(lines.length, MAX_EXPANDED_RESULT_LINES);
		for (const dl of lines.slice(0, showLines)) {
			if (dl.startsWith("+") && !dl.startsWith("+++")) {
				const [dar, dag, dab] = hexToRgb(diffTheme.diffAdd);
				pushPrefixedLine(renderedLines, `\u2502 ${dl}`, rgbTo256(dar, dag, dab), mutedFg);
			} else if (dl.startsWith("-") && !dl.startsWith("---")) {
				const [drr, drg, drb] = hexToRgb(diffTheme.diffRemove);
				pushPrefixedLine(renderedLines, `\u2502 ${dl}`, rgbTo256(drr, drg, drb), mutedFg);
			} else if (dl.startsWith("@@")) {
				const [dhr, dhg, dhb] = hexToRgb(diffTheme.diffHunkHeader);
				pushPrefixedLine(renderedLines, `\u2502 ${dl}`, rgbTo256(dhr, dhg, dhb), mutedFg);
			} else {
				pushPrefixedLine(renderedLines, `\u2502 ${dl}`, -1, mutedFg);
			}
		}
		if (lines.length > MAX_EXPANDED_RESULT_LINES) {
			pushPrefixedLine(renderedLines, `\u2502 (showing ${showLines} of ${lines.length} lines)`, mutedFg, mutedFg);
		}
		return;
	}

	const contentLines = toolResult.content.split("\n");
	const showLines = Math.min(contentLines.length, MAX_EXPANDED_RESULT_LINES);
	const contentFg = isError ? errorFg : -1;
	for (let i = 0; i < showLines; i++) {
		pushPrefixedLine(renderedLines, `\u2502 ${contentLines[i]}`, contentFg, mutedFg);
	}
	if (contentLines.length > MAX_EXPANDED_RESULT_LINES) {
		pushPrefixedLine(renderedLines, `\u2502 (showing ${showLines} of ${contentLines.length} lines)`, mutedFg, mutedFg);
	}
}

interface ToolHeaderLineInput {
	arrow: string;
	mutedFg: number;
	primaryFg: number;
	successFg: number;
	errorFg: number;
	warningFg: number;
	toolName: string;
	subject: string;
	icon: string;
	status: "running" | "success" | "error";
	statusChar: string;
	statusLabel: string;
	trailingSummary: string;
}

function buildToolHeaderLine(input: ToolHeaderLineInput): RenderedLine {
	const statusFg =
		input.status === "error" ? input.errorFg : input.status === "success" ? input.successFg : input.warningFg;
	const statusBg = input.status === "error" ? 52 : input.status === "success" ? 22 : 58;
	const parts = [`${input.arrow} ${input.icon} ${input.toolName}`];
	const segments: LineSegment[] = [
		{
			text: `${input.arrow} `,
			fg: input.status === "running" ? input.warningFg : input.mutedFg,
			bg: -1,
			bold: false,
			dim: false,
			italic: false,
			underline: false,
		},
		{ text: `${input.icon} `, fg: input.mutedFg, bg: -1, bold: false, dim: false, italic: false, underline: false },
		{ text: input.toolName, fg: input.primaryFg, bg: -1, bold: true, dim: false, italic: false, underline: false },
	];

	if (input.subject) {
		parts.push(input.subject);
		segments.push({ text: "  ", fg: -1, bg: -1, bold: false, dim: false, italic: false, underline: false });
		segments.push({
			text: input.subject,
			fg: input.mutedFg,
			bg: -1,
			bold: false,
			dim: true,
			italic: false,
			underline: false,
		});
	}

	const statusText = `[${input.statusChar} ${input.statusLabel}]`;
	parts.push(statusText);
	segments.push({ text: "  ", fg: -1, bg: -1, bold: false, dim: false, italic: false, underline: false });
	segments.push({ text: statusText, fg: 15, bg: statusBg, bold: true, dim: false, italic: false, underline: false });

	if (input.trailingSummary) {
		parts.push(input.trailingSummary);
		segments.push({ text: "  ", fg: -1, bg: -1, bold: false, dim: false, italic: false, underline: false });
		segments.push({
			text: input.trailingSummary,
			fg: statusFg,
			bg: -1,
			bold: false,
			dim: false,
			italic: false,
			underline: false,
		});
	}

	return {
		text: parts.join("  "),
		fg: input.mutedFg,
		bold: false,
		dim: false,
		segments,
	};
}

function resolveSummaryTone(
	tone: "neutral" | "success" | "warning" | "error",
	mutedFg: number,
	successFg: number,
	warningFg: number,
	errorFg: number,
): number {
	if (tone === "success") return successFg;
	if (tone === "warning") return warningFg;
	if (tone === "error") return errorFg;
	return mutedFg;
}

function pushSummaryLine(renderedLines: RenderedLine[], label: string, value: string, valueFg: number): void {
	const text = `\u2502 ${label}: ${value}`;
	const segments: LineSegment[] = [
		{ text: "\u2502 ", fg: 8, bg: -1, bold: false, dim: true, italic: false, underline: false },
		{ text: `${label}: `, fg: 8, bg: -1, bold: true, dim: false, italic: false, underline: false },
		{ text: value, fg: valueFg, bg: -1, bold: false, dim: false, italic: false, underline: false },
	];
	renderedLines.push({ text, fg: valueFg, bold: false, dim: false, segments });
}

/** Push a line with a vertical bar prefix for expanded tool content. */
function pushPrefixedLine(renderedLines: RenderedLine[], text: string, contentFg: number, barFg: number): void {
	const barPart = text.slice(0, 2);
	const contentPart = text.slice(2);
	const segments: LineSegment[] = [
		{ text: barPart, fg: barFg, bg: -1, bold: false, dim: true, italic: false, underline: false },
		{ text: contentPart, fg: contentFg, bg: -1, bold: false, dim: false, italic: false, underline: false },
	];
	renderedLines.push({ text, fg: contentFg, bold: false, dim: false, segments });
}

/**
 * Extract a compact argument summary from a tool_use block's input.
 */
export function getToolArgSummary(toolUse: ToolUseBlock): string {
	const input = toolUse.input;
	const priorityKeys = ["file_path", "path", "command", "pattern", "query", "url", "glob", "old_string", "content"];
	for (const key of priorityKeys) {
		if (key in input && typeof input[key] === "string") {
			return input[key] as string;
		}
	}
	for (const value of Object.values(input)) {
		if (typeof value === "string") return value;
	}
	return "";
}

/** Truncate an argument string to fit within maxLen characters. */
export function truncateArg(arg: string, maxLen: number): string {
	const clean = arg.replace(/\n/g, " ");
	if (clean.length <= maxLen) return clean;
	if (maxLen <= 3) return clean.slice(0, maxLen);
	return `${clean.slice(0, maxLen - 3)}...`;
}
