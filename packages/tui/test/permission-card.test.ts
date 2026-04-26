import { describe, expect, it, vi } from "vitest";
import { createInputHandler } from "../src/app-input-handler.js";
import { buildPermissionCardLines } from "../src/panels/permission-card.js";
import { AppState } from "../src/state.js";

describe("buildPermissionCardLines", () => {
	it("renders an amber-bordered card with tool name in the title", () => {
		const lines = buildPermissionCardLines("bash", { command: "pnpm test" }, 80);
		expect(lines.length).toBeGreaterThan(3);
		expect(lines[0].text).toContain("permission");
		expect(lines[0].text).toContain("bash");
		expect(lines[0].text.startsWith("┌")).toBe(true);
		expect(lines[lines.length - 1].text.startsWith("└")).toBe(true);
	});

	it("emits a row per top-level argument key", () => {
		const lines = buildPermissionCardLines("bash", { command: "pnpm test", cwd: "/tmp/repo", timeout: 120 }, 80);
		const joined = lines.map((l) => l.text).join("\n");
		expect(joined).toContain("command:");
		expect(joined).toContain("cwd:");
		expect(joined).toContain("timeout:");
		expect(joined).toContain("pnpm test");
		expect(joined).toContain("/tmp/repo");
	});

	it("includes the action hint with allow + deny labels (no '[A] always' until allowlist exists)", () => {
		const lines = buildPermissionCardLines("bash", { command: "ls" }, 80);
		const joined = lines.map((l) => l.text).join("\n");
		expect(joined).toContain("[a] allow");
		expect(joined).toContain("[d] deny");
		expect(joined).not.toContain("always");
	});

	it("falls back to a placeholder when the tool has no arguments", () => {
		const lines = buildPermissionCardLines("ping", {}, 80);
		const joined = lines.map((l) => l.text).join("\n");
		expect(joined).toContain("(no arguments)");
	});
});

describe("input handler permission resolution", () => {
	function setup() {
		const state = new AppState();
		const addInfoMessage = vi.fn();
		const handler = createInputHandler({
			state,
			rootView: {
				chatView: {
					getSelectedText: () => null,
					insertText: () => undefined,
					scrollMessages: () => undefined,
				},
				handleKey: () => false,
			} as never,
			keybinds: { handle: () => false } as never,
			agentRunner: null,
			getActiveAutocycle: () => null,
			getScheduler: () => null,
			addInfoMessage,
			write: () => undefined,
			quit: async () => undefined,
			replayKeyContext: () => ({ state, addInfoMessage, scheduleRender: () => undefined }),
		});
		return { state, addInfoMessage, handler };
	}

	it("resolves with allowed:true when the operator presses 'a'", () => {
		const { state, handler, addInfoMessage } = setup();
		const resolve = vi.fn();
		state.pendingPermission.value = { approvalId: "ap-1", tool: "bash", args: { command: "pnpm test" }, resolve };

		handler(Buffer.from("a"));

		expect(resolve).toHaveBeenCalledWith({ allowed: true });
		expect(state.pendingPermission.value).toBeNull();
		expect(addInfoMessage).toHaveBeenCalledTimes(1);
		expect(addInfoMessage.mock.calls[0][0]).toContain("allowed");
		expect(addInfoMessage.mock.calls[0][0]).toContain("bash");
		expect(addInfoMessage.mock.calls[0][0]).toContain("pnpm test");
	});

	it("resolves with allowed:false when the operator presses 'd'", () => {
		const { state, handler, addInfoMessage } = setup();
		const resolve = vi.fn();
		state.pendingPermission.value = { approvalId: "ap-2", tool: "bash", args: { command: "rm -rf /" }, resolve };

		handler(Buffer.from("d"));

		expect(resolve).toHaveBeenCalledWith({ allowed: false });
		expect(state.pendingPermission.value).toBeNull();
		expect(addInfoMessage.mock.calls[0][0]).toContain("denied");
	});

	it("treats uppercase 'A' as a Shift-fumble alias for 'a' — still resolves allowed but audit says 'allowed', not 'always'", () => {
		const { state, handler, addInfoMessage } = setup();
		const resolve = vi.fn();
		state.pendingPermission.value = { approvalId: "ap-3", tool: "read", args: { file_path: "README.md" }, resolve };

		handler(Buffer.from("A"));

		expect(resolve).toHaveBeenCalledWith({ allowed: true });
		expect(addInfoMessage.mock.calls[0][0]).toContain("allowed");
		expect(addInfoMessage.mock.calls[0][0]).not.toContain("always");
	});

	it("swallows non-decision keys while a permission is pending so the composer doesn't eat them", () => {
		const { state, handler } = setup();
		const resolve = vi.fn();
		state.pendingPermission.value = { approvalId: "ap-4", tool: "bash", args: { command: "ls" }, resolve };

		handler(Buffer.from("x"));

		expect(resolve).not.toHaveBeenCalled();
		expect(state.pendingPermission.value).not.toBeNull();
	});

	it("promotes the next queued request after a decision (no orphaned promises)", () => {
		const { state, handler } = setup();
		const resolveFirst = vi.fn();
		const resolveSecond = vi.fn();
		state.pendingPermission.value = {
			approvalId: "ap-first",
			tool: "bash",
			args: { command: "ls" },
			resolve: resolveFirst,
		};
		state.pendingPermissionQueue.value = [
			{ approvalId: "ap-second", tool: "read", args: { file_path: "README.md" }, resolve: resolveSecond },
		];

		handler(Buffer.from("a"));

		// First request resolved
		expect(resolveFirst).toHaveBeenCalledWith({ allowed: true });
		// Queue head promoted into the visible slot, queue drained
		expect(state.pendingPermission.value?.tool).toBe("read");
		expect(state.pendingPermissionQueue.value).toEqual([]);
		// Second request still pending — promise has not been touched yet
		expect(resolveSecond).not.toHaveBeenCalled();

		handler(Buffer.from("d"));

		expect(resolveSecond).toHaveBeenCalledWith({ allowed: false });
		expect(state.pendingPermission.value).toBeNull();
	});

	it("strips ANSI/control sequences from the audit row so a hostile tool name can't clear the screen", () => {
		const { state, handler, addInfoMessage } = setup();
		const resolve = vi.fn();
		// Tool name carries a screen-clear escape (\x1b[2J) and a cursor-home
		// escape (\x1b[H). Without scrubbing, addInfoMessage would render them
		// verbatim and wipe the operator's transcript.
		state.pendingPermission.value = {
			approvalId: "ap-evil",
			tool: "bash\x1b[2J\x1b[H",
			args: { command: "ls\x1b]0;hijack\x07" },
			resolve,
		};

		handler(Buffer.from("a"));

		const msg = addInfoMessage.mock.calls[0][0];
		expect(msg).not.toContain("\x1b");
		expect(msg).not.toContain("\x07");
		expect(msg).toContain("bash");
		expect(msg).toContain("ls");
	});
});
