#!/usr/bin/env tsx
/**
 * Takumi CLI entry point.
 *
 * Usage:
 *   takumi                    Start interactive TUI
 *   takumi --model <model>    Use a specific model
 *   takumi --thinking         Enable extended thinking
 *   takumi --proxy <url>      Use Darpana proxy
 *   takumi --help             Show help
 *   takumi --version          Show version
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
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		help: false,
		version: false,
		thinking: false,
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
			default:
				if (arg.startsWith("-")) {
					console.error(`Unknown option: ${arg}`);
					process.exit(1);
				}
		}

		i++;
	}

	return args;
}

function printHelp(): void {
	console.log(`
Takumi v${VERSION} — Terminal UI for AI coding agents

Usage:
  takumi [options]

Options:
  -h, --help                Show this help message
  -v, --version             Show version number
  -m, --model <model>       AI model to use (default: claude-sonnet-4-20250514)
  -t, --thinking            Enable extended thinking
  --thinking-budget <n>     Thinking token budget (default: 10000)
  -p, --proxy <url>         Darpana proxy URL
  --theme <name>            UI theme (default: default)
  --log-level <level>       Log level: debug, info, warn, error, silent
  -C, --cwd <dir>           Working directory

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

main().catch((err) => {
	console.error(`Fatal error: ${err.message}`);
	process.exit(1);
});
