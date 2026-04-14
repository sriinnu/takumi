/**
 * MuxAdapter — common multiplexer contract for side-agent isolation.
 *
 * Defines the shared surface for TmuxOrchestrator, ProcessOrchestrator, and
 * future adapters (Docker exec, SSH). Inspired by oh-my-codex's MuxAdapter trait.
 * @module
 */

/** Minimal common window info returned by any mux adapter. */
export interface MuxWindow {
	readonly id: string;
	readonly name: string;
}

/** Common contract for terminal multiplexers that host side-agent processes. */
export interface MuxAdapter {
	/** Human-readable name for logging and diagnostics. */
	readonly adapterName: string;
	/** Spawn an isolated window/process for the given agent. */
	createWindow(agentId: string, cwd: string, command?: string): Promise<MuxWindow>;
	/** Send keystrokes (stdin) to the agent's window. */
	sendKeys(agentId: string, text: string): Promise<void>;
	/** Capture recent output from the agent's window. */
	captureOutput(agentId: string, lines?: number): Promise<string>;
	/** Terminate the agent's window. */
	killWindow(agentId: string): Promise<void>;
	/** Check whether the agent's window is still running. */
	isWindowAlive(agentId: string): Promise<boolean>;
	/** Tear down all windows and release resources. */
	cleanup(): Promise<void>;
	/** Snapshot of all tracked windows. */
	getWindows(): Map<string, MuxWindow>;
}

/** Discriminated union describing a mux operation to dispatch. */
export type MuxOperation =
	| { type: "create"; agentId: string; cwd: string; command?: string }
	| { type: "send-keys"; agentId: string; text: string }
	| { type: "capture"; agentId: string; lines?: number }
	| { type: "kill"; agentId: string }
	| { type: "liveness"; agentId: string }
	| { type: "cleanup" };

/** Discriminated union describing the result of a dispatched operation. */
export type MuxOutcome =
	| { type: "created"; window: MuxWindow }
	| { type: "keys-sent" }
	| { type: "captured"; output: string; lines: number }
	| { type: "killed" }
	| { type: "liveness"; alive: boolean }
	| { type: "cleaned-up" };

// ── Error ─────────────────────────────────────────────────────────────────────

/** Structured error for mux adapter failures. */
export class MuxError extends Error {
	readonly code: "unsupported" | "invalid_target" | "adapter_failed";

	constructor(code: MuxError["code"], message: string) {
		super(message);
		this.name = "MuxError";
		this.code = code;
	}
}

/** Dispatch a `MuxOperation` to a `MuxAdapter`, returning the typed outcome. */
export async function executeMuxOperation(adapter: MuxAdapter, op: MuxOperation): Promise<MuxOutcome> {
	switch (op.type) {
		case "create": {
			const window = await adapter.createWindow(op.agentId, op.cwd, op.command);
			return { type: "created", window };
		}
		case "send-keys": {
			await adapter.sendKeys(op.agentId, op.text);
			return { type: "keys-sent" };
		}
		case "capture": {
			const output = await adapter.captureOutput(op.agentId, op.lines);
			const lines = output.split("\n").length;
			return { type: "captured", output, lines };
		}
		case "kill": {
			await adapter.killWindow(op.agentId);
			return { type: "killed" };
		}
		case "liveness": {
			const alive = await adapter.isWindowAlive(op.agentId);
			return { type: "liveness", alive };
		}
		case "cleanup": {
			await adapter.cleanup();
			return { type: "cleaned-up" };
		}
	}
}

/** Auto-select the best available mux adapter. Lazy imports keep tmux code off Windows. */
export async function createMuxAdapter(sessionName?: string): Promise<MuxAdapter> {
	// I try tmux first — it gives true terminal isolation
	const { TmuxOrchestrator } = await import("./tmux-orchestrator.js");
	if (await TmuxOrchestrator.isAvailable()) {
		const orch = new TmuxOrchestrator(sessionName);
		return {
			adapterName: "tmux",
			createWindow: (id, cwd, cmd) =>
				orch.createWindow(id, cwd, cmd).then((w) => ({ id: w.windowId, name: w.windowName })),
			sendKeys: (id, text) => orch.sendKeys(id, text),
			captureOutput: (id, lines) => orch.captureOutput(id, lines),
			killWindow: (id) => orch.killWindow(id),
			isWindowAlive: (id) => orch.isWindowAlive(id),
			cleanup: () => orch.cleanup(),
			getWindows: () => {
				const out = new Map<string, MuxWindow>();
				for (const [k, v] of orch.getWindows()) out.set(k, { id: v.windowId, name: v.windowName });
				return out;
			},
		};
	}

	// Fall back to cross-platform child_process isolation
	const { ProcessOrchestrator } = await import("./process-orchestrator.js");
	const orch = new ProcessOrchestrator();
	return {
		adapterName: "process",
		createWindow: (id, cwd, cmd) =>
			orch.createWindow(id, cmd ?? "sh", [], cwd).then((w) => ({ id: w.id, name: w.name })),
		sendKeys: async (id, text) => orch.sendKeys(id, text),
		captureOutput: async (id, lines) => orch.captureOutput(id, lines),
		killWindow: (id) => orch.killWindow(id),
		isWindowAlive: (id) => orch.isWindowAlive(id),
		cleanup: () => orch.destroyAll(),
		getWindows: () => {
			const out = new Map<string, MuxWindow>();
			for (const w of orch.listWindows()) out.set(w.id, { id: w.id, name: w.name });
			return out;
		},
	};
}
