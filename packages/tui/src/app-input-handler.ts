/**
 * Input state machine for the TUI.
 *
 * Raw stdin bytes flow through a multi-stage pipeline:
 *
 *   UTF-8 decode → paste accumulation → tokenize → per-event dispatch
 *
 * Per-event dispatch follows a priority-ordered chain:
 *
 *   mouse → Ctrl+C (copy / cancel / quit) → Ctrl+V (paste)
 *   → replay navigation → keybinding registry → root view fallthrough
 *
 * Each stage either consumes the input and returns, or falls through to the
 * next. A priority render is scheduled after every consumed event so the
 * screen reflects the new state within the same frame.
 *
 * Key design invariants:
 *
 * - **StringDecoder** bridges TCP/pipe read boundaries — a 3-byte UTF-8
 *   codepoint split across two `data` events is reassembled correctly.
 * - **tokenizeInput** splits multi-event chunks so fast typing after a
 *   blocking syscall (clipboard read) never drops characters.
 * - **Paste accumulation** buffers bracketed paste content that spans
 *   multiple `data` events, preventing partial paste + garbled input.
 */
import { StringDecoder } from "node:string_decoder";
import { KEY_CODES } from "@takumi/core";
import type { RenderScheduler } from "@takumi/render";
import type { AgentRunner } from "./agent/agent-runner.js";
import type { AutocycleAgent } from "./autocycle/autocycle-agent.js";
import { parseKeyEvent, parseMouseEvent, tokenizeInput } from "./input/app-input.js";
import { copyToSystemClipboard, PASTE_END, PASTE_START, readFromSystemClipboard } from "./input/clipboard-actions.js";
import type { KeyBindingRegistry } from "./input/keybinds.js";
import { handleReplayKey } from "./input/replay-keybinds.js";
import type { AppState } from "./state.js";
import type { RootView } from "./views/root.js";

/**
 * Maximum characters I accept in a single paste operation.
 * 100 K chars ≈ ~3 K lines in the editor buffer — comfortably within
 * rendering and cursor-offset calculation budgets. Anything larger is
 * almost certainly an accidental copy of a build artifact or binary.
 */
const MAX_PASTE_CHARS = 100_000;

export interface InputHandlerDeps {
	state: AppState;
	rootView: RootView;
	keybinds: KeyBindingRegistry;
	agentRunner: AgentRunner | null;
	getActiveAutocycle(): AutocycleAgent | null;
	getScheduler(): RenderScheduler | null;
	addInfoMessage(text: string): void;
	write(data: string): void;
	quit(): Promise<void>;
	replayKeyContext(): { state: AppState; addInfoMessage(t: string): void; scheduleRender(): void };
}

/**
 * Clamp paste content to {@link MAX_PASTE_CHARS}. Returns the (possibly
 * truncated) text and whether truncation occurred. I enforce this at the
 * input boundary — before anything touches the editor buffer — so the
 * rest of the pipeline can assume bounded input.
 */
function clampPaste(text: string): { text: string; truncated: boolean } {
	if (text.length <= MAX_PASTE_CHARS) return { text, truncated: false };
	return { text: text.slice(0, MAX_PASTE_CHARS), truncated: true };
}

/** Create the stdin data handler that dispatches input through the TUI stack. */
export function createInputHandler(deps: InputHandlerDeps): (data: Buffer) => void {
	/** Bridges partial multi-byte UTF-8 across TCP/pipe read boundaries. */
	const decoder = new StringDecoder("utf-8");

	/**
	 * Accumulator for bracketed paste content that spans multiple `data`
	 * events. `null` when I'm not mid-paste. When non-null, holds everything
	 * from PASTE_START onward, including the delimiter itself, so I can
	 * slice cleanly when PASTE_END arrives.
	 */
	let pasteBuffer: string | null = null;

	return (data: Buffer) => {
		const raw = decoder.write(data);
		if (!raw) return;

		// ── Mid-paste accumulation ──────────────────────────────────
		if (pasteBuffer !== null) {
			pasteBuffer += raw;
			const endIdx = pasteBuffer.indexOf(PASTE_END);
			if (endIdx === -1) return;
			const content = pasteBuffer.slice(PASTE_START.length, endIdx);
			const remainder = pasteBuffer.slice(endIdx + PASTE_END.length);
			pasteBuffer = null;
			dispatchPaste(deps, content);
			if (remainder) dispatchTokens(deps, remainder);
			return;
		}

		// ── Check for new paste start ───────────────────────────────
		const pasteIdx = raw.indexOf(PASTE_START);
		if (pasteIdx !== -1) {
			if (pasteIdx > 0) dispatchTokens(deps, raw.slice(0, pasteIdx));
			const afterStart = raw.slice(pasteIdx);
			const endIdx = afterStart.indexOf(PASTE_END);
			if (endIdx !== -1) {
				dispatchPaste(deps, afterStart.slice(PASTE_START.length, endIdx));
				const remainder = afterStart.slice(endIdx + PASTE_END.length);
				if (remainder) dispatchTokens(deps, remainder);
			} else {
				pasteBuffer = afterStart;
			}
			return;
		}

		// ── Normal input — tokenize and dispatch each event ─────────
		dispatchTokens(deps, raw);
	};
}

/** Dispatch completed paste content through clamping and into the editor. */
function dispatchPaste(deps: InputHandlerDeps, content: string): void {
	const paste = clampPaste(content);
	if (paste.truncated) deps.addInfoMessage("Paste truncated to 100 KB.");
	deps.rootView.chatView.insertText(paste.text);
	deps.getScheduler()?.schedulePriorityRender();
}

/**
 * Tokenize a raw string and dispatch each event through the priority chain.
 * `schedulePriorityRender()` is called per event but deduped by the scheduler —
 * only one render fires after the entire token batch is processed.
 */
function dispatchTokens(deps: InputHandlerDeps, raw: string): void {
	const scheduler = deps.getScheduler();
	const tokens = tokenizeInput(raw);

	for (const token of tokens) {
		// ── Mouse events (wheel scroll, panel focus click) ──
		const mouseEvent = parseMouseEvent(token);
		if (mouseEvent) {
			handleMouse(deps, mouseEvent);
			scheduler?.schedulePriorityRender();
			continue;
		}

		const event = parseKeyEvent(token);

		// ── Pending permission preempts everything except Ctrl+C cancel ──
		// The card is rendered inline in the message list. We capture decision
		// keys here, BEFORE keybinds and rootView, so the operator's choice is
		// never swallowed by a slash command or a focused panel. Ctrl+C still
		// works as a cancel because its branch runs after this one — but only
		// if the user hasn't pressed an answer key first.
		if (deps.state.pendingPermission.value) {
			if (handlePendingPermission(deps, event)) {
				scheduler?.schedulePriorityRender();
				continue;
			}
			// While a permission is pending, swallow other input so the
			// composer doesn't accept stray characters that look like answers.
			if (!event.ctrl) {
				scheduler?.schedulePriorityRender();
				continue;
			}
		}

		// ── Ctrl+C: copy selection → cancel agent → cancel autocycle → quit ──
		if (event.ctrl && event.key === "c") {
			const selected = deps.rootView.chatView.getSelectedText();
			if (selected) {
				copyToSystemClipboard(selected, (s) => deps.write(s));
				scheduler?.schedulePriorityRender();
				continue;
			}
			if (deps.agentRunner?.isRunning) {
				deps.agentRunner.cancel();
				return;
			}
			const autocycle = deps.getActiveAutocycle();
			if (autocycle?.isActive) {
				autocycle.cancel();
				deps.addInfoMessage("Autocycle cancelled.");
				return;
			}
			void deps.quit();
			return;
		}

		// ── Ctrl+V: explicit paste via system clipboard read ──
		if (event.ctrl && event.key === "v") {
			const clip = readFromSystemClipboard();
			if (clip) {
				const paste = clampPaste(clip);
				if (paste.truncated) deps.addInfoMessage("Paste truncated to 100 KB.");
				deps.rootView.chatView.insertText(paste.text);
				scheduler?.schedulePriorityRender();
			}
			continue;
		}

		// ── Replay navigation, keybindings, root view fallthrough ──
		if (deps.state.replayMode.value && handleReplayKey(event, deps.replayKeyContext())) {
			scheduler?.schedulePriorityRender();
			continue;
		}
		if (deps.keybinds.handle(event)) {
			scheduler?.schedulePriorityRender();
			continue;
		}
		deps.rootView.handleKey(event);
		scheduler?.schedulePriorityRender();
	}
}

/**
 * Decide what to do with a key while a permission is pending. Returns `true`
 * when the key was a recognised decision (allow/deny) and was applied; `false`
 * when the key should fall through (currently never — every non-decision key
 * is silently swallowed by the caller while a card is open). On allow or deny
 * we push a one-line audit row into the transcript so the operator's choice
 * persists in scrollback after the card disappears, and promote the head of
 * `pendingPermissionQueue` into the visible slot if more requests are waiting.
 *
 * Note on `A` (Shift+a): the original modal had a separate "always allow"
 * outcome with a `remember` flag. That field is gone from `PermissionDecision`
 * today — there is no allowlist persistence behind it — so `A` is treated as
 * a plain alias for `a` to avoid Shift-key fumbles, and the audit row says
 * "allowed" rather than the misleading "always allow" the redesign briefly
 * shipped with. Restore the distinction once the agent honours `remember`.
 */
function handlePendingPermission(
	deps: InputHandlerDeps,
	event: { key: string; raw: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean },
): boolean {
	const pending = deps.state.pendingPermission.value;
	if (!pending) return false;

	const isAllow = event.key === "a" || event.key === "A" || event.key === "y" || event.raw === KEY_CODES.ENTER;
	const isDeny = event.key === "d" || event.key === "n" || event.raw === KEY_CODES.ESCAPE;

	if (!isAllow && !isDeny) return false;

	pending.resolve({ allowed: isAllow });

	// Promote the head of the queue into the visible slot — the next pending
	// card appears immediately so the operator can keep moving.
	const queue = deps.state.pendingPermissionQueue.value;
	if (queue.length > 0) {
		const [next, ...rest] = queue;
		deps.state.pendingPermissionQueue.value = rest;
		deps.state.pendingPermission.value = next;
	} else {
		deps.state.pendingPermission.value = null;
		if (deps.state.topDialog === "permission") deps.state.popDialog();
	}

	const verb = isDeny ? "denied" : "allowed";
	const summary = sanitiseForAudit(summarisePermissionArgs(pending.args));
	const toolLabel = sanitiseForAudit(pending.tool);
	deps.addInfoMessage(`${verb} · ${toolLabel}${summary ? ` · ${summary}` : ""}`);
	return true;
}

/**
 * Strip ANSI escape sequences and other control characters before pushing a
 * tool name or argument summary into the transcript. Both `pending.tool` and
 * `pending.args` are agent-controlled inputs — without this scrubber an agent
 * could embed cursor-control or screen-clear escapes that the markdown
 * renderer would emit verbatim, mangling the operator's scrollback.
 */
function sanitiseForAudit(text: string): string {
	if (!text) return text;
	return text
		.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
		.replace(/\x1b\].*?(?:\x07|\x1b\\)/g, "")
		.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

/** Single-line summary of permission args for the audit-trail message. */
function summarisePermissionArgs(args: Record<string, unknown>): string {
	const cmd = args.command;
	if (typeof cmd === "string" && cmd.trim().length > 0) {
		const oneLine = cmd.replace(/\r?\n/g, " ").trim();
		return oneLine.length > 100 ? `${oneLine.slice(0, 99)}…` : oneLine;
	}
	const path = args.file_path ?? args.path;
	if (typeof path === "string" && path.trim().length > 0) {
		return path;
	}
	return "";
}

function handleMouse(
	deps: Pick<InputHandlerDeps, "rootView" | "state">,
	event: { type: string; x: number; wheelDelta: number },
): void {
	if (event.type === "wheel") {
		deps.rootView.chatView.scrollMessages(event.wheelDelta > 0 ? -3 : 3);
		return;
	}
	if (event.type !== "mousedown") return;
	const { width } = deps.state.terminalSize.value;
	const sidebarWidth = deps.state.sidebarVisible.value ? Math.min(30, Math.floor(width * 0.25)) : 0;
	deps.state.focusedPanel.value =
		event.x >= width - sidebarWidth && deps.state.sidebarVisible.value ? "sidebar" : "input";
}

export { parseMouseEvent };
