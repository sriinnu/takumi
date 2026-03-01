/**
 * Takumi eval harness — runs golden tasks headlessly and scores them.
 *
 * Usage:
 *   pnpm eval                    # run all tasks
 *   pnpm eval --task read-file   # run a single task
 *   pnpm eval --model gpt-4o     # override model
 *   pnpm eval --json             # output JSON report
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GoldenTask {
	id: string;
	/** Human-readable description. */
	description: string;
	/** The prompt sent to the agent. */
	prompt: string;
	/** Shell commands to run in the workspace before the agent. */
	setup?: string[];
	/** Assertions that must all pass for the task to be scored "pass". */
	assertions: TaskAssertion[];
	/** Maximum USD spend allowed for this task. */
	maxCostUsd?: number;
}

type TaskAssertion =
	| { type: "file_exists"; path: string }
	| { type: "file_contains"; path: string; pattern: string | RegExp }
	| { type: "tool_used"; name: string }
	| { type: "tool_not_used"; name: string };

interface TaskResult {
	task: GoldenTask;
	passed: boolean;
	failedAssertions: string[];
	toolsUsed: string[];
	durationMs: number;
	costUsd: number;
	error?: string;
}

// ── Golden task catalogue ─────────────────────────────────────────────────────

const GOLDEN_TASKS: GoldenTask[] = [
	{
		id: "read-file",
		description: "Agent reads an existing file and reports its content",
		prompt: "Read the file called hello.txt and tell me what it says.",
		setup: ["echo 'Hello from Takumi eval!' > hello.txt"],
		assertions: [
			{ type: "tool_used", name: "read" },
		],
		maxCostUsd: 0.05,
	},
	{
		id: "write-file",
		description: "Agent creates a new file with specified content",
		prompt: "Create a file called output.txt containing exactly the text: EVAL_PASS",
		assertions: [
			{ type: "file_exists", path: "output.txt" },
			{ type: "file_contains", path: "output.txt", pattern: "EVAL_PASS" },
			{ type: "tool_used", name: "write" },
		],
		maxCostUsd: 0.05,
	},
	{
		id: "edit-file",
		description: "Agent edits an existing file",
		prompt: "In the file target.txt, replace the word REPLACE_ME with REPLACED.",
		setup: ["echo 'The token: REPLACE_ME' > target.txt"],
		assertions: [
			{ type: "file_contains", path: "target.txt", pattern: "REPLACED" },
			{ type: "tool_used", name: "edit" },
		],
		maxCostUsd: 0.05,
	},
	{
		id: "bash-command",
		description: "Agent runs a shell command to gather information",
		prompt: "What files are in the current directory? Use bash to list them.",
		assertions: [
			{ type: "tool_used", name: "bash" },
		],
		maxCostUsd: 0.05,
	},
	{
		id: "multi-step",
		description: "Agent performs a 3-step coding task",
		prompt: "Create a file lib.ts with a function called `add` that takes two numbers and returns their sum. Then create a file main.ts that imports and calls `add(2, 3)` and writes the result to result.txt.",
		assertions: [
			{ type: "file_exists", path: "lib.ts" },
			{ type: "file_exists", path: "main.ts" },
			{ type: "file_contains", path: "lib.ts", pattern: /function\s+add/ },
		],
		maxCostUsd: 0.20,
	},
];

// ── Runner ────────────────────────────────────────────────────────────────────

async function runTask(task: GoldenTask, model: string): Promise<TaskResult> {
	const start = Date.now();
	const workspace = await mkdtemp(join(tmpdir(), `takumi-eval-${task.id}-`));
	const toolsUsed: string[] = [];
	const failedAssertions: string[] = [];
	let costUsd = 0;

	try {
		// Run setup commands in the workspace
		if (task.setup) {
			const { execSync } = await import("node:child_process");
			for (const cmd of task.setup) {
				execSync(cmd, { cwd: workspace, shell: "/bin/sh" });
			}
		}

		// Dynamic import to avoid circular deps at module-load time
		const { ToolRegistry, registerBuiltinTools, agentLoop, buildContext } = await import("@takumi/agent");
		const { loadConfig } = await import("@takumi/core");
		const { createProvider } = await import("../bin/cli/provider.js");

		const config = { ...(await loadConfig(workspace)), model, workingDirectory: workspace };
		const provider = await createProvider(config);
		const tools = new ToolRegistry();
		registerBuiltinTools(tools);
		const system = await buildContext({ cwd: workspace, tools: tools.getDefinitions() });

		const loop = agentLoop(task.prompt, [], {
			sendMessage: (msgs: any, sys: any, defs: any, sig: any, opts: any) =>
				provider.sendMessage(msgs, sys, defs, sig, opts),
			tools,
			systemPrompt: system,
			maxTurns: 20,
		});

		for await (const event of loop) {
			if (event.type === "tool_use") toolsUsed.push(event.name);
			if (event.type === "usage_update") {
				const { estimateCost } = await import("@takumi/agent");
				costUsd += estimateCost(event.usage.inputTokens, event.usage.outputTokens, model);
			}
		}

		// Evaluate assertions
		const { existsSync, readFileSync } = await import("node:fs");
		for (const a of task.assertions) {
			switch (a.type) {
				case "file_exists": {
					const p = join(workspace, a.path);
					if (!existsSync(p)) failedAssertions.push(`file_exists: ${a.path} not found`);
					break;
				}
				case "file_contains": {
					const p = join(workspace, a.path);
					if (!existsSync(p)) { failedAssertions.push(`file_contains: ${a.path} not found`); break; }
					const src = readFileSync(p, "utf-8");
					const ok = typeof a.pattern === "string" ? src.includes(a.pattern) : a.pattern.test(src);
					if (!ok) failedAssertions.push(`file_contains: ${a.path} does not match ${a.pattern}`);
					break;
				}
				case "tool_used":
					if (!toolsUsed.includes(a.name)) failedAssertions.push(`tool_used: ${a.name} not called`);
					break;
				case "tool_not_used":
					if (toolsUsed.includes(a.name)) failedAssertions.push(`tool_not_used: ${a.name} was called`);
					break;
			}
		}

		return { task, passed: failedAssertions.length === 0, failedAssertions, toolsUsed, durationMs: Date.now() - start, costUsd };
	} catch (err) {
		return {
			task,
			passed: false,
			failedAssertions,
			toolsUsed,
			durationMs: Date.now() - start,
			costUsd,
			error: err instanceof Error ? err.message : String(err),
		};
	} finally {
		await rm(workspace, { recursive: true, force: true }).catch(() => {});
	}
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			task:  { type: "string"  },
			model: { type: "string"  },
			json:  { type: "boolean" },
		},
		strict: false,
	});

	const model = values.model as string ?? "claude-haiku-3-20240307";
	const tasks = values.task
		? GOLDEN_TASKS.filter((t) => t.id === values.task)
		: GOLDEN_TASKS;

	if (tasks.length === 0) {
		process.stderr.write(`No task matched: ${values.task}\n`);
		process.exit(1);
	}

	const results: TaskResult[] = [];
	for (const task of tasks) {
		process.stderr.write(`  Running: ${task.id} ... `);
		const r = await runTask(task, model);
		results.push(r);
		process.stderr.write(`${r.passed ? "PASS" : "FAIL"} (${r.durationMs}ms, $${r.costUsd.toFixed(4)})\n`);
	}

	const passed = results.filter((r) => r.passed).length;
	const total = results.length;

	if (values.json) {
		process.stdout.write(JSON.stringify({ passed, total, model, results }, null, 2) + "\n");
	} else {
		process.stdout.write(`\nResults: ${passed}/${total} passed\n`);
		for (const r of results.filter((r) => !r.passed)) {
			process.stdout.write(`  FAIL ${r.task.id}: ${r.failedAssertions.join("; ")}${r.error ? ` | error: ${r.error}` : ""}\n`);
		}
	}

	process.exit(passed === total ? 0 : 1);
}

main().catch((e) => { process.stderr.write(`${e}\n`); process.exit(1); });
