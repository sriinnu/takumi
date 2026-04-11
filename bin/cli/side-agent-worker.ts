import { createInterface } from "node:readline";
import { execFile } from "node:child_process";
import { loadConfig, type TakumiConfig } from "@takumi/core";
import {
	ToolRegistry,
	registerBuiltinTools,
	formatSideAgentReadyMarker,
	formatSideAgentRunMarker,
	parseSideAgentDispatchHeader,
	SIDE_AGENT_DISPATCH_CLOSE_MARKER,
	type SideAgentDispatchEnvelope,
	type SideAgentDispatchHeader,
} from "@takumi/agent";
import { runOneShot, type OneShotPrebuiltDeps } from "./one-shot.js";
import { collectRuntimeBootstrap } from "./runtime-bootstrap.js";

interface SideAgentWorkerArgs {
	id: string;
	model: string;
	worktreePath: string;
}

/**
 * Fire-and-forget tmux channel signal. If tmux isn't available (process
 * orchestrator path), the spawn fails silently — parent falls back to polling.
 */
function signalTmuxChannel(channel: string): void {
	execFile("tmux", ["wait-for", "-S", channel], () => {});
}

/**
 * I keep the worker argv tiny on purpose: the lane identity, routed model, and
 * worktree path are the only things the persistent worker truly owns.
 */
function parseWorkerArgs(argv: string[]): SideAgentWorkerArgs {
	let id: string | null = null;
	let model: string | null = null;
	let worktreePath: string | null = null;
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === "--id") {
			id = argv[index + 1] ?? null;
			index += 1;
			continue;
		}
		if (value === "--model") {
			model = argv[index + 1] ?? null;
			index += 1;
			continue;
		}
		if (value === "--worktree") {
			worktreePath = argv[index + 1] ?? null;
			index += 1;
		}
	}
	if (!id || !model || !worktreePath) {
		throw new Error("Usage: side-agent-worker --id <lane-id> --model <model> --worktree <path>");
	}
	return { id, model, worktreePath };
}

/**
 * I build the expensive one-shot deps once so every dispatch reuses the same
 * ToolRegistry and Chitragupta bridge instead of paying ~55-200ms per call.
 */
async function buildWorkerDeps(config: TakumiConfig): Promise<OneShotPrebuiltDeps> {
	const tools = new ToolRegistry();
	registerBuiltinTools(tools);
	const runtimeBootstrap = await collectRuntimeBootstrap(config, {
		cwd: process.cwd(),
		tools,
		enableChitraguptaBootstrap: true,
		includeProviderStatus: true,
		bootstrapMode: "exec",
		runtimeRole: "side-agent-worker",
		consumer: "takumi",
		capability: "coding.patch-cheap",
	});
	return { tools, runtimeBootstrap };
}

async function main(): Promise<void> {
	const args = parseWorkerArgs(process.argv.slice(2));
	process.env.TAKUMI_RUNTIME_ROLE = "side-agent-worker";

	// Hoist config + deps: model and worktree are constant per worker lifetime.
	const config = loadConfig({ model: args.model, workingDirectory: args.worktreePath });
	const prebuiltDeps = await buildWorkerDeps(config);

	process.stdout.write(`${formatSideAgentReadyMarker({ id: args.id })}\n`);
	signalTmuxChannel(`takumi-ready-${args.id}`);
	await processDispatchLoop(args, config, prebuiltDeps);

	// Worker is done — disconnect the bridge we kept alive across dispatches.
	try {
		if (prebuiltDeps.runtimeBootstrap.chitragupta?.bridge?.isConnected) {
			await prebuiltDeps.runtimeBootstrap.chitragupta.bridge.disconnect();
		}
	} catch { /* best effort */ }
}

/**
 * I read stdin as a simple line-oriented mailbox because tmux/process lanes are
 * already good at shipping text, and I don't need another transport religion.
 */
async function processDispatchLoop(
	args: SideAgentWorkerArgs,
	config: TakumiConfig,
	prebuiltDeps: OneShotPrebuiltDeps,
): Promise<void> {
	const input = createInterface({
		input: process.stdin,
		crlfDelay: Infinity,
		terminal: false,
	});
	let header: SideAgentDispatchHeader | null = null;
	let promptLines: string[] = [];
	for await (const line of input) {
		if (!header) {
			header = parseSideAgentDispatchHeader(line);
			promptLines = [];
			continue;
		}
		if (line.trim() === SIDE_AGENT_DISPATCH_CLOSE_MARKER) {
			await runDispatch(args, { ...header, prompt: promptLines.join("\n").trimEnd() }, config, prebuiltDeps);
			header = null;
			promptLines = [];
			continue;
		}
		promptLines.push(line);
	}
}

/**
 * I execute one dispatch at a time so a lane stays reusable without pretending
 * we have concurrency inside a single tmux pane. One worker, one queue, no lies.
 */
async function runDispatch(
	args: SideAgentWorkerArgs,
	dispatch: SideAgentDispatchEnvelope,
	config: TakumiConfig,
	prebuiltDeps: OneShotPrebuiltDeps,
): Promise<void> {
	const repoRoot = process.cwd();
	process.stdout.write(
		`${formatSideAgentRunMarker({
			id: args.id,
			seq: dispatch.seq,
			kind: dispatch.kind,
			requestId: dispatch.requestId,
			status: "begin",
		})}\n`,
	);
	let exitCode = 1;
	try {
		process.chdir(args.worktreePath);
		const result = await runOneShot(config, dispatch.prompt, undefined, "text", {
			runId: `${args.id}-${dispatch.seq}-${Date.now().toString(36)}`,
			headless: true,
			enableChitraguptaBootstrap: true,
			runtimeRole: "side-agent-worker",
			prebuiltDeps,
		});
		exitCode = result.exitCode;
	} catch (error) {
		process.stderr.write(
			`[side-agent-worker] ${error instanceof Error ? error.message : String(error)}\n`,
		);
	} finally {
		process.chdir(repoRoot);
		process.stdout.write(
			`${formatSideAgentRunMarker({
				id: args.id,
				seq: dispatch.seq,
				kind: dispatch.kind,
				requestId: dispatch.requestId,
				status: "exit",
				code: exitCode,
			})}\n`,
		);
		if (dispatch.kind === "query" && dispatch.requestId) {
			signalTmuxChannel(`takumi-query-${dispatch.requestId}`);
		}
	}
}

main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
});
