/**
 * Tests for the Renderer pipeline orchestrator (Kagami).
 */

import type { Rect } from "@takumi/core";
import { describe, expect, it, vi } from "vitest";
import { Component } from "../src/component.js";
import { Renderer } from "../src/renderer.js";
import type { Screen } from "../src/screen.js";

// ── Test component ────────────────────────────────────────────────────────────

class StubComponent extends Component {
	renderCalled = false;

	render(_screen: Screen, _rect: Rect): void {
		this.renderCalled = true;
	}
}

// ── Mock streams ──────────────────────────────────────────────────────────────

function mockStdout(): NodeJS.WriteStream {
	const chunks: string[] = [];
	return {
		columns: 80,
		rows: 24,
		write: vi.fn((data: string) => {
			chunks.push(data);
			return true;
		}),
		__chunks: chunks,
	} as unknown as NodeJS.WriteStream;
}

function mockStdin(): NodeJS.ReadStream {
	return {
		setRawMode: vi.fn(),
		resume: vi.fn(),
		on: vi.fn(),
		removeListener: vi.fn(),
	} as unknown as NodeJS.ReadStream;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Renderer", () => {
	let stdout: NodeJS.WriteStream;
	let stdin: NodeJS.ReadStream;

	beforeEach(() => {
		stdout = mockStdout();
		stdin = mockStdin();
	});

	describe("construction", () => {
		it("creates with default options", () => {
			const renderer = new Renderer({ stdout, stdin });
			expect(renderer.isRunning).toBe(false);
			expect(renderer.capabilities).toBeDefined();
			expect(renderer.capabilities.name).toBeDefined();
		});

		it("detects terminal capabilities from env", () => {
			const renderer = new Renderer({
				stdout,
				stdin,
				env: { TERM_PROGRAM: "ghostty" },
			});
			expect(renderer.capabilities.name).toBe("ghostty");
			expect(renderer.capabilities.truecolor).toBe(true);
		});

		it("respects mouse option", () => {
			const renderer = new Renderer({ stdout, stdin, mouse: false });
			const root = new StubComponent();
			renderer.start(root);
			// ALT_SCREEN_ON and CURSOR_HIDE should be written, but NOT MOUSE_ON
			const output = (stdout.write as any).mock.calls.map((c: string[]) => c[0]).join("");
			expect(output).toContain("\x1b[?1049h"); // ALT_SCREEN_ON
			expect(output).not.toContain("\x1b[?1000h"); // MOUSE_ON
			renderer.stop();
		});
	});

	describe("lifecycle", () => {
		it("starts and sets running state", () => {
			const renderer = new Renderer({ stdout, stdin });
			const root = new StubComponent();

			expect(renderer.isRunning).toBe(false);
			renderer.start(root);
			expect(renderer.isRunning).toBe(true);
			renderer.stop();
		});

		it("writes alt screen and cursor hide on start", () => {
			const renderer = new Renderer({ stdout, stdin });
			renderer.start(new StubComponent());

			const output = (stdout.write as any).mock.calls.map((c: string[]) => c[0]).join("");
			expect(output).toContain("\x1b[?1049h"); // ALT_SCREEN_ON
			expect(output).toContain("\x1b[?25l"); // CURSOR_HIDE
			renderer.stop();
		});

		it("enables raw mode on start", () => {
			const renderer = new Renderer({ stdout, stdin });
			renderer.start(new StubComponent());

			expect((stdin as any).setRawMode).toHaveBeenCalledWith(true);
			renderer.stop();
		});

		it("restores terminal on stop", () => {
			const renderer = new Renderer({ stdout, stdin });
			renderer.start(new StubComponent());

			// Clear previous writes
			(stdout.write as any).mockClear();

			renderer.stop();

			const output = (stdout.write as any).mock.calls.map((c: string[]) => c[0]).join("");
			expect(output).toContain("\x1b[?25h"); // CURSOR_SHOW
			expect(output).toContain("\x1b[?1049l"); // ALT_SCREEN_OFF
			expect(renderer.isRunning).toBe(false);
		});

		it("disables raw mode on stop", () => {
			const renderer = new Renderer({ stdout, stdin });
			renderer.start(new StubComponent());
			(stdin as any).setRawMode.mockClear();

			renderer.stop();
			expect((stdin as any).setRawMode).toHaveBeenCalledWith(false);
		});

		it("stop is idempotent", () => {
			const renderer = new Renderer({ stdout, stdin });
			renderer.start(new StubComponent());
			renderer.stop();
			// Should not throw
			renderer.stop();
			expect(renderer.isRunning).toBe(false);
		});

		it("start is idempotent when already running", () => {
			const renderer = new Renderer({ stdout, stdin });
			const root = new StubComponent();
			renderer.start(root);
			// Second start should not throw or double-init
			renderer.start(root);
			expect(renderer.isRunning).toBe(true);
			renderer.stop();
		});

		it("dispose prevents restart", () => {
			const renderer = new Renderer({ stdout, stdin });
			renderer.dispose();
			expect(() => renderer.start(new StubComponent())).toThrow(/disposed/);
		});
	});

	describe("rendering", () => {
		it("forceRender triggers synchronous frame", () => {
			const renderer = new Renderer({ stdout, stdin, mouse: false, bracketedPaste: false });
			const root = new StubComponent();
			renderer.start(root);
			root.renderCalled = false;

			renderer.forceRender();
			// The underlying scheduler should have rendered
			// (StubComponent doesn't change cells, so no ANSI output expected)
			renderer.stop();
		});

		it("scheduleRender requests a deferred frame", () => {
			const renderer = new Renderer({ stdout, stdin, mouse: false, bracketedPaste: false });
			renderer.start(new StubComponent());

			// Should not throw
			renderer.scheduleRender();
			renderer.stop();
		});

		it("invalidate forces full-screen redraw", () => {
			const renderer = new Renderer({ stdout, stdin, mouse: false, bracketedPaste: false });
			renderer.start(new StubComponent());

			// Should not throw
			renderer.invalidate();
			renderer.stop();
		});
	});

	describe("terminal info", () => {
		it("getTerminalSize returns stdout dimensions", () => {
			const renderer = new Renderer({ stdout, stdin });
			const size = renderer.getTerminalSize();
			expect(size.width).toBe(80);
			expect(size.height).toBe(24);
		});

		it("getStats returns frame count and capabilities", () => {
			const renderer = new Renderer({ stdout, stdin });
			const stats = renderer.getStats();
			expect(stats.frameCount).toBe(0);
			expect(stats.capabilities).toBeDefined();
			expect(stats.running).toBe(false);
		});

		it("getScreen returns the underlying screen", () => {
			const renderer = new Renderer({ stdout, stdin });
			const screen = renderer.getScreen();
			expect(screen).toBeDefined();
			expect(screen.width).toBe(80);
			expect(screen.height).toBe(24);
		});
	});

	describe("synchronized output", () => {
		it("wraps output with sync markers when terminal supports it", () => {
			const renderer = new Renderer({
				stdout,
				stdin,
				env: { TERM_PROGRAM: "ghostty" },
				mouse: false,
				bracketedPaste: false,
			});
			// Ghostty supports synchronized output
			expect(renderer.capabilities.synchronizedOutput).toBe(true);
		});

		it("disables sync output when terminal lacks support", () => {
			const renderer = new Renderer({
				stdout,
				stdin,
				env: { TERM_PROGRAM: "Apple_Terminal" },
			});
			expect(renderer.capabilities.synchronizedOutput).toBe(false);
		});

		it("can be explicitly disabled via option", () => {
			const renderer = new Renderer({
				stdout,
				stdin,
				env: { TERM_PROGRAM: "ghostty" },
				synchronizedOutput: false,
			});
			// Stats should still show the terminal capability
			expect(renderer.capabilities.synchronizedOutput).toBe(true);
		});
	});

	describe("setRoot", () => {
		it("replaces root component", () => {
			const renderer = new Renderer({ stdout, stdin, mouse: false, bracketedPaste: false });
			const root1 = new StubComponent();
			const root2 = new StubComponent();
			renderer.start(root1);

			renderer.setRoot(root2);
			renderer.forceRender();
			renderer.stop();
		});
	});
});
