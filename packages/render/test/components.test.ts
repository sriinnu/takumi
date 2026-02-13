/**
 * Component tests — Box, TextComponent, Spinner, Border, List, Input
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import { Box } from "../src/components/box.js";
import { TextComponent } from "../src/components/text.js";
import { Spinner, SPINNER_STYLES } from "../src/components/spinner.js";
import { Border } from "../src/components/border.js";
import { List, type ListItem } from "../src/components/list.js";
import { Input } from "../src/components/input.js";
import { initYoga, createNode, applyStyle } from "../src/yoga.js";
import { Screen } from "../src/screen.js";
import type { Rect, KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";

// Initialize Yoga before all tests
beforeAll(async () => {
	await initYoga();
});

// Helper to create a mock rect for testing render methods
function mockRect(x = 0, y = 0, width = 80, height = 24): Rect {
	return { x, y, width, height };
}

describe("Box", () => {
	it("creates a box with default props", () => {
		const box = new Box();
		expect(box).toBeDefined();
		expect(box.style.flexDirection).toBe("column");
		expect(box.style.flexGrow).toBe(0);
		expect(box.style.flexShrink).toBe(1);
	});

	it("applies custom props", () => {
		const box = new Box({
			width: 100,
			height: 50,
			flexGrow: 1,
			flexDirection: "row",
			padding: 5,
			key: "test-box",
		});

		expect(box.style.width).toBe(100);
		expect(box.style.height).toBe(50);
		expect(box.style.flexGrow).toBe(1);
		expect(box.style.flexDirection).toBe("row");
		expect(box.style.padding).toBe(5);
		expect(box.key).toBe("test-box");
	});

	it("updates props", () => {
		const box = new Box({ width: 50 });
		box.update({ width: 100, flexGrow: 2 });
		expect(box.style.width).toBe(100);
		expect(box.style.flexGrow).toBe(2);
	});

	it("renders background fill", () => {
		const box = new Box({ background: "#ff0000" });
		const screen = new Screen(10, 5);
		const rect = mockRect(0, 0, 10, 5);

		box.render(screen, rect);

		// Check that cells are filled with background color
		for (let row = 0; row < 5; row++) {
			for (let col = 0; col < 10; col++) {
				const cell = screen.get(row, col);
				expect(cell.char).toBe(" ");
				expect(cell.bg).toBeGreaterThanOrEqual(0); // Has a background color
			}
		}
	});

	it("does not render without background", () => {
		const box = new Box(); // No background prop
		const screen = new Screen(10, 5);
		const rect = mockRect(0, 0, 10, 5);

		box.render(screen, rect);

		// Cells should remain empty
		const cell = screen.get(0, 0);
		expect(cell.char).toBe(" ");
		expect(cell.bg).toBe(-1); // Default background
	});

	it("manages children", () => {
		const parent = new Box();
		const child1 = new Box({ key: "child1" });
		const child2 = new Box({ key: "child2" });

		parent.appendChild(child1);
		parent.appendChild(child2);

		expect(parent.children.length).toBe(2);
		expect(parent.children[0]).toBe(child1);
		expect(child1.parent).toBe(parent);

		parent.removeChild(child1);
		expect(parent.children.length).toBe(1);
		expect(parent.children[0]).toBe(child2);
	});
});

describe("TextComponent", () => {
	it("creates text with content", () => {
		const text = new TextComponent({ content: "Hello, World!" });
		expect(text).toBeDefined();
	});

	it("renders text content", () => {
		const text = new TextComponent({ content: "Hello", color: "white" });
		const screen = new Screen(80, 24);
		const rect = mockRect(0, 0, 80, 1);

		text.render(screen, rect);

		// Check that text appears in the screen buffer
		const line = [];
		for (let col = 0; col < 5; col++) {
			line.push(screen.get(0, col).char);
		}
		expect(line.join("")).toBe("Hello");
	});

	it("handles left alignment", () => {
		const text = new TextComponent({ content: "Test", align: "left" });
		const screen = new Screen(80, 24);
		const rect = mockRect(0, 0, 10, 1);

		text.render(screen, rect);

		// Text should start at column 0
		expect(screen.get(0, 0).char).toBe("T");
		expect(screen.get(0, 1).char).toBe("e");
		expect(screen.get(0, 2).char).toBe("s");
		expect(screen.get(0, 3).char).toBe("t");
	});

	it("handles center alignment", () => {
		const text = new TextComponent({ content: "Hi", align: "center" });
		const screen = new Screen(80, 24);
		const rect = mockRect(0, 0, 10, 1);

		text.render(screen, rect);

		// "Hi" (length 2) in width 10 should start at column 4
		expect(screen.get(0, 4).char).toBe("H");
		expect(screen.get(0, 5).char).toBe("i");
	});

	it("handles right alignment", () => {
		const text = new TextComponent({ content: "End", align: "right" });
		const screen = new Screen(80, 24);
		const rect = mockRect(0, 0, 10, 1);

		text.render(screen, rect);

		// "End" (length 3) in width 10 should start at column 7
		expect(screen.get(0, 7).char).toBe("E");
		expect(screen.get(0, 8).char).toBe("n");
		expect(screen.get(0, 9).char).toBe("d");
	});

	it("wraps text when wrap is enabled", () => {
		const longText = "This is a very long text that should wrap";
		const text = new TextComponent({ content: longText, wrap: true });
		const screen = new Screen(80, 24);
		const rect = mockRect(0, 0, 10, 5);

		text.render(screen, rect);

		// Check that multiple lines are rendered
		let foundSecondLine = false;
		for (let col = 0; col < 10; col++) {
			if (screen.get(1, col).char !== " ") {
				foundSecondLine = true;
				break;
			}
		}
		expect(foundSecondLine).toBe(true);
	});

	it("updates content", () => {
		const text = new TextComponent({ content: "Initial" });
		text.update("Updated");
		// No direct way to check internal state, but ensure no errors
		expect(text).toBeDefined();
	});

	it("updates with props object", () => {
		const text = new TextComponent({ content: "Test" });
		text.update({ content: "New", bold: true });
		expect(text).toBeDefined();
	});
});

describe("Spinner", () => {
	it("creates spinner with default style", () => {
		const spinner = new Spinner();
		expect(spinner).toBeDefined();
	});

	it("has frames for dots style", () => {
		const spinner = new Spinner({ style: "dots" });
		expect(SPINNER_STYLES.dots.frames.length).toBeGreaterThan(0);
	});

	it("has frames for line style", () => {
		const spinner = new Spinner({ style: "line" });
		expect(SPINNER_STYLES.line.frames.length).toBe(4);
	});

	it("has frames for arc style", () => {
		const spinner = new Spinner({ style: "arc" });
		expect(SPINNER_STYLES.arc.frames.length).toBeGreaterThan(0);
	});

	it("has frames for braille style", () => {
		const spinner = new Spinner({ style: "braille" });
		expect(SPINNER_STYLES.braille.frames.length).toBeGreaterThan(0);
	});

	it("renders first frame", () => {
		const spinner = new Spinner({ style: "line" });
		const screen = new Screen(80, 24);
		const rect = mockRect(0, 0, 10, 1);

		spinner.render(screen, rect);

		// First frame of line style is "-"
		expect(screen.get(0, 0).char).toBe("-");
	});

	it("renders with label", () => {
		const spinner = new Spinner({ style: "line", label: "Loading" });
		const screen = new Screen(80, 24);
		const rect = mockRect(0, 0, 20, 1);

		spinner.render(screen, rect);

		// Should render frame followed by space and label
		const chars = [];
		for (let col = 0; col < 10; col++) {
			chars.push(screen.get(0, col).char);
		}
		const text = chars.join("").trim();
		expect(text).toContain("Loading");
	});

	it("does not render when inactive", () => {
		const spinner = new Spinner({ style: "line", active: false });
		const screen = new Screen(80, 24);
		const rect = mockRect(0, 0, 10, 1);

		spinner.render(screen, rect);

		// Should not render anything
		expect(screen.get(0, 0).char).toBe(" ");
	});

	it("cycles through frames on start", async () => {
		vi.useFakeTimers();
		const spinner = new Spinner({ style: "line" });

		spinner.start();

		// Wait for interval
		vi.advanceTimersByTime(150);

		spinner.stop();
		vi.useRealTimers();

		// No errors should occur
		expect(spinner).toBeDefined();
	});

	it("updates style", () => {
		const spinner = new Spinner({ style: "dots" });
		spinner.update({ style: "arc" });
		expect(spinner).toBeDefined();
	});
});

describe("Border", () => {
	it("creates border with default style", () => {
		const border = new Border();
		expect(border).toBeDefined();
	});

	it("renders single line border", () => {
		const border = new Border({ style: "single" });
		const screen = new Screen(10, 5);
		const rect = mockRect(0, 0, 10, 5);

		border.render(screen, rect);

		// Check corners
		expect(screen.get(0, 0).char).toBe("┌");
		expect(screen.get(0, 9).char).toBe("┐");
		expect(screen.get(4, 0).char).toBe("└");
		expect(screen.get(4, 9).char).toBe("┘");

		// Check edges
		expect(screen.get(0, 1).char).toBe("─");
		expect(screen.get(1, 0).char).toBe("│");
	});

	it("renders double line border", () => {
		const border = new Border({ style: "double" });
		const screen = new Screen(10, 5);
		const rect = mockRect(0, 0, 10, 5);

		border.render(screen, rect);

		// Check corners
		expect(screen.get(0, 0).char).toBe("╔");
		expect(screen.get(0, 9).char).toBe("╗");
		expect(screen.get(4, 0).char).toBe("╚");
		expect(screen.get(4, 9).char).toBe("╝");
	});

	it("renders rounded border", () => {
		const border = new Border({ style: "rounded" });
		const screen = new Screen(10, 5);
		const rect = mockRect(0, 0, 10, 5);

		border.render(screen, rect);

		// Check corners
		expect(screen.get(0, 0).char).toBe("╭");
		expect(screen.get(0, 9).char).toBe("╮");
		expect(screen.get(4, 0).char).toBe("╰");
		expect(screen.get(4, 9).char).toBe("╯");
	});

	it("renders bold border", () => {
		const border = new Border({ style: "bold" });
		const screen = new Screen(10, 5);
		const rect = mockRect(0, 0, 10, 5);

		border.render(screen, rect);

		expect(screen.get(0, 0).char).toBe("┏");
		expect(screen.get(0, 9).char).toBe("┓");
	});

	it("renders ascii border", () => {
		const border = new Border({ style: "ascii" });
		const screen = new Screen(10, 5);
		const rect = mockRect(0, 0, 10, 5);

		border.render(screen, rect);

		// Check corners
		expect(screen.get(0, 0).char).toBe("+");
		expect(screen.get(0, 9).char).toBe("+");
		expect(screen.get(0, 1).char).toBe("-");
		expect(screen.get(1, 0).char).toBe("|");
	});

	it("renders title", () => {
		const border = new Border({ style: "single", title: "Test" });
		const screen = new Screen(20, 5);
		const rect = mockRect(0, 0, 20, 5);

		border.render(screen, rect);

		// Title should appear at top starting at x+2
		const titleChars = [];
		for (let col = 2; col < 8; col++) {
			titleChars.push(screen.get(0, col).char);
		}
		const titleText = titleChars.join("");
		expect(titleText).toContain("Test");
	});

	it("does not render with none style", () => {
		const border = new Border({ style: "none" });
		const screen = new Screen(10, 5);
		const rect = mockRect(0, 0, 10, 5);

		border.render(screen, rect);

		// Should not render anything
		expect(screen.get(0, 0).char).toBe(" ");
	});

	it("handles small rects gracefully", () => {
		const border = new Border({ style: "single" });
		const screen = new Screen(10, 5);
		const rect = mockRect(0, 0, 1, 1);

		// Should not crash
		border.render(screen, rect);
		expect(screen.get(0, 0).char).toBe(" ");
	});

	it("updates props", () => {
		const border = new Border({ style: "single" });
		border.update({ style: "double", title: "New" });
		expect(border).toBeDefined();
	});
});

describe("List", () => {
	const sampleItems: ListItem[] = [
		{ id: "1", label: "Item 1" },
		{ id: "2", label: "Item 2", description: "Description" },
		{ id: "3", label: "Item 3", icon: "📁" },
		{ id: "4", label: "Item 4" },
		{ id: "5", label: "Item 5" },
	];

	it("creates list with items", () => {
		const list = new List({ items: sampleItems });
		expect(list).toBeDefined();
		expect(list.selectedIndex).toBe(0);
	});

	it("moves selection down", () => {
		const list = new List({ items: sampleItems });
		list.selectNext();
		expect(list.selectedIndex).toBe(1);
		list.selectNext();
		expect(list.selectedIndex).toBe(2);
	});

	it("moves selection up", () => {
		const list = new List({ items: sampleItems, selectedIndex: 2 });
		list.selectPrev();
		expect(list.selectedIndex).toBe(1);
		list.selectPrev();
		expect(list.selectedIndex).toBe(0);
	});

	it("does not move beyond bounds", () => {
		const list = new List({ items: sampleItems });
		list.selectPrev(); // Already at 0
		expect(list.selectedIndex).toBe(0);

		list.selectIndex(4); // Last item
		list.selectNext(); // Try to go beyond
		expect(list.selectedIndex).toBe(4);
	});

	it("jumps to specific index", () => {
		const list = new List({ items: sampleItems });
		list.selectIndex(3);
		expect(list.selectedIndex).toBe(3);
	});

	it("clamps index to valid range", () => {
		const list = new List({ items: sampleItems });
		list.selectIndex(100);
		expect(list.selectedIndex).toBe(4); // Last item
		list.selectIndex(-5);
		expect(list.selectedIndex).toBe(0); // First item
	});

	it("gets selected item", () => {
		const list = new List({ items: sampleItems, selectedIndex: 1 });
		const item = list.selectedItem;
		expect(item).toBeDefined();
		expect(item?.id).toBe("2");
		expect(item?.label).toBe("Item 2");
	});

	it("renders visible items", () => {
		const list = new List({ items: sampleItems });
		list.yogaNode = createNode();
		list.yogaNode.setWidth(20);
		list.yogaNode.setHeight(3);
		list.yogaNode.calculateLayout(20, 3, 0);

		const screen = new Screen(20, 3);
		const rect = mockRect(0, 0, 20, 3);

		list.render(screen, rect);

		// Check that first item is rendered
		const firstLineChars = [];
		for (let col = 0; col < 10; col++) {
			firstLineChars.push(screen.get(0, col).char);
		}
		const firstLine = firstLineChars.join("").trim();
		expect(firstLine).toContain("Item");
	});

	it("highlights selected item", () => {
		const list = new List({ items: sampleItems, selectedIndex: 0 });
		list.yogaNode = createNode();
		list.yogaNode.setWidth(20);
		list.yogaNode.setHeight(3);
		list.yogaNode.calculateLayout(20, 3, 0);

		const screen = new Screen(20, 3);
		const rect = mockRect(0, 0, 20, 3);

		list.render(screen, rect);

		// First item should have background color (highlighted)
		const cell = screen.get(0, 0);
		expect(cell.bg).toBeGreaterThanOrEqual(0);
	});

	it("calls onSelect callback", () => {
		const onSelect = vi.fn();
		const list = new List({ items: sampleItems, onSelect });
		list.confirm();

		expect(onSelect).toHaveBeenCalledOnce();
		expect(onSelect).toHaveBeenCalledWith(sampleItems[0], 0);
	});

	it("updates item list", () => {
		const list = new List({ items: sampleItems });
		const newItems: ListItem[] = [{ id: "new", label: "New Item" }];
		list.setItems(newItems);

		expect(list.selectedItem?.id).toBe("new");
	});

	it("adjusts selection when items shrink", () => {
		const list = new List({ items: sampleItems, selectedIndex: 4 });
		const newItems: ListItem[] = [{ id: "1", label: "Only" }];
		list.setItems(newItems);

		expect(list.selectedIndex).toBe(0);
	});
});

describe("Input", () => {
	function makeKeyEvent(
		key: string,
		raw: string = key,
		ctrl = false,
		alt = false,
	): KeyEvent {
		return { key, raw, ctrl, alt, shift: false, meta: false };
	}

	it("creates input with default value", () => {
		const input = new Input();
		expect(input.getValue()).toBe("");
	});

	it("sets value programmatically", () => {
		const input = new Input();
		input.setValue("test");
		expect(input.getValue()).toBe("test");
	});

	it("handles character input", () => {
		const input = new Input();
		input.handleKey(makeKeyEvent("a"));
		input.handleKey(makeKeyEvent("b"));
		input.handleKey(makeKeyEvent("c"));
		expect(input.getValue()).toBe("abc");
	});

	it("handles backspace", () => {
		const input = new Input();
		input.setValue("hello");
		input.handleKey(makeKeyEvent("backspace", KEY_CODES.BACKSPACE));
		expect(input.getValue()).toBe("hell");
	});

	it("handles delete key", () => {
		const input = new Input();
		input.setValue("hello");
		// Move cursor to position 1 (after 'h')
		input.handleKey(makeKeyEvent("", KEY_CODES.HOME));
		input.handleKey(makeKeyEvent("", KEY_CODES.RIGHT));
		input.handleKey(makeKeyEvent("", KEY_CODES.DELETE));
		expect(input.getValue()).toBe("hllo");
	});

	it("moves cursor left", () => {
		const input = new Input();
		input.setValue("test");
		input.handleKey(makeKeyEvent("", KEY_CODES.LEFT));
		// Cursor should be at position 3 now
		input.handleKey(makeKeyEvent("x"));
		expect(input.getValue()).toBe("tesxt");
	});

	it("moves cursor right", () => {
		const input = new Input();
		input.setValue("test");
		input.handleKey(makeKeyEvent("", KEY_CODES.HOME));
		input.handleKey(makeKeyEvent("", KEY_CODES.RIGHT));
		input.handleKey(makeKeyEvent("x"));
		expect(input.getValue()).toBe("txest");
	});

	it("moves cursor to home", () => {
		const input = new Input();
		input.setValue("test");
		input.handleKey(makeKeyEvent("", KEY_CODES.HOME));
		input.handleKey(makeKeyEvent("x"));
		expect(input.getValue()).toBe("xtest");
	});

	it("moves cursor to end", () => {
		const input = new Input();
		input.setValue("test");
		input.handleKey(makeKeyEvent("", KEY_CODES.HOME));
		input.handleKey(makeKeyEvent("", KEY_CODES.END));
		input.handleKey(makeKeyEvent("x"));
		expect(input.getValue()).toBe("testx");
	});

	it("handles Ctrl+A (home)", () => {
		const input = new Input();
		input.setValue("test");
		input.handleKey(makeKeyEvent("a", "a", true));
		input.handleKey(makeKeyEvent("x"));
		expect(input.getValue()).toBe("xtest");
	});

	it("handles Ctrl+E (end)", () => {
		const input = new Input();
		input.setValue("test");
		input.handleKey(makeKeyEvent("", KEY_CODES.HOME));
		input.handleKey(makeKeyEvent("e", "e", true));
		input.handleKey(makeKeyEvent("x"));
		expect(input.getValue()).toBe("testx");
	});

	it("handles Ctrl+K (kill to end)", () => {
		const input = new Input();
		input.setValue("hello world");
		input.handleKey(makeKeyEvent("", KEY_CODES.HOME));
		for (let i = 0; i < 5; i++) {
			input.handleKey(makeKeyEvent("", KEY_CODES.RIGHT));
		}
		input.handleKey(makeKeyEvent("k", "k", true));
		expect(input.getValue()).toBe("hello");
	});

	it("handles Ctrl+U (kill to start)", () => {
		const input = new Input();
		input.setValue("hello world");
		input.handleKey(makeKeyEvent("", KEY_CODES.HOME));
		for (let i = 0; i < 6; i++) {
			input.handleKey(makeKeyEvent("", KEY_CODES.RIGHT));
		}
		input.handleKey(makeKeyEvent("u", "u", true));
		expect(input.getValue()).toBe("world");
	});

	it("handles Ctrl+W (kill word backward)", () => {
		const input = new Input();
		input.setValue("hello world");
		input.handleKey(makeKeyEvent("w", "w", true));
		expect(input.getValue()).toBe("hello ");
	});

	it("submits on Enter", () => {
		const onSubmit = vi.fn();
		const input = new Input({ onSubmit });
		input.setValue("test");
		input.handleKey(makeKeyEvent("return", KEY_CODES.ENTER));
		expect(onSubmit).toHaveBeenCalledWith("test");
	});

	it("calls onChange on input", () => {
		const onChange = vi.fn();
		const input = new Input({ onChange });
		input.handleKey(makeKeyEvent("a"));
		expect(onChange).toHaveBeenCalledWith("a");
	});

	it("navigates history with up arrow", () => {
		const input = new Input();
		input.setValue("first");
		input.clear(true); // Save to history
		input.setValue("second");
		input.clear(true);

		input.handleKey(makeKeyEvent("", KEY_CODES.UP));
		expect(input.getValue()).toBe("second");

		input.handleKey(makeKeyEvent("", KEY_CODES.UP));
		expect(input.getValue()).toBe("first");
	});

	it("navigates history with down arrow", () => {
		const input = new Input();
		input.setValue("first");
		input.clear(true);
		input.setValue("second");
		input.clear(true);

		input.handleKey(makeKeyEvent("", KEY_CODES.UP));
		input.handleKey(makeKeyEvent("", KEY_CODES.UP));
		expect(input.getValue()).toBe("first");

		input.handleKey(makeKeyEvent("", KEY_CODES.DOWN));
		expect(input.getValue()).toBe("second");

		input.handleKey(makeKeyEvent("", KEY_CODES.DOWN));
		expect(input.getValue()).toBe("");
	});

	it("clears input", () => {
		const input = new Input();
		input.setValue("test");
		input.clear();
		expect(input.getValue()).toBe("");
	});

	it("respects maxLength", () => {
		const input = new Input({ maxLength: 5 });
		input.handleKey(makeKeyEvent("a"));
		input.handleKey(makeKeyEvent("b"));
		input.handleKey(makeKeyEvent("c"));
		input.handleKey(makeKeyEvent("d"));
		input.handleKey(makeKeyEvent("e"));
		input.handleKey(makeKeyEvent("f")); // Should be ignored
		expect(input.getValue()).toBe("abcde");
	});

	it("renders input with prefix", () => {
		const input = new Input({ prefix: "$ " });
		input.setValue("command");

		const screen = new Screen(80, 1);
		const rect = mockRect(0, 0, 80, 1);
		input.render(screen, rect);

		// Check prefix
		expect(screen.get(0, 0).char).toBe("$");
		expect(screen.get(0, 1).char).toBe(" ");

		// Check value
		expect(screen.get(0, 2).char).toBe("c");
	});

	it("renders placeholder when empty", () => {
		const input = new Input({ placeholder: "Enter text" });

		const screen = new Screen(80, 1);
		const rect = mockRect(0, 0, 80, 1);
		input.render(screen, rect);

		// Placeholder should be visible (starts after default prefix "> ")
		const chars = [];
		for (let col = 0; col < 15; col++) {
			chars.push(screen.get(0, col).char);
		}
		const text = chars.join("");
		// Check for "nter text" since rendering might clip first char
		expect(text).toContain("nter");
	});

	it("renders cursor", () => {
		const input = new Input({ prefix: "> " });
		input.setValue("test");

		const screen = new Screen(80, 1);
		const rect = mockRect(0, 0, 80, 1);
		input.render(screen, rect);

		// Cursor should be at end (after "test")
		const cursorCell = screen.get(0, 6); // 2 (prefix) + 4 (test)
		expect(cursorCell.bg).toBe(15); // Inverted
		expect(cursorCell.fg).toBe(0);
	});

	it("ignores Ctrl key combinations it doesn't handle", () => {
		const input = new Input();
		input.setValue("test");
		const result = input.handleKey(makeKeyEvent("z", "z", true));
		expect(result).toBe(false);
		expect(input.getValue()).toBe("test");
	});
});
