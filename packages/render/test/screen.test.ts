import type { Cell } from "@takumi/core";
import { beforeEach, describe, expect, it } from "vitest";
import { Screen } from "../src/screen.js";

describe("Screen", () => {
	let screen: Screen;

	beforeEach(() => {
		screen = new Screen(10, 5);
	});

	describe("creation", () => {
		it("should create screen with specified dimensions", () => {
			const s = new Screen(20, 10);
			expect(s.width).toBe(20);
			expect(s.height).toBe(10);
			expect(s.size).toEqual({ width: 20, height: 10 });
		});

		it("should initialize all cells as empty", () => {
			const cell = screen.get(0, 0);
			expect(cell.char).toBe(" ");
			expect(cell.fg).toBe(-1);
			expect(cell.bg).toBe(-1);
			expect(cell.bold).toBe(false);
			expect(cell.dim).toBe(false);
			expect(cell.italic).toBe(false);
			expect(cell.underline).toBe(false);
			expect(cell.strikethrough).toBe(false);
		});
	});

	describe("set() and get()", () => {
		it("should write and read cell at position", () => {
			const cell: Cell = {
				char: "A",
				fg: 1,
				bg: 2,
				bold: true,
				dim: false,
				italic: true,
				underline: false,
				strikethrough: false,
			};

			screen.set(2, 3, cell);
			const retrieved = screen.get(2, 3);

			expect(retrieved).toEqual(cell);
		});

		it("should handle cells at boundaries", () => {
			const cell: Cell = {
				char: "X",
				fg: -1,
				bg: -1,
				bold: false,
				dim: false,
				italic: false,
				underline: false,
				strikethrough: false,
			};

			// Top-left corner
			screen.set(0, 0, cell);
			expect(screen.get(0, 0).char).toBe("X");

			// Bottom-right corner
			screen.set(4, 9, cell);
			expect(screen.get(4, 9).char).toBe("X");
		});

		it("should silently ignore out-of-bounds writes (negative)", () => {
			const cell: Cell = {
				char: "Z",
				fg: -1,
				bg: -1,
				bold: false,
				dim: false,
				italic: false,
				underline: false,
				strikethrough: false,
			};

			screen.set(-1, 0, cell);
			screen.set(0, -1, cell);
			screen.set(-5, -5, cell);

			// Should not throw, and cells should remain empty
			expect(screen.get(0, 0).char).toBe(" ");
		});

		it("should silently ignore out-of-bounds writes (beyond dimensions)", () => {
			const cell: Cell = {
				char: "Z",
				fg: -1,
				bg: -1,
				bold: false,
				dim: false,
				italic: false,
				underline: false,
				strikethrough: false,
			};

			screen.set(5, 0, cell); // height is 5, so row 5 is out of bounds
			screen.set(0, 10, cell); // width is 10, so col 10 is out of bounds
			screen.set(100, 100, cell);

			// Should not throw
		});

		it("should return empty cell for out-of-bounds reads", () => {
			const cell = screen.get(-1, 0);
			expect(cell.char).toBe(" ");
			expect(cell.fg).toBe(-1);

			const cell2 = screen.get(0, 100);
			expect(cell2.char).toBe(" ");

			const cell3 = screen.get(100, 100);
			expect(cell3.char).toBe(" ");
		});
	});

	describe("writeText()", () => {
		it("should write plain text without style", () => {
			screen.writeText(1, 2, "Hello");

			expect(screen.get(1, 2).char).toBe("H");
			expect(screen.get(1, 3).char).toBe("e");
			expect(screen.get(1, 4).char).toBe("l");
			expect(screen.get(1, 5).char).toBe("l");
			expect(screen.get(1, 6).char).toBe("o");
		});

		it("should write text with foreground color", () => {
			screen.writeText(0, 0, "Red", { fg: 9 });

			expect(screen.get(0, 0).char).toBe("R");
			expect(screen.get(0, 0).fg).toBe(9);
			expect(screen.get(0, 1).fg).toBe(9);
			expect(screen.get(0, 2).fg).toBe(9);
		});

		it("should write text with background color", () => {
			screen.writeText(2, 0, "BG", { bg: 4 });

			expect(screen.get(2, 0).bg).toBe(4);
			expect(screen.get(2, 1).bg).toBe(4);
		});

		it("should write text with multiple style attributes", () => {
			screen.writeText(1, 1, "Styled", {
				fg: 3,
				bg: 7,
				bold: true,
				italic: true,
				underline: true,
			});

			const cell = screen.get(1, 1);
			expect(cell.char).toBe("S");
			expect(cell.fg).toBe(3);
			expect(cell.bg).toBe(7);
			expect(cell.bold).toBe(true);
			expect(cell.italic).toBe(true);
			expect(cell.underline).toBe(true);
			expect(cell.dim).toBe(false);
			expect(cell.strikethrough).toBe(false);
		});

		it("should clip text at right edge", () => {
			screen.writeText(0, 7, "TooLongText");

			expect(screen.get(0, 7).char).toBe("T");
			expect(screen.get(0, 8).char).toBe("o");
			expect(screen.get(0, 9).char).toBe("o");
			// Only 3 chars should fit (cols 7, 8, 9)
		});

		it("should handle empty string", () => {
			screen.writeText(0, 0, "");
			expect(screen.get(0, 0).char).toBe(" ");
		});

		it("should write styled text starting at out-of-bounds position", () => {
			// Should not throw
			screen.writeText(-1, 0, "Hello");
			screen.writeText(0, -5, "World");
		});
	});

	describe("clear()", () => {
		it("should reset all back buffer cells to empty", () => {
			screen.writeText(0, 0, "Hello", { fg: 5 });
			screen.writeText(2, 3, "World", { bold: true });

			screen.clear();

			// Check that cells are now empty
			expect(screen.get(0, 0).char).toBe(" ");
			expect(screen.get(0, 0).fg).toBe(-1);
			expect(screen.get(2, 3).char).toBe(" ");
			expect(screen.get(2, 3).bold).toBe(false);
		});

		it("should clear entire buffer", () => {
			// Fill screen
			for (let row = 0; row < 5; row++) {
				for (let col = 0; col < 10; col++) {
					screen.set(row, col, {
						char: "X",
						fg: 1,
						bg: 2,
						bold: true,
						dim: false,
						italic: false,
						underline: false,
						strikethrough: false,
					});
				}
			}

			screen.clear();

			// Verify all empty
			for (let row = 0; row < 5; row++) {
				for (let col = 0; col < 10; col++) {
					const cell = screen.get(row, col);
					expect(cell.char).toBe(" ");
					expect(cell.fg).toBe(-1);
					expect(cell.bg).toBe(-1);
				}
			}
		});
	});

	describe("diff()", () => {
		it("should detect changed cells between frames", () => {
			screen.writeText(0, 0, "Hi");
			const patch1 = screen.diff();

			expect(patch1.changedCells).toBe(2);
			expect(patch1.output).toContain("H");
			expect(patch1.output).toContain("i");
		});

		it("should return empty output when nothing changed", () => {
			screen.writeText(0, 0, "Test");
			screen.diff(); // First diff to swap buffers

			// No changes
			const patch2 = screen.diff();
			expect(patch2.changedCells).toBe(0);
			expect(patch2.output).toBe("");
		});

		it("should detect partial changes", () => {
			screen.writeText(0, 0, "Hello");
			screen.diff(); // Commit first frame

			// Change only middle character
			screen.writeText(0, 0, "HeLlo");
			const patch = screen.diff();

			expect(patch.changedCells).toBe(1); // Only 'L' changed
		});

		it("should properly swap buffers after diff", () => {
			screen.writeText(0, 0, "A");
			screen.diff();

			// After diff, front buffer should match back buffer
			screen.writeText(0, 0, "A"); // Write same content
			const patch = screen.diff();
			expect(patch.changedCells).toBe(0); // No change detected
		});

		it("should detect style changes even with same character", () => {
			screen.writeText(0, 0, "A", { fg: 1 });
			screen.diff();

			screen.writeText(0, 0, "A", { fg: 2 }); // Same char, different color
			const patch = screen.diff();

			expect(patch.changedCells).toBe(1);
		});

		it("should generate ANSI cursor positioning codes", () => {
			screen.writeText(2, 5, "X");
			const patch = screen.diff();

			// Should contain cursor positioning
			expect(patch.output).toContain("\x1b["); // ANSI escape
		});

		it("should generate ANSI style codes for styled text", () => {
			screen.writeText(0, 0, "B", { bold: true, fg: 9 });
			const patch = screen.diff();

			expect(patch.output).toContain("\x1b[1m"); // Bold
			expect(patch.output).toContain("\x1b[38;5;9m"); // Foreground color
		});

		it("should emit reset codes after each cell", () => {
			screen.writeText(0, 0, "A", { bold: true });
			const patch = screen.diff();

			expect(patch.output).toContain("\x1b[0m"); // Reset
		});
	});

	describe("resize()", () => {
		it("should update dimensions", () => {
			screen.resize(30, 20);
			expect(screen.width).toBe(30);
			expect(screen.height).toBe(20);
			expect(screen.size).toEqual({ width: 30, height: 20 });
		});

		it("should clear both buffers on resize", () => {
			screen.writeText(0, 0, "Test");
			screen.diff(); // Commit to front buffer

			screen.resize(15, 10);

			// All cells should be empty
			const cell = screen.get(0, 0);
			expect(cell.char).toBe(" ");
		});

		it("should allow writing after resize", () => {
			screen.resize(5, 5);
			screen.writeText(0, 0, "OK");

			expect(screen.get(0, 0).char).toBe("O");
			expect(screen.get(0, 1).char).toBe("K");
		});

		it("should handle shrinking dimensions", () => {
			screen.resize(3, 2);
			expect(screen.width).toBe(3);
			expect(screen.height).toBe(2);

			// Should be able to write within new bounds
			screen.set(1, 2, {
				char: "Z",
				fg: -1,
				bg: -1,
				bold: false,
				dim: false,
				italic: false,
				underline: false,
				strikethrough: false,
			});
			expect(screen.get(1, 2).char).toBe("Z");

			// Old bounds should be out of range
			screen.set(4, 9, {
				char: "X",
				fg: -1,
				bg: -1,
				bold: false,
				dim: false,
				italic: false,
				underline: false,
				strikethrough: false,
			});
			expect(screen.get(4, 9).char).toBe(" "); // Returns empty for out of bounds
		});
	});

	describe("multiple render cycles", () => {
		it("should handle consecutive render cycles correctly", () => {
			// Frame 1
			screen.writeText(0, 0, "Frame1");
			const patch1 = screen.diff();
			expect(patch1.changedCells).toBe(6);

			// Frame 2 - different content
			screen.clear();
			screen.writeText(1, 2, "Frame2");
			const patch2 = screen.diff();
			expect(patch2.changedCells).toBe(12); // 6 cleared + 6 new

			// Frame 3 - no change
			screen.writeText(1, 2, "Frame2");
			const patch3 = screen.diff();
			expect(patch3.changedCells).toBe(0);

			// Frame 4 - partial update
			screen.writeText(1, 2, "Frame3");
			const patch4 = screen.diff();
			expect(patch4.changedCells).toBe(1); // Only last char changed
		});

		it("should handle rapid consecutive changes", () => {
			for (let i = 0; i < 10; i++) {
				screen.clear();
				screen.writeText(0, 0, `Cycle${i}`);
				const patch = screen.diff();
				expect(patch.changedCells).toBeGreaterThan(0);
			}
		});

		it("should correctly track changes across multiple rows", () => {
			screen.writeText(0, 0, "Row0");
			screen.writeText(1, 0, "Row1");
			screen.writeText(2, 0, "Row2");
			const patch1 = screen.diff();
			expect(patch1.changedCells).toBe(12);

			// Update middle row
			screen.writeText(0, 0, "Row0");
			screen.writeText(1, 0, "XXXX");
			screen.writeText(2, 0, "Row2");
			const patch2 = screen.diff();
			expect(patch2.changedCells).toBe(4); // Only row 1 changed
		});
	});

	describe("invalidate()", () => {
		it("should force full redraw on next diff", () => {
			screen.writeText(0, 0, "Test");
			screen.diff(); // Commit

			screen.invalidate();

			// Write same content
			screen.writeText(0, 0, "Test");
			const patch = screen.diff();

			// Should detect all cells as changed due to invalidation
			// invalidate() sets all front buffer cells to '\0', so all cells differ
			expect(patch.changedCells).toBe(50); // Full screen: 10 * 5
		});
	});

	describe("double-buffer mechanics", () => {
		it("should maintain separate front and back buffers", () => {
			// Write to back buffer
			screen.writeText(0, 0, "Back");

			// Front buffer should still be empty (no diff yet)
			screen.diff(); // Now front = back

			// Write different content to back
			screen.writeText(0, 0, "XXXX");

			// Back is "XXXX", front is "Back"
			const patch = screen.diff();
			expect(patch.changedCells).toBe(4);
		});

		it("should only emit differences on diff()", () => {
			screen.writeText(0, 0, "AAAA");
			screen.writeText(1, 0, "BBBB");
			const patch1 = screen.diff();
			expect(patch1.changedCells).toBe(8);

			// Change only one cell
			screen.writeText(0, 0, "AAAA");
			screen.writeText(1, 0, "BBBB");
			screen.set(1, 2, {
				char: "X",
				fg: -1,
				bg: -1,
				bold: false,
				dim: false,
				italic: false,
				underline: false,
				strikethrough: false,
			});

			const patch2 = screen.diff();
			expect(patch2.changedCells).toBe(1);
		});

		it("should accumulate changes between diffs", () => {
			screen.set(0, 0, {
				char: "A",
				fg: -1,
				bg: -1,
				bold: false,
				dim: false,
				italic: false,
				underline: false,
				strikethrough: false,
			});
			screen.set(0, 1, {
				char: "B",
				fg: -1,
				bg: -1,
				bold: false,
				dim: false,
				italic: false,
				underline: false,
				strikethrough: false,
			});
			screen.set(0, 2, {
				char: "C",
				fg: -1,
				bg: -1,
				bold: false,
				dim: false,
				italic: false,
				underline: false,
				strikethrough: false,
			});

			const patch = screen.diff();
			expect(patch.changedCells).toBe(3);
		});
	});

	describe("edge cases", () => {
		it("should handle zero dimensions", () => {
			const tiny = new Screen(0, 0);
			expect(tiny.width).toBe(0);
			expect(tiny.height).toBe(0);

			// Should not crash
			tiny.writeText(0, 0, "Test");
			const patch = tiny.diff();
			expect(patch.changedCells).toBe(0);
		});

		it("should handle single cell screen", () => {
			const single = new Screen(1, 1);
			single.set(0, 0, {
				char: "X",
				fg: -1,
				bg: -1,
				bold: false,
				dim: false,
				italic: false,
				underline: false,
				strikethrough: false,
			});

			const patch = single.diff();
			expect(patch.changedCells).toBe(1);
			expect(patch.output).toContain("X");
		});

		it("should handle very long text truncation", () => {
			const longText = "A".repeat(1000);
			screen.writeText(0, 0, longText);

			// Should only write 10 characters (width of screen)
			expect(screen.get(0, 9).char).toBe("A");
			expect(screen.get(0, 10)).toEqual({
				char: " ",
				fg: -1,
				bg: -1,
				bold: false,
				dim: false,
				italic: false,
				underline: false,
				strikethrough: false,
			});
		});

		it("should handle Unicode characters", () => {
			screen.writeText(0, 0, "→✓");
			expect(screen.get(0, 0).char).toBe("→");
			expect(screen.get(0, 1).char).toBe("✓");

			const patch = screen.diff();
			expect(patch.output).toContain("→");
			expect(patch.output).toContain("✓");
		});
	});
});
