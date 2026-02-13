#!/usr/bin/env tsx
/**
 * Takumi CLI entry point.
 *
 * Usage:
 *   takumi                          Start interactive TUI
 *   takumi "analyze this file"      One-shot mode (positional prompt)
 *   takumi --print "summarize"      Non-interactive output to stdout
 *   cat file | takumi               Piped input (non-TTY stdin)
 *   takumi --model <model>          Use a specific model
 *   takumi --thinking               Enable extended thinking
 *   takumi --proxy <url>            Use Darpana proxy
 *   takumi --help                   Show help
 *   takumi --version                Show version
 */

import { loadConfig } from "@takumi/core";
import type { TakumiConfig } from "@takumi/core";

const VERSION = "0.1.0";

interface CliArgs {
	help: boolean;
	version: boolean;
	model?: string;
	thinking: boolean;
	thinkingBudget?: number;
	proxy?: string;
	theme?: string;
	logLevel?: string;
	workingDirectory?: string;
	prompt: string[];  // positional args collected
	print: boolean;    // --print flag for non-interactive output
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		help: false,
		version: false,
		thinking: false,
		prompt: [],
		print: false,
	};

	let i = 2; // skip node and script path
	while (i < argv.length) {
		const arg = argv[i];

		switch (arg) {
			case "--help":
			case "-h":
				args.help = true;
				break;
			case "--version":
			case "-v":
				args.version = true;
				break;
			case "--model":
			case "-m":
				args.model = argv[++i];
				break;
			case "--thinking":
			case "-t":
				args.thinking = true;
				break;
			case "--thinking-budget":
				args.thinkingBudget = Number.parseInt(argv[++i], 10);
				break;
			case "--proxy":
			case "-p":
				args.proxy = argv[++i];
				break;
			case "--theme":
				args.theme = argv[++i];
				break;
			case "--log-level":
				args.logLevel = argv[++i];
				break;
			case "--cwd":
			case "-C":
				args.workingDirectory = argv[++i];
				break;
			case "--print":
				args.print = true;
				break;
			default:
				if (arg.startsWith("-")) {
					console.error(`Unknown option: ${arg}`);
					process.exit(1);
				}
				// Positional argument — collect as prompt
				args.prompt.push(arg);
		}

		i++;
	}

	return args;
}

function printHelp(): void {
	console.log(`
Takumi v${VERSION} — Terminal UI for AI coding agents

Usage:
  takumi [options] [prompt...]        Interactive TUI (default)
  takumi "analyze this file"          One-shot mode
  takumi --print "summarize code"     Non-interactive, stdout output
  cat file.ts | takumi "review this"  Piped input

Options:
  -h, --help                Show this help message
  -v, --version             Show version number
  -m, --model <model>       AI model to use (default: claude-sonnet-4-20250514)
  -t, --thinking            Enable extended thinking
  --thinking-budget <n>     Thinking token budget (default: 10000)
  -p, --proxy <url>         Darpana proxy URL
  --print                   Non-interactive mode: stream output to stdout
  --theme <name>            UI theme (default: default)
  --log-level <level>       Log level: debug, info, warn, error, silent
  -C, --cwd <dir>           Working directory

One-Shot Mode:
  Providing a positional prompt, using --print, or piping to stdin
  will bypass the TUI and run the agent directly, streaming output
  to stdout. Tool calls are logged to stderr as [tool: name] lines.

Environment Variables:
  ANTHROPIC_API_KEY          Anthropic API key
  TAKUMI_API_KEY             Override API key
  TAKUMI_MODEL               Default model
  TAKUMI_PROXY_URL           Darpana proxy URL
  TAKUMI_THINKING            Enable thinking (true/false)

Config Files (first found wins):
  .takumi/config.json        Project-local config
  takumi.config.json         Project root config
  ~/.takumi/config.json      User config
  ~/.config/takumi/config.json  XDG config
`);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv);

	if (args.version) {
		console.log(`takumi v${VERSION}`);
		process.exit(0);
	}

	if (args.help) {
		printHelp();
		process.exit(0);
	}

	// Build config overrides from CLI args
	const overrides: Partial<TakumiConfig> = {};
	if (args.model) overrides.model = args.model;
	if (args.thinking) overrides.thinking = true;
	if (args.thinkingBudget) overrides.thinkingBudget = args.thinkingBudget;
	if (args.proxy) overrides.proxyUrl = args.proxy;
	if (args.theme) overrides.theme = args.theme;
	if (args.logLevel) overrides.logLevel = args.logLevel as TakumiConfig["logLevel"];
	if (args.workingDirectory) overrides.workingDirectory = args.workingDirectory;

	// Load merged config
	const config = loadConfig(overrides);

	// Check for API key
	if (!config.apiKey && !config.proxyUrl) {
		console.error(
			"Error: No API key configured.\n\n" +
			"Set ANTHROPIC_API_KEY environment variable, or configure apiKey in:\n" +
			"  .takumi/config.json\n" +
			"  ~/.takumi/config.json\n\n" +
			"Or use --proxy to connect through Darpana.",
		);
		process.exit(1);
	}

	// Change working directory if specified
	if (config.workingDirectory && config.workingDirectory !== process.cwd()) {
		process.chdir(config.workingDirectory);
	}

	// Determine one-shot mode: positional args, --print flag, or non-TTY stdin
	const prompt = args.prompt.join(" ");
	const isNonTTY = !process.stdin.isTTY;
	const isOneShot = prompt.length > 0 || args.print || isNonTTY;

	if (isOneShot) {
		// In non-TTY mode with no prompt, read stdin as the prompt
		let finalPrompt = prompt;
		if (!finalPrompt && isNonTTY) {
			finalPrompt = await readStdin();
		}
		if (!finalPrompt) {
			console.error("Error: No prompt provided. Pass a message as a positional argument or pipe to stdin.");
			process.exit(1);
		}
		await runOneShot(config, finalPrompt);
		return;
	}

	// ── Interactive TUI mode ─────────────────────────────────────────────────

	// Set up SIGTERM handling
	const cleanup = () => {
		process.stdout.write("\x1b[?1049l"); // alt screen off
		process.stdout.write("\x1b[?25h");   // cursor show
		process.stdout.write("\x1b[?1000l\x1b[?1006l"); // mouse off
		process.stdout.write("\x1b[?2004l"); // bracketed paste off
		process.exit(0);
	};
	process.on("uncaughtException", (err) => {
		cleanup();
		console.error(`Fatal: ${err.message}`);
		process.exit(1);
	});
	process.on("unhandledRejection", (err) => {
		cleanup();
		console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	});

	// Dynamic imports to avoid loading heavy modules for --help/--version
	const { TakumiApp } = await import("@takumi/tui");
	const { DirectProvider, DarpanaProvider, ToolRegistry, registerBuiltinTools } = await import("@takumi/agent");

	// Set up provider
	const provider = config.proxyUrl
		? new DarpanaProvider(config)
		: new DirectProvider(config);

	// Set up tools
	const tools = new ToolRegistry();
	registerBuiltinTools(tools);

	const app = new TakumiApp({
		config,
		sendMessage: (messages, system, toolDefs) => provider.sendMessage(messages, system, toolDefs),
		tools,
	});
	await app.start();
}

/**
 * Read all of stdin as a string (for piped input).
 */
async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf-8").trim();
}

/**
 * Run a single prompt through the agent loop without the TUI.
 * Text output streams to stdout; tool calls log to stderr.
 */
async function runOneShot(config: TakumiConfig, prompt: string): Promise<void> {
	const { DirectProvider, DarpanaProvider, ToolRegistry, registerBuiltinTools, agentLoop, buildContext } = await import("@takumi/agent");

	const provider = config.proxyUrl
		? new DarpanaProvider(config)
		: new DirectProvider(config);

	const tools = new ToolRegistry();
	registerBuiltinTools(tools);

	const system = await buildContext({
		cwd: process.cwd(),
		tools: tools.getDefinitions(),
		customPrompt: config.systemPrompt || undefined,
	});

	const loop = agentLoop(prompt, [], {
		sendMessage: (messages, sys, toolDefs) => provider.sendMessage(messages, sys, toolDefs),
		tools,
		systemPrompt: system,
		maxTurns: config.maxTurns,
	});

	for await (const event of loop) {
		switch (event.type) {
			case "text_delta":
				process.stdout.write(event.text);
				break;
			case "tool_use":
				process.stderr.write(`\n[${event.name}] `);
				break;
			case "tool_result":
				if (event.isError) {
					process.stderr.write(`error: ${event.output.slice(0, 200)}\n`);
				} else {
					process.stderr.write(`done\n`);
				}
				break;
			case "error":
				process.stderr.write(`\nError: ${event.error.message}\n`);
				break;
		}
	}
	process.stdout.write("\n");
}

main().catch((err) => {
	console.error(`Fatal error: ${err.message}`);
	process.exit(1);
});
