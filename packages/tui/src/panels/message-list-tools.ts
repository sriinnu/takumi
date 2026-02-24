/**
 * Tool block rendering helpers for the message list panel.
 */

import type { Message, ToolResultBlock, ToolUseBlock } from "@takumi/core";
import { getTheme, hexToRgb, isDiffContent } from "@takumi/render";
import type { AppState } from "../state.js";
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

	const isRunning = toolResult === null;
	const isError = toolResult?.isError ?? false;
	const collapsed = isRunning ? false : !state.isToolCollapsed(toolUse.id);
	const argSummary = getToolArgSummary(toolUse);
	const headerLineIdx = renderedLines.length;

	if (collapsed) {
		const arrow = "\u25B6";
		const statusChar = isError ? "\u2717" : "\u2713";
		const statusFg = isError ? errorFg : successFg;
		const toolNamePart = toolUse.name;
		const argPart = argSummary ? truncateArg(argSummary, Math.max(10, width - toolNamePart.length - 10)) : "";

		const segments: LineSegment[] = [
			{ text: `${arrow} `, fg: mutedFg, bg: -1, bold: false, dim: false, italic: false, underline: false },
			{ text: toolNamePart, fg: primaryFg, bg: -1, bold: true, dim: false, italic: false, underline: false },
			{ text: "  ", fg: -1, bg: -1, bold: false, dim: false, italic: false, underline: false },
			{ text: argPart, fg: mutedFg, bg: -1, bold: false, dim: true, italic: false, underline: false },
		];

		const usedWidth = 2 + toolNamePart.length + 2 + argPart.length;
		const padLen = Math.max(1, width - usedWidth - 2);
		segments.push({
			text: " ".repeat(padLen),
			fg: -1,
			bg: -1,
			bold: false,
			dim: false,
			italic: false,
			underline: false,
		});
		segments.push({ text: statusChar, fg: statusFg, bg: -1, bold: false, dim: false, italic: false, underline: false });

		renderedLines.push({
			text: `${arrow} ${toolNamePart}  ${argPart}${" ".repeat(padLen)}${statusChar}`,
			fg: mutedFg,
			bold: false,
			dim: false,
			segments,
		});
		toolBlockLineMap.set(headerLineIdx, toolUse.id);
		return;
	}

	const arrow = isRunning ? "\u27F3" : "\u25BC";
	const arrowFg = isRunning ? warningFg : mutedFg;
	const toolNamePart = toolUse.name;
	const argPart = argSummary ? truncateArg(argSummary, Math.max(10, width - toolNamePart.length - 10)) : "";

	const headerSegments: LineSegment[] = [
		{ text: `${arrow} `, fg: arrowFg, bg: -1, bold: false, dim: false, italic: false, underline: false },
		{ text: toolNamePart, fg: primaryFg, bg: -1, bold: true, dim: false, italic: false, underline: false },
		{ text: "  ", fg: -1, bg: -1, bold: false, dim: false, italic: false, underline: false },
		{ text: argPart, fg: mutedFg, bg: -1, bold: false, dim: true, italic: false, underline: false },
	];

	if (!isRunning) {
		const statusChar = isError ? "\u2717" : "\u2713";
		const statusFg = isError ? errorFg : successFg;
		const usedWidth = 2 + toolNamePart.length + 2 + argPart.length;
		const padLen = Math.max(1, width - usedWidth - 2);
		headerSegments.push({
			text: " ".repeat(padLen),
			fg: -1,
			bg: -1,
			bold: false,
			dim: false,
			italic: false,
			underline: false,
		});
		headerSegments.push({
			text: statusChar,
			fg: statusFg,
			bg: -1,
			bold: false,
			dim: false,
			italic: false,
			underline: false,
		});
	}

	renderedLines.push({
		text: `${arrow} ${toolNamePart}  ${argPart}`,
		fg: mutedFg,
		bold: false,
		dim: false,
		segments: headerSegments,
	});
	toolBlockLineMap.set(headerLineIdx, toolUse.id);

	if (isRunning) {
		pushPrefixedLine(renderedLines, "\u2502 Running...", warningFg, mutedFg);
		return;
	}

	for (const [key, value] of Object.entries(toolUse.input)) {
		const strVal = typeof value === "string" ? value : JSON.stringify(value);
		const truncated = strVal.length > 60 ? `${strVal.slice(0, 57)}...` : strVal;
		pushPrefixedLine(renderedLines, `\u2502 ${key}: ${truncated}`, -1, mutedFg);
	}
	const sep = "\u2500".repeat(Math.min(40, width - 4));
	pushPrefixedLine(renderedLines, `\u2502 ${sep}`, -1, mutedFg);

	if (!toolResult) return;
	if (!toolResult.content) {
		pushPrefixedLine(renderedLines, "\u2502 (empty result)", mutedFg, mutedFg);
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
