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
 *
 * Subcommands:
 *   takumi list                     List saved sessions
 *   takumi status <id>              Show session metadata
 *   takumi logs <id>                Print full conversation log
 *   takumi export <id>              Export session as Markdown (to stdout)
 *   takumi delete <id>              Delete a saved session
 *
 * Workflow flags:
 *   --pr                            Auto-create a GitHub PR on task completion
 *   --ship                          Auto-create + merge PR on task completion
 *   -d, --detach                    Run in background (detached process)
 *   --issue <url|number>            Pre-fetch GitHub issue as context
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
	// ── new in N-tasks ───────────────────────────────────────────────────────────
	subcommand?: string;    // list | status | logs | export | delete
	subcommandArg?: string; // first positional arg after subcommand
	pr: boolean;            // --pr: auto-create GitHub PR on completion
	ship: boolean;          // --ship: auto-create + merge PR on completion
	detach: boolean;        // -d / --detach: fork to background process
	issue?: string;         // --issue <url|#n>: fetch issue body as context
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		help: false,
		version: false,
		thinking: false,
		prompt: [],
		print: false,
		pr: false,
		ship: false,
		detach: false,
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
			case "--pr":
				args.pr = true;
				break;
			case "--ship":
				args.ship = true;
				args.pr = true;
				break;
			case "-d":
			case "--detach":
				args.detach = true;
				break;
			case "--issue":
			case "-i":
				args.issue = argv[++i];
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

	// Detect subcommand from first positional arg
	const SUBCOMMANDS = ["list", "status", "logs", "export", "delete"];
	if (args.prompt.length > 0 && SUBCOMMANDS.includes(args.prompt[0])) {
		args.subcommand = args.prompt.shift();
		args.subcommandArg = args.prompt.shift();
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

Subcommands:
  takumi list                List saved sessions
  takumi status <id>         Show session metadata and token usage
  takumi logs <id>           Print full conversation log (colour-coded)
  takumi export <id>         Export session as Markdown to stdout
  takumi delete <id>         Delete a saved session

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
  --pr                      Auto-create a GitHub PR when task completes
  --ship                    Auto-create + auto-merge PR when task completes
  -d, --detach              Run agent in background (detached process)
  -i, --issue <url|#n>      Pre-fetch GitHub issue body as task context

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
			const raw = config as unknown as Record<string, unknown>;
			return new GeminiProvider({
				apiKey: String(raw.apiKey ?? ""),
				model: String(raw.model ?? "gemini-1.5-flash"),
				maxTokens: Number(raw.maxTokens ?? 16384),
				thinking: Boolean(raw.thinking ?? false),
				thinkingBudget: Number(raw.thinkingBudget ?? 8000),
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Human-readable relative time (e.g. "3h ago"). */
function formatAge(ts: number): string {
	const diff = Date.now() - ts;
	const mins = Math.floor(diff / 60_000);
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	return `${Math.floor(hrs / 24)}d ago`;
}

// ── Subcommand handlers ───────────────────────────────────────────────────────

async function cmdList(): Promise<void> {
	const { listSessions } = await import("@takumi/core");
	const sessions = await listSessions(50);
	if (sessions.length === 0) {
		console.log("No sessions found.");
		return;
	}
	console.log(`\nSessions (${sessions.length}):\n`);
	for (const s of sessions) {
		const date = new Date(s.updatedAt).toLocaleString();
		console.log(`  \x1b[1;36m${s.id}\x1b[0m`);
		console.log(`    Title:    ${s.title || "(untitled)"}`);
		console.log(`    Model:    ${s.model}`);
		console.log(`    Messages: ${s.messageCount}`);
		console.log(`    Updated:  ${date} (${formatAge(s.updatedAt)})`);
		console.log();
	}
}

async function cmdStatus(id: string): Promise<void> {
	const { loadSession } = await import("@takumi/core");
	const session = await loadSession(id);
	if (!session) {
		console.error(`Session not found: ${id}`);
		process.exit(1);
	}
	console.log(`\n\x1b[1mSession:\x1b[0m ${session.id}`);
	console.log(`  Title:         ${session.title || "(untitled)"}`);
	console.log(`  Model:         ${session.model}`);
	console.log(`  Created:       ${new Date(session.createdAt).toLocaleString()}`);
	console.log(`  Updated:       ${new Date(session.updatedAt).toLocaleString()}`);
	console.log(`  Messages:      ${session.messages.length}`);
	console.log(`  Input tokens:  ${session.tokenUsage.inputTokens.toLocaleString()}`);
	console.log(`  Output tokens: ${session.tokenUsage.outputTokens.toLocaleString()}`);
	console.log(`  Est. cost:     $${session.tokenUsage.totalCost.toFixed(4)}`);
	console.log();
}

async function cmdLogs(id: string): Promise<void> {
	const { loadSession } = await import("@takumi/core");
	const session = await loadSession(id);
	if (!session) {
		console.error(`Session not found: ${id}`);
		process.exit(1);
	}
	console.log(`\n── Session: \x1b[1m${session.id}\x1b[0m ──\n`);
	for (const msg of session.messages) {
		const roleLabel =
			msg.role === "user"
				? "\x1b[1;34m[user]\x1b[0m"
				: msg.role === "assistant"
					? "\x1b[1;32m[assistant]\x1b[0m"
					: `\x1b[1;33m[${msg.role}]\x1b[0m`;
		console.log(roleLabel);
		const content = msg.content as any;
		if (Array.isArray(content)) {
			for (const block of content) {
				if (block.type === "text") {
					console.log(block.text);
				} else if (block.type === "tool_use") {
					console.log(`  \x1b[2m[tool: ${block.name}]\x1b[0m`);
				} else if (block.type === "tool_result") {
					const raw = Array.isArray(block.content) ? (block.content[0]?.text ?? "") : String(block.content ?? "");
					console.log(`  \x1b[2m[result: ${raw.slice(0, 200)}]\x1b[0m`);
				}
			}
		} else {
			console.log(content);
		}
		console.log();
	}
}

async function cmdExport(id: string): Promise<void> {
	const { loadSession } = await import("@takumi/core");
	const session = await loadSession(id);
	if (!session) {
		console.error(`Session not found: ${id}`);
		process.exit(1);
	}
	const lines: string[] = [
		`# ${session.title || "Takumi Session"}`,
		``,
		`**ID:** \`${session.id}\`  `,
		`**Model:** \`${session.model}\`  `,
		`**Created:** ${new Date(session.createdAt).toISOString()}  `,
		`**Updated:** ${new Date(session.updatedAt).toISOString()}  `,
		`**Messages:** ${session.messages.length}  `,
		``,
		`---`,
		``,
	];
	for (const msg of session.messages) {
		const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
		lines.push(`## ${role}`);
		lines.push(``);
		const content = msg.content as any;
		if (Array.isArray(content)) {
			for (const block of content) {
				if (block.type === "text") {
					lines.push(block.text);
				} else if (block.type === "tool_use") {
					lines.push(`\`\`\`tool:${block.name}`);
					lines.push(JSON.stringify(block.input, null, 2));
					lines.push("```");
				} else if (block.type === "tool_result") {
					const raw = Array.isArray(block.content) ? (block.content[0]?.text ?? "") : String(block.content ?? "");
					lines.push("```result");
					lines.push(raw);
					lines.push("```");
				}
			}
		} else {
			lines.push(String(content ?? ""));
		}
		lines.push(``);
	}
	process.stdout.write(lines.join("\n"));
	process.stdout.write("\n");
}

async function cmdDelete(id: string): Promise<void> {
	const { deleteSession } = await import("@takumi/core");
	await deleteSession(id);
	console.log(`Deleted session: ${id}`);
}

/**
 * Fetch a GitHub issue's title + body via the `gh` CLI and return a
 * formatted context string to prepend to the user's prompt.
 */
async function fetchIssueContext(issueRef: string): Promise<string> {
	const { spawn } = await import("node:child_process");
	return new Promise((resolve) => {
		// Accept full URL or bare number / "#123"
		const ref = issueRef.replace(/^#/, "");
		const child = spawn("gh", ["issue", "view", ref, "--json", "title,body,url"], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let out = "";
		child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
		child.on("close", (code: number) => {
			if (code !== 0) {
				process.stderr.write(`[warning] Could not fetch issue "${issueRef}" — continuing without it.\n`);
				resolve("");
				return;
			}
			try {
				const { title, body, url } = JSON.parse(out);
				resolve(`GitHub Issue: ${title}\nURL: ${url}\n\n${body}\n\n---\n\n`);
			} catch {
				resolve("");
			}
		});
	});
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

	// ── Subcommand dispatch (no API key needed) ───────────────────────────────
	if (args.subcommand) {
		switch (args.subcommand) {
			case "list":
				await cmdList();
				return;
			case "status":
				if (!args.subcommandArg) { console.error("Usage: takumi status <id>"); process.exit(1); }
				await cmdStatus(args.subcommandArg);
				return;
			case "logs":
				if (!args.subcommandArg) { console.error("Usage: takumi logs <id>"); process.exit(1); }
				await cmdLogs(args.subcommandArg);
				return;
			case "export":
				if (!args.subcommandArg) { console.error("Usage: takumi export <id>"); process.exit(1); }
				await cmdExport(args.subcommandArg);
				return;
			case "delete":
				if (!args.subcommandArg) { console.error("Usage: takumi delete <id>"); process.exit(1); }
				await cmdDelete(args.subcommandArg);
				return;
		}
	}
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

	// ── Detach mode (N-4): fork to background when -d / --detach ─────────────
	if (args.detach && !process.env["TAKUMI_DETACHED"]) {
		const { mkdirSync, openSync, constants: fsConst } = await import("node:fs");
		const { join: pathJoin } = await import("node:path");
		const { homedir } = await import("node:os");
		const { spawn: spawnProc } = await import("node:child_process");
		const jobId = `job-${Date.now().toString(36)}`;
		const logsDir = pathJoin(homedir(), ".takumi", "logs");
		const jobsDir = pathJoin(homedir(), ".takumi", "jobs");
		mkdirSync(logsDir, { recursive: true });
		mkdirSync(jobsDir, { recursive: true });
		const logFile = pathJoin(logsDir, `${jobId}.log`);
		const logFd = openSync(logFile, fsConst.O_WRONLY | fsConst.O_CREAT | fsConst.O_TRUNC, 0o644);
		const child = spawnProc(process.execPath, process.argv.slice(1), {
			detached: true,
			stdio: ["ignore", logFd, logFd],
			env: { ...process.env, TAKUMI_DETACHED: "1" },
		});
		child.unref();
		const fs = await import("node:fs/promises");
		await fs.writeFile(pathJoin(jobsDir, `${jobId}.pid`), String(child.pid ?? ""), "utf-8");
		console.log(`[detached] job ${jobId}  pid=${child.pid}  log=${logFile}`);
		process.exit(0);
	}

	// ── Issue context pre-fetch (N-6) ─────────────────────────────────────────
	// Detect GitHub issue URLs or #<n> patterns in the prompt or --issue flag
	let issueContext = "";
	const issueRef = args.issue ?? (args.prompt.length > 0 ? (() => {
		const combined = args.prompt.join(" ");
		const m = combined.match(/https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)|#(\d+)/);
		return m ? (m[1] ?? m[2] ?? "") : "";
	})() : "");
	if (issueRef) {
		issueContext = await fetchIssueContext(issueRef);
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
		await runOneShot(config, issueContext + finalPrompt, args.fallback);
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
		autoPr: args.pr,
		autoShip: args.ship,
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
