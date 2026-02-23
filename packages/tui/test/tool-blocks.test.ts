/**
 * Tests for collapsible tool call blocks in the MessageListPanel.
 * Verifies:
 *   - Collapsed rendering shows compact single-line format
 *   - Expanded rendering shows full tool content
 *   - Toggle collapse/expand via state
 *   - Tool_use + tool_result pairing across messages
 *   - Running state (no result yet) rendering
 *   - Error state rendering
 *   - Long output truncation at 30 lines
 *   - Click/mouse interaction toggling
 *   - Enter key toggling
 *   - Multiple tool calls in one message
 *   - Unknown tool names
 *   - Empty tool results
 *   - Argument summary extraction
 *   - Argument truncation
 *   - Duration display (N/A: durations are not in content blocks)
 */

import type { Message, MouseEvent as TMouseEvent, ToolResultBlock, ToolUseBlock } from "@takumi/core";
import { Screen } from "@takumi/render";
import { describe, expect, it } from "vitest";
import { getToolArgSummary, MessageListPanel, truncateArg } from "../src/panels/message-list.js";
import { AppState } from "../src/state.js";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function makeMessage(overrides?: Partial<Message>): Message {
	return {
		id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
		role: "assistant",
		content: [],
		timestamp: Date.now(),
		...overrides,
	};
}

function makeToolUse(overrides?: Partial<ToolUseBlock>): ToolUseBlock {
	return {
		type: "tool_use",
		id: "tu-1",
		name: "read",
		input: { path: "src/index.ts" },
		...overrides,
	};
}

function makeToolResult(overrides?: Partial<ToolResultBlock>): ToolResultBlock {
	return {
		type: "tool_result",
		toolUseId: "tu-1",
		content: "file contents here",
		isError: false,
		...overrides,
	};
}

function makeMouseClick(x: number, y: number): TMouseEvent {
	return {
		type: "mousedown",
		x,
		y,
		button: 0,
		shift: false,
		alt: false,
		ctrl: false,
		wheelDelta: 0,
	};
}

/** Extract plain text content from rendered lines (concatenated). */
function getAllLineTexts(panel: MessageListPanel): string[] {
	const count = panel.getRenderedLineCount();
	const texts: string[] = [];
	for (let i = 0; i < count; i++) {
		const line = panel.getRenderedLine(i);
		if (line) texts.push(line.text);
	}
	return texts;
}

/** Create a panel with common test setup. */
function createTestPanel(): { state: AppState; panel: MessageListPanel } {
	const state = new AppState();
	const panel = new MessageListPanel({ state });
	return { state, panel };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Collapsed rendering                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("collapsed tool block rendering", () => {
	it("shows a single compact line for a completed tool with result", () => {
		const { state, panel } = createTestPanel();
		const toolUse = makeToolUse({ id: "tu-1", name: "read", input: { path: "src/index.ts" } });
		const toolResult = makeToolResult({ toolUseId: "tu-1", content: "file content", isError: false });

		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [toolUse],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [toolResult],
			}),
		);

		panel.buildLines(80);

		// Find the tool block line (look for the collapsed arrow)
		const texts = getAllLineTexts(panel);
		const toolLine = texts.find((t) => t.includes("\u25B6") && t.includes("read"));
		expect(toolLine).toBeDefined();
		// Should show the success indicator
		expect(toolLine).toContain("\u2713"); // ✓
	});

	it("shows the tool name in the collapsed line", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "bash", input: { command: "pnpm test" } })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1" })],
			}),
		);

		panel.buildLines(80);
		const texts = getAllLineTexts(panel);
		const toolLine = texts.find((t) => t.includes("bash"));
		expect(toolLine).toBeDefined();
	});

	it("shows the argument summary in the collapsed line", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "read", input: { path: "src/app.ts" } })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1" })],
			}),
		);

		panel.buildLines(80);
		const texts = getAllLineTexts(panel);
		const toolLine = texts.find((t) => t.includes("read") && t.includes("src/app.ts"));
		expect(toolLine).toBeDefined();
	});

	it("shows error indicator for failed tool results", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "bash", input: { command: "exit 1" } })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1", isError: true, content: "command failed" })],
			}),
		);

		panel.buildLines(80);
		const texts = getAllLineTexts(panel);
		const toolLine = texts.find((t) => t.includes("bash"));
		expect(toolLine).toBeDefined();
		expect(toolLine).toContain("\u2717"); // ✗
	});

	it("uses collapsed arrow indicator (right-pointing triangle)", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "read", input: {} })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1" })],
			}),
		);

		panel.buildLines(80);
		const texts = getAllLineTexts(panel);
		const toolLine = texts.find((t) => t.includes("read"));
		expect(toolLine).toContain("\u25B6"); // ▶
	});

	it("renders only one line for a collapsed tool block (no content lines)", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "read", input: { path: "/tmp/test" } })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1", content: "line1\nline2\nline3" })],
			}),
		);

		panel.buildLines(80);
		const texts = getAllLineTexts(panel);
		// Should NOT find vertical bar content lines when collapsed
		const barLines = texts.filter((t) => t.startsWith("\u2502"));
		expect(barLines).toHaveLength(0);
	});
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Expanded rendering                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("expanded tool block rendering", () => {
	it("shows full content when tool is toggled to expanded", () => {
		const { state, panel } = createTestPanel();
		const toolUse = makeToolUse({ id: "tu-1", name: "read", input: { path: "src/index.ts" } });
		const toolResult = makeToolResult({ toolUseId: "tu-1", content: "import { signal } from '@preact/signals-core';" });

		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [toolUse],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [toolResult],
			}),
		);

		// Toggle to expanded (default is collapsed for completed)
		state.toggleToolCollapse("tu-1");

		panel.buildLines(80);
		const texts = getAllLineTexts(panel);

		// Should have the expanded arrow
		const headerLine = texts.find((t) => t.includes("\u25BC") && t.includes("read"));
		expect(headerLine).toBeDefined();

		// Should show the result content
		const contentLine = texts.find((t) => t.includes("import"));
		expect(contentLine).toBeDefined();
	});

	it("shows tool arguments in expanded view", () => {
		const { state, panel } = createTestPanel();
		const toolUse = makeToolUse({ id: "tu-1", name: "read", input: { path: "src/main.ts", startLine: "10" } });
		const toolResult = makeToolResult({ toolUseId: "tu-1", content: "content here" });

		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [toolUse],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [toolResult],
			}),
		);

		state.toggleToolCollapse("tu-1");
		panel.buildLines(80);
		const texts = getAllLineTexts(panel);

		// Should show the path argument
		const pathLine = texts.find((t) => t.includes("path:") && t.includes("src/main.ts"));
		expect(pathLine).toBeDefined();
	});

	it("shows down-arrow indicator when expanded", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1" })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1" })],
			}),
		);

		state.toggleToolCollapse("tu-1");
		panel.buildLines(80);
		const texts = getAllLineTexts(panel);
		const headerLine = texts.find((t) => t.includes("read"));
		expect(headerLine).toContain("\u25BC"); // ▼
	});

	it("shows vertical bar prefix on content lines", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "read", input: { path: "test.ts" } })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1", content: "line 1\nline 2" })],
			}),
		);

		state.toggleToolCollapse("tu-1");
		panel.buildLines(80);
		const texts = getAllLineTexts(panel);

		// Content lines should have vertical bar prefix
		const barLines = texts.filter((t) => t.startsWith("\u2502"));
		expect(barLines.length).toBeGreaterThan(0);
	});
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Toggle collapse/expand                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("toggle collapse/expand", () => {
	it("toggles from collapsed to expanded", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1" })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1" })],
			}),
		);

		// Default: collapsed
		panel.buildLines(80);
		let texts = getAllLineTexts(panel);
		expect(texts.some((t) => t.includes("\u25B6"))).toBe(true);

		// Toggle to expanded
		state.toggleToolCollapse("tu-1");
		panel.buildLines(80);
		texts = getAllLineTexts(panel);
		expect(texts.some((t) => t.includes("\u25BC"))).toBe(true);
	});

	it("toggles from expanded back to collapsed", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1" })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1" })],
			}),
		);

		// Expand
		state.toggleToolCollapse("tu-1");
		// Collapse again
		state.toggleToolCollapse("tu-1");

		panel.buildLines(80);
		const texts = getAllLineTexts(panel);
		expect(texts.some((t) => t.includes("\u25B6"))).toBe(true);
		expect(texts.some((t) => t.includes("\u25BC"))).toBe(false);
	});

	it("toggling produces different line counts", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "read", input: { path: "test.ts" } })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1", content: "line1\nline2\nline3" })],
			}),
		);

		// Collapsed
		panel.buildLines(80);
		const collapsedCount = panel.getRenderedLineCount();

		// Expanded
		state.toggleToolCollapse("tu-1");
		panel.buildLines(80);
		const expandedCount = panel.getRenderedLineCount();

		expect(expandedCount).toBeGreaterThan(collapsedCount);
	});
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Tool_use + tool_result pairing                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("tool_use + tool_result pairing", () => {
	it("pairs tool_use with tool_result from different messages", () => {
		const { state, panel } = createTestPanel();
		// Assistant message with tool_use
		state.addMessage(
			makeMessage({
				id: "msg-1",
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "bash", input: { command: "ls" } })],
			}),
		);
		// User message with tool_result
		state.addMessage(
			makeMessage({
				id: "msg-2",
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1", content: "file1.ts\nfile2.ts" })],
			}),
		);

		panel.buildLines(80);
		const texts = getAllLineTexts(panel);

		// The tool_use should render as a collapsible block with the result info
		const toolLine = texts.find((t) => t.includes("bash") && t.includes("\u25B6"));
		expect(toolLine).toBeDefined();
		// It should have the success indicator because it paired with a result
		expect(toolLine).toContain("\u2713");
	});

	it("does not duplicate tool_result when it is paired", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "read", input: { path: "a.ts" } })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1", content: "contents" })],
			}),
		);

		panel.buildLines(80);
		const texts = getAllLineTexts(panel);

		// Should NOT see "[result]" or "[error]" (the old-style orphan result rendering)
		const orphanResult = texts.find((t) => t.includes("[result]") || t.includes("[error]"));
		expect(orphanResult).toBeUndefined();
	});

	it("renders orphan tool_result if no matching tool_use exists", () => {
		const { state, panel } = createTestPanel();
		// Only a tool_result with no matching tool_use
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-nonexistent", content: "orphan result" })],
			}),
		);

		panel.buildLines(80);
		const texts = getAllLineTexts(panel);

		// Should render as the old-style [result] format
		const resultLine = texts.find((t) => t.includes("[result]") || t.includes("orphan result"));
		expect(resultLine).toBeDefined();
	});

	it("handles multiple tool pairs in one conversation", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [
					makeToolUse({ id: "tu-1", name: "read", input: { path: "a.ts" } }),
					makeToolUse({ id: "tu-2", name: "bash", input: { command: "echo hi" } }),
				],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [
					makeToolResult({ toolUseId: "tu-1", content: "a contents" }),
					makeToolResult({ toolUseId: "tu-2", content: "hi" }),
				],
			}),
		);

		panel.buildLines(80);
		const texts = getAllLineTexts(panel);

		// Both tools should be rendered
		expect(texts.some((t) => t.includes("read"))).toBe(true);
		expect(texts.some((t) => t.includes("bash"))).toBe(true);
	});
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Running state                                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("running state (no result yet)", () => {
	it("shows running indicator when no tool_result exists", () => {
		const { state, panel } = createTestPanel();
		// Only tool_use, no matching result
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "bash", input: { command: "sleep 5" } })],
			}),
		);

		panel.buildLines(80);
		const texts = getAllLineTexts(panel);

		// Should show the running spinner symbol
		const headerLine = texts.find((t) => t.includes("bash") && t.includes("\u27F3"));
		expect(headerLine).toBeDefined();
	});

	it("always shows running tool expanded", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "bash", input: { command: "pnpm test" } })],
			}),
		);

		panel.buildLines(80);
		const texts = getAllLineTexts(panel);

		// Should show "Running..." content line
		const runningLine = texts.find((t) => t.includes("Running..."));
		expect(runningLine).toBeDefined();
	});

	it("does not show success/error indicator for running tools", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "read", input: {} })],
			}),
		);

		panel.buildLines(80);
		const texts = getAllLineTexts(panel);

		// Should not contain check or cross
		for (const text of texts) {
			if (text.includes("read") && text.includes("\u27F3")) {
				expect(text).not.toContain("\u2713");
				expect(text).not.toContain("\u2717");
			}
		}
	});
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Error state rendering                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("error state rendering", () => {
	it("shows error indicator in collapsed view", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "bash", input: { command: "bad-cmd" } })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1", isError: true, content: "command not found" })],
			}),
		);

		panel.buildLines(80);
		const texts = getAllLineTexts(panel);
		const toolLine = texts.find((t) => t.includes("bash"));
		expect(toolLine).toContain("\u2717"); // ✗
	});

	it("shows error content when expanded", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "bash", input: { command: "bad" } })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1", isError: true, content: "Permission denied" })],
			}),
		);

		state.toggleToolCollapse("tu-1");
		panel.buildLines(80);
		const texts = getAllLineTexts(panel);

		const errorContentLine = texts.find((t) => t.includes("Permission denied"));
		expect(errorContentLine).toBeDefined();
	});
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Long output truncation                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("long output truncation", () => {
	it("truncates expanded content at 30 lines", () => {
		const { state, panel } = createTestPanel();
		const longContent = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");

		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "read", input: { path: "big.ts" } })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1", content: longContent })],
			}),
		);

		state.toggleToolCollapse("tu-1");
		panel.buildLines(80);
		const texts = getAllLineTexts(panel);

		// Should show first 30 lines
		expect(texts.some((t) => t.includes("line 1"))).toBe(true);
		expect(texts.some((t) => t.includes("line 30"))).toBe(true);
		// Should NOT show line 31
		expect(texts.some((t) => t.includes("line 31"))).toBe(false);
	});

	it("shows truncation message for long content", () => {
		const { state, panel } = createTestPanel();
		const longContent = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");

		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "read", input: { path: "big.ts" } })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1", content: longContent })],
			}),
		);

		state.toggleToolCollapse("tu-1");
		panel.buildLines(80);
		const texts = getAllLineTexts(panel);

		// Should show "showing X of Y lines" message
		const truncMsg = texts.find((t) => t.includes("showing 30 of 50 lines"));
		expect(truncMsg).toBeDefined();
	});

	it("does not show truncation message for short content", () => {
		const { state, panel } = createTestPanel();
		const shortContent = "line 1\nline 2\nline 3";

		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "read", input: { path: "small.ts" } })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1", content: shortContent })],
			}),
		);

		state.toggleToolCollapse("tu-1");
		panel.buildLines(80);
		const texts = getAllLineTexts(panel);

		const truncMsg = texts.find((t) => t.includes("showing"));
		expect(truncMsg).toBeUndefined();
	});
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Click/mouse interaction                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("click/mouse interaction", () => {
	it("toggles collapse when clicking on a tool block header line", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "read", input: { path: "a.ts" } })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1", content: "content" })],
			}),
		);

		// Build lines first, then render to set lastRect
		const rect = { x: 0, y: 0, width: 82, height: 20 };
		const screen = new Screen(82, 20);
		panel.render(screen, rect);

		// Find the tool block line index
		const toolLineIdx = findToolLineIdx(panel, "tu-1");
		expect(toolLineIdx).not.toBe(-1);

		// Before click: collapsed (default)
		expect(state.isToolCollapsed("tu-1")).toBe(false);

		// Click on the tool line
		const event = makeMouseClick(5, toolLineIdx);
		const handled = panel.handleClick(event);
		expect(handled).toBe(true);

		// After click: toggled (now in set = expanded for completed)
		expect(state.isToolCollapsed("tu-1")).toBe(true);
	});

	it("returns false for clicks outside tool block lines", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [{ type: "text", text: "Hello world" }],
			}),
		);

		const rect = { x: 0, y: 0, width: 82, height: 20 };
		const screen = new Screen(82, 20);
		panel.render(screen, rect);

		const event = makeMouseClick(5, 0);
		const handled = panel.handleClick(event);
		expect(handled).toBe(false);
	});

	it("returns false for right-click on tool block", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1" })],
			}),
		);

		const rect = { x: 0, y: 0, width: 82, height: 20 };
		const screen = new Screen(82, 20);
		panel.render(screen, rect);

		const toolLineIdx = findToolLineIdx(panel, "tu-1");
		const event: TMouseEvent = {
			type: "mousedown",
			x: 5,
			y: toolLineIdx,
			button: 2, // right click
			shift: false,
			alt: false,
			ctrl: false,
			wheelDelta: 0,
		};
		const handled = panel.handleClick(event);
		expect(handled).toBe(false);
	});
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Enter key interaction                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("Enter key interaction", () => {
	it("toggles collapse when Enter is pressed on a tool block line", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "read", input: { path: "test.ts" } })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1" })],
			}),
		);

		panel.buildLines(80);
		const toolLineIdx = findToolLineIdx(panel, "tu-1");

		const handled = panel.handleEnter(toolLineIdx);
		expect(handled).toBe(true);
		expect(state.isToolCollapsed("tu-1")).toBe(true);
	});

	it("returns false for Enter on non-tool lines", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [{ type: "text", text: "Hello" }],
			}),
		);

		panel.buildLines(80);
		const handled = panel.handleEnter(0);
		expect(handled).toBe(false);
	});
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Multiple tool calls in one message                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("multiple tool calls in one message", () => {
	it("renders multiple tool blocks independently", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [
					makeToolUse({ id: "tu-1", name: "read", input: { path: "a.ts" } }),
					makeToolUse({ id: "tu-2", name: "write", input: { path: "b.ts" } }),
					makeToolUse({ id: "tu-3", name: "bash", input: { command: "ls" } }),
				],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [
					makeToolResult({ toolUseId: "tu-1", content: "a" }),
					makeToolResult({ toolUseId: "tu-2", content: "b" }),
					makeToolResult({ toolUseId: "tu-3", content: "c" }),
				],
			}),
		);

		panel.buildLines(80);
		const texts = getAllLineTexts(panel);

		// All three should be present
		expect(texts.filter((t) => t.includes("\u25B6")).length).toBe(3);
	});

	it("can expand one tool while others remain collapsed", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [
					makeToolUse({ id: "tu-1", name: "read", input: { path: "a.ts" } }),
					makeToolUse({ id: "tu-2", name: "bash", input: { command: "ls" } }),
				],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [
					makeToolResult({ toolUseId: "tu-1", content: "read content" }),
					makeToolResult({ toolUseId: "tu-2", content: "bash output" }),
				],
			}),
		);

		// Expand only the first tool
		state.toggleToolCollapse("tu-1");
		panel.buildLines(80);
		const texts = getAllLineTexts(panel);

		// tu-1 should be expanded (down arrow)
		expect(texts.some((t) => t.includes("\u25BC") && t.includes("read"))).toBe(true);
		// tu-2 should be collapsed (right arrow)
		expect(texts.some((t) => t.includes("\u25B6") && t.includes("bash"))).toBe(true);
	});
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Unknown tool names                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("unknown tool names", () => {
	it("renders unknown tool names without crashing", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "my_custom_fancy_tool", input: {} })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1", content: "done" })],
			}),
		);

		panel.buildLines(80);
		const texts = getAllLineTexts(panel);
		const toolLine = texts.find((t) => t.includes("my_custom_fancy_tool"));
		expect(toolLine).toBeDefined();
	});
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Empty tool results                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("empty tool results", () => {
	it("handles empty result content gracefully in collapsed view", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "write", input: { path: "out.txt" } })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1", content: "" })],
			}),
		);

		panel.buildLines(80);
		const texts = getAllLineTexts(panel);
		// Should still render the tool line
		const toolLine = texts.find((t) => t.includes("write"));
		expect(toolLine).toBeDefined();
	});

	it("shows (empty result) in expanded view for empty content", () => {
		const { state, panel } = createTestPanel();
		state.addMessage(
			makeMessage({
				role: "assistant",
				content: [makeToolUse({ id: "tu-1", name: "write", input: { path: "out.txt" } })],
			}),
		);
		state.addMessage(
			makeMessage({
				role: "user",
				content: [makeToolResult({ toolUseId: "tu-1", content: "" })],
			}),
		);

		state.toggleToolCollapse("tu-1");
		panel.buildLines(80);
		const texts = getAllLineTexts(panel);

		const emptyLine = texts.find((t) => t.includes("(empty result)"));
		expect(emptyLine).toBeDefined();
	});
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  getToolArgSummary helper                                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("getToolArgSummary", () => {
	it("extracts path from input", () => {
		const result = getToolArgSummary(makeToolUse({ input: { path: "/tmp/test.ts" } }));
		expect(result).toBe("/tmp/test.ts");
	});

	it("extracts file_path from input", () => {
		const result = getToolArgSummary(makeToolUse({ input: { file_path: "/tmp/file.ts" } }));
		expect(result).toBe("/tmp/file.ts");
	});

	it("extracts command from input", () => {
		const result = getToolArgSummary(makeToolUse({ input: { command: "pnpm test" } }));
		expect(result).toBe("pnpm test");
	});

	it("prioritizes file_path over path", () => {
		const result = getToolArgSummary(
			makeToolUse({
				input: { file_path: "priority.ts", path: "fallback.ts" },
			}),
		);
		expect(result).toBe("priority.ts");
	});

	it("falls back to first string value", () => {
		const result = getToolArgSummary(
			makeToolUse({
				input: { some_custom_arg: "custom_value", num: 42 },
			}),
		);
		expect(result).toBe("custom_value");
	});

	it("returns empty string for empty input", () => {
		const result = getToolArgSummary(makeToolUse({ input: {} }));
		expect(result).toBe("");
	});

	it("returns empty string for all non-string inputs", () => {
		const result = getToolArgSummary(
			makeToolUse({
				input: { a: 1, b: true, c: null },
			}),
		);
		expect(result).toBe("");
	});
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  truncateArg helper                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("truncateArg", () => {
	it("returns short strings unmodified", () => {
		expect(truncateArg("hello", 20)).toBe("hello");
	});

	it("truncates long strings with ellipsis", () => {
		const long = "a".repeat(50);
		const result = truncateArg(long, 20);
		expect(result).toHaveLength(20);
		expect(result).toMatch(/\.\.\.$/);
	});

	it("replaces newlines with spaces", () => {
		expect(truncateArg("line1\nline2\nline3", 50)).toBe("line1 line2 line3");
	});

	it("handles maxLen <= 3", () => {
		const result = truncateArg("hello world", 3);
		expect(result).toHaveLength(3);
		expect(result).toBe("hel");
	});

	it("returns original if exactly maxLen", () => {
		const s = "exact";
		expect(truncateArg(s, 5)).toBe("exact");
	});
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  State: collapsedTools                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("AppState collapsedTools", () => {
	it("starts with empty set", () => {
		const state = new AppState();
		expect(state.collapsedTools.value.size).toBe(0);
	});

	it("toggleToolCollapse adds ID to set", () => {
		const state = new AppState();
		state.toggleToolCollapse("tu-1");
		expect(state.isToolCollapsed("tu-1")).toBe(true);
	});

	it("toggleToolCollapse removes ID from set on second call", () => {
		const state = new AppState();
		state.toggleToolCollapse("tu-1");
		state.toggleToolCollapse("tu-1");
		expect(state.isToolCollapsed("tu-1")).toBe(false);
	});

	it("isToolCollapsed returns false for unknown IDs", () => {
		const state = new AppState();
		expect(state.isToolCollapsed("tu-unknown")).toBe(false);
	});

	it("reset clears collapsedTools", () => {
		const state = new AppState();
		state.toggleToolCollapse("tu-1");
		state.toggleToolCollapse("tu-2");
		state.reset();
		expect(state.collapsedTools.value.size).toBe(0);
	});

	it("handles multiple IDs independently", () => {
		const state = new AppState();
		state.toggleToolCollapse("tu-1");
		state.toggleToolCollapse("tu-2");
		expect(state.isToolCollapsed("tu-1")).toBe(true);
		expect(state.isToolCollapsed("tu-2")).toBe(true);

		state.toggleToolCollapse("tu-1");
		expect(state.isToolCollapsed("tu-1")).toBe(false);
		expect(state.isToolCollapsed("tu-2")).toBe(true);
	});
});

/* ── Internal helper ───────────────────────────────────────────────────────── */

/** Find the rendered line index that maps to a tool ID. */
function findToolLineIdx(panel: MessageListPanel, toolId: string): number {
	for (let i = 0; i < panel.getRenderedLineCount(); i++) {
		if (panel.getToolIdAtLine(i) === toolId) return i;
	}
	return -1;
}
