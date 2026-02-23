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
 *   takumi --provider <name>        Use a specific provider
 *   takumi --resume <id>             Resume a previous session
 *   takumi --help                   Show help
 *   takumi --version                Show version
 */

import { loadConfig, PROVIDER_ENDPOINTS } from "@takumi/core";
import type { TakumiConfig } from "@takumi/core";

const VERSION = "0.1.0";

interface CliArgs {
	help: boolean;
	version: boolean;
	model?: string;
	thinking: boolean;
	thinkingBudget?: number;
	proxy?: string;
	provider?: string;
	fallback?: string;   // --fallback <provider> for explicit failover
	apiKey?: string;
	endpoint?: string;
	theme?: string;
	logLevel?: string;
	workingDirectory?: string;
	prompt: string[];  // positional args collected
	print: boolean;    // --print flag for non-interactive output
	resume?: string;   // --resume <id> to restore a previous session
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
			case "--provider":
			case "-P":
				args.provider = argv[++i];
				break;
			case "--api-key":
				args.apiKey = argv[++i];
				break;
			case "--endpoint":
				args.endpoint = argv[++i];
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
			case "--resume":
			case "-r":
				args.resume = argv[++i];
				break;
			case "--fallback":
				args.fallback = argv[++i];
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
  -P, --provider <name>     Provider name (see below)
  --api-key <key>           API key (overrides environment)
  --endpoint <url>          Custom API endpoint URL
  -t, --thinking            Enable extended thinking
  --thinking-budget <n>     Thinking token budget (default: 10000)
  -p, --proxy <url>         Darpana proxy URL
  --print                   Non-interactive mode: stream output to stdout
  --theme <name>            UI theme (default: default)
  --log-level <level>       Log level: debug, info, warn, error, silent
  -C, --cwd <dir>           Working directory
  -r, --resume <id>         Resume a previous session by ID
  --fallback <provider>     Fallback provider on primary failure

Providers:
  anthropic (default)    Direct Anthropic API
  openai                 OpenAI (GPT-4.1, etc.)
  gemini                 Google Gemini
  groq                   Groq (fast inference)
  deepseek               DeepSeek
  mistral                Mistral AI
  together               Together AI
  openrouter             OpenRouter (multi-provider)
  ollama                 Local Ollama (no key needed)

One-Shot Mode:
  Providing a positional prompt, using --print, or piping to stdin
  will bypass the TUI and run the agent directly, streaming output
  to stdout. Tool calls are logged to stderr as [tool: name] lines.

Environment Variables:
  ANTHROPIC_API_KEY          Anthropic API key
  OPENAI_API_KEY             OpenAI API key (auto-sets provider=openai)
  GEMINI_API_KEY             Gemini API key (auto-sets provider=gemini)
  GOOGLE_API_KEY             Google API key (auto-sets provider=gemini)
  GROQ_API_KEY               Groq API key (auto-sets provider=groq)
  DEEPSEEK_API_KEY           DeepSeek API key (auto-sets provider=deepseek)
  MISTRAL_API_KEY            Mistral API key (auto-sets provider=mistral)
  TOGETHER_API_KEY           Together API key (auto-sets provider=together)
  OPENROUTER_API_KEY         OpenRouter API key (auto-sets provider=openrouter)
  TAKUMI_API_KEY             Override API key (highest priority)
  TAKUMI_PROVIDER            Explicit provider override
  TAKUMI_ENDPOINT            Explicit endpoint override
  TAKUMI_MODEL               Default model
  TAKUMI_PROXY_URL           Darpana proxy URL
  TAKUMI_THINKING            Enable thinking (true/false)

Config Files (first found wins):
  .takumi/config.json        Project-local config
  takumi.config.json         Project root config
  ~/.takumi/config.json      User config
  ~/.config/takumi/config.json  XDG config

Examples:
  ANTHROPIC_API_KEY=... pnpm takumi
  OPENAI_API_KEY=... pnpm takumi --provider openai --model gpt-4.1
  GROQ_API_KEY=... pnpm takumi -P groq -m llama-3.3-70b
  pnpm takumi -P ollama -m llama3
  pnpm takumi --endpoint http://localhost:8080/v1/chat/completions --api-key test
  pnpm takumi -P openai --fallback anthropic    # Failover: try openai first, fall back to anthropic
`);
}

/**
 * Check whether the given provider/endpoint combination can skip API key auth.
 * Ollama and local endpoints (localhost / 127.0.0.1) don't require keys.
 */
function canSkipApiKey(config: TakumiConfig): boolean {
	if (config.provider === "ollama") return true;
	if (config.endpoint) {
		try {
			const url = new URL(config.endpoint);
			if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
		} catch {
			// invalid URL, don't skip
		}
	}
	return false;
}

/**
 * Build a single provider instance for the given provider name and config.
 * Returns null if the provider cannot be instantiated (e.g., missing key).
 */
async function buildSingleProvider(
	providerName: string,
	config: TakumiConfig,
	agent: any,
): Promise<any | null> {
	const env = process.env;

	if (providerName === "anthropic") {
		const key = config.apiKey || env.ANTHROPIC_API_KEY || env.TAKUMI_API_KEY;
		if (!key) return null;
		return new agent.DirectProvider({ ...config, apiKey: key });
	}

	if (providerName === "gemini") {
		const key = config.apiKey || env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.TAKUMI_API_KEY;
		if (!key) return null;
		return new agent.GeminiProvider({
			...config,
			apiKey: key,
			endpoint: config.endpoint || PROVIDER_ENDPOINTS[providerName] || "",
		});
	}

	// OpenAI-compatible providers
	const keyMap: Record<string, string> = {
		openai: "OPENAI_API_KEY",
		groq: "GROQ_API_KEY",
		deepseek: "DEEPSEEK_API_KEY",
		mistral: "MISTRAL_API_KEY",
		together: "TOGETHER_API_KEY",
		openrouter: "OPENROUTER_API_KEY",
		ollama: "", // no key needed
	};

	const envVar = keyMap[providerName];
	const key = config.apiKey || (envVar ? env[envVar] : undefined) || env.TAKUMI_API_KEY;

	// Ollama doesn't need a key
	if (!key && providerName !== "ollama") return null;

	return new agent.OpenAIProvider({
		...config,
		apiKey: key || "",
		endpoint: config.endpoint || PROVIDER_ENDPOINTS[providerName] || "",
	});
}

/**
 * Create the appropriate provider for the given config.
 * Uses dynamic imports so missing provider modules don't crash at startup.
 *
 * When a --fallback provider is specified, wraps providers in a FailoverProvider
 * so the primary is tried first, falling back to the secondary on failure.
 */
async function createProvider(config: TakumiConfig, fallbackName?: string): Promise<any> {
	const agent = await import("@takumi/agent");

	// Priority: --proxy > failover > single provider
	if (config.proxyUrl) {
		return new agent.DarpanaProvider(config);
	}

	// If --fallback is specified, build a FailoverProvider
	if (fallbackName) {
		const primaryName = config.provider || "anthropic";
		const primary = await buildSingleProvider(primaryName, config, agent);
		const fallback = await buildSingleProvider(fallbackName, config, agent);

		if (!primary) {
			throw new Error(`Cannot create primary provider "${primaryName}": missing API key or config.`);
		}
		if (!fallback) {
			throw new Error(`Cannot create fallback provider "${fallbackName}": missing API key or config.`);
		}

		return new agent.FailoverProvider({
			providers: [
				{ name: primaryName, provider: primary, priority: 0 },
				{ name: fallbackName, provider: fallback, priority: 1 },
			],
			onSwitch: (from: string, to: string, reason: string) => {
				process.stderr.write(
					`\x1b[33m[failover]\x1b[0m Switching from ${from} to ${to}: ${reason}\n`,
				);
			},
		});
	}

	// Single provider path (original behavior)
	if (config.provider === "anthropic" || !config.provider) {
		return new agent.DirectProvider(config);
	}

	if (config.provider === "gemini") {
		try {
			const { GeminiProvider } = await import("@takumi/agent");
			return new GeminiProvider({
				...config,
				endpoint: config.endpoint || PROVIDER_ENDPOINTS[config.provider] || "",
			});
		} catch {
			throw new Error(
				`GeminiProvider is not yet available. Install or build @takumi/agent with Gemini support.`,
			);
		}
	}

	// openai, groq, deepseek, mistral, together, openrouter, ollama, custom
	try {
		const { OpenAIProvider } = await import("@takumi/agent");
		return new OpenAIProvider({
			...config,
			endpoint: config.endpoint || PROVIDER_ENDPOINTS[config.provider] || config.endpoint,
		});
	} catch {
		throw new Error(
			`OpenAIProvider is not yet available for provider "${config.provider}". ` +
			`Install or build @takumi/agent with OpenAI-compatible support.`,
		);
	}
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
	if (args.provider) overrides.provider = args.provider;
	if (args.apiKey) overrides.apiKey = args.apiKey;
	if (args.endpoint) overrides.endpoint = args.endpoint;
	if (args.theme) overrides.theme = args.theme;
	if (args.logLevel) overrides.logLevel = args.logLevel as TakumiConfig["logLevel"];
	if (args.workingDirectory) overrides.workingDirectory = args.workingDirectory;

	// Load merged config
	const config = loadConfig(overrides);

	// Check for API key (skip for ollama / local endpoints)
	if (!config.apiKey && !config.proxyUrl && !canSkipApiKey(config)) {
		console.error(
			"Error: No API key configured.\n\n" +
			"Set an API key environment variable for your provider:\n" +
			"  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, etc.\n\n" +
			"Or pass --api-key <key> on the command line.\n" +
			"Or configure apiKey in:\n" +
			"  .takumi/config.json\n" +
			"  ~/.takumi/config.json\n\n" +
			"Or use --proxy to connect through Darpana.\n" +
			"Or use --provider ollama for local models (no key needed).",
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
		await runOneShot(config, finalPrompt, args.fallback);
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
	const { ToolRegistry, registerBuiltinTools } = await import("@takumi/agent");

	// Set up provider (with optional failover)
	const provider = await createProvider(config, args.fallback);

	// Set up tools
	const tools = new ToolRegistry();
	registerBuiltinTools(tools);

	const app = new TakumiApp({
		config,
		sendMessage: (messages: any, system: any, toolDefs: any, signal: any, options: any) =>
			provider.sendMessage(messages, system, toolDefs, signal, options),
		tools,
		resumeSessionId: args.resume,
		providerFactory: async (providerName: string) => {
			// Lazily import @takumi/agent so this works without touching createProvider()
			const agentModule = await import("@takumi/agent");
			const newProvider = await buildSingleProvider(providerName, config, agentModule);
			if (!newProvider) return null;
			return (messages: any, system: any, toolDefs: any, signal: any, options: any) =>
				newProvider.sendMessage(messages, system, toolDefs, signal, options);
		},
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
async function runOneShot(config: TakumiConfig, prompt: string, fallbackName?: string): Promise<void> {
	const { ToolRegistry, registerBuiltinTools, agentLoop, buildContext } = await import("@takumi/agent");

	const provider = await createProvider(config, fallbackName);

	const tools = new ToolRegistry();
	registerBuiltinTools(tools);

	const system = await buildContext({
		cwd: process.cwd(),
		tools: tools.getDefinitions(),
		customPrompt: config.systemPrompt || undefined,
	});

	const loop = agentLoop(prompt, [], {
		sendMessage: (messages: any, sys: any, toolDefs: any, signal: any, options: any) =>
			provider.sendMessage(messages, sys, toolDefs, signal, options),
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
