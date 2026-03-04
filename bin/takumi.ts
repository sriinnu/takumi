#!/usr/bin/env tsx

import { loadConfig } from "@takumi/core";
import type { TakumiConfig } from "@takumi/core";
import { parseArgs } from "./cli/args.js";
import { cmdAttach, cmdJobs, cmdStop, cmdWatch, startDetachedJob } from "./cli/detached-jobs.js";
import { printHelp } from "./cli/help.js";
import { fetchIssueContext, readStdin, runOneShot } from "./cli/one-shot.js";
import { buildSingleProvider, canSkipApiKey, createProvider } from "./cli/provider.js";
import { autoDetectAuth } from "./cli/cli-auth.js";
import { koshaProviderModels, koshaProviders } from "./cli/kosha-bridge.js";
import { cmdDelete, cmdExport, cmdList, cmdLogs, cmdStatus } from "./cli/session-commands.js";
import { cmdDaemon } from "./cli/daemon.js";
import { cmdDaemon } from "./cli/daemon.js";
import { printSplash } from "./cli/splash.js";

const VERSION = "0.1.0";

function hasProviderEnvKey(config: TakumiConfig): boolean {
	const env = process.env;
	return Boolean(
		(config.provider === "anthropic" && env.ANTHROPIC_API_KEY) ||
		(config.provider === "openai" && env.OPENAI_API_KEY) ||
		(config.provider === "gemini" && (env.GEMINI_API_KEY || env.GOOGLE_API_KEY)) ||
		(config.provider === "groq" && env.GROQ_API_KEY) ||
		(config.provider === "deepseek" && env.DEEPSEEK_API_KEY) ||
		(config.provider === "mistral" && env.MISTRAL_API_KEY) ||
		(config.provider === "together" && env.TOGETHER_API_KEY) ||
		(config.provider === "openrouter" && env.OPENROUTER_API_KEY) ||
		env.TAKUMI_API_KEY,
	);
}

async function chooseProviderAndModel(config: TakumiConfig): Promise<void> {
	const p = await import("@clack/prompts");
	const { PROVIDER_MODELS } = await import("@takumi/tui");

	p.intro("\x1b[1;36mTakumi AI Coding Agent\x1b[0m");

	// ── Build dynamic provider list from kosha-discovery ─────────────────────
	let dynamicProviders: Record<string, string[]> = {};
	try {
		dynamicProviders = await koshaProviderModels();
	} catch {
		// kosha unavailable — fall through to static list
	}

	// Merge kosha-discovered providers with static PROVIDER_MODELS (kosha wins)
	const allProviders = { ...PROVIDER_MODELS, ...dynamicProviders };

	// Build selection options — authenticated kosha providers first, then static
	let koshaProviderStatus: Array<{ id: string; name: string; authenticated: boolean }> = [];
	try {
		const kProviders = await koshaProviders();
		koshaProviderStatus = kProviders.map((kp) => ({
			id: mapKoshaToTakumi(kp.id),
			name: kp.name,
			authenticated: kp.authenticated || kp.id === "ollama",
		}));
	} catch {
		// fallback — no status info
	}

	const providerOptions = buildProviderOptions(allProviders, koshaProviderStatus);

	const providerChoice = await p.select({
		message: "Select AI Provider",
		options: providerOptions,
		initialValue: config.provider || "anthropic",
	});

	if (p.isCancel(providerChoice)) {
		p.outro("Cancelled.");
		process.exit(0);
	}

	const selectedProvider = providerChoice as string;
	const models = allProviders[selectedProvider] || [];

	let selectedModel = config.model;
	if (models.length > 0) {
		const modelChoice = await p.select({
			message: "Select Model",
			options: models.map((m: string) => ({ value: m, label: m })),
			initialValue: models.includes(config.model) ? config.model : models[0],
		});
		if (p.isCancel(modelChoice)) {
			p.outro("Cancelled.");
			process.exit(0);
		}
		selectedModel = modelChoice as string;
	} else {
		const modelInput = await p.text({ message: "Enter Model Name", initialValue: config.model });
		if (p.isCancel(modelInput)) {
			p.outro("Cancelled.");
			process.exit(0);
		}
		selectedModel = modelInput as string;
	}

	config.provider = selectedProvider;
	config.model = selectedModel;
	p.outro(`Starting with \x1b[32m${selectedProvider}\x1b[0m / \x1b[32m${selectedModel}\x1b[0m...`);
}

/** Map kosha provider IDs → Takumi provider names. */
function mapKoshaToTakumi(koshaId: string): string {
	const mapping: Record<string, string> = {
		anthropic: "anthropic",
		openai: "openai",
		google: "gemini",
		ollama: "ollama",
		openrouter: "openrouter",
		bedrock: "bedrock",
		vertex: "vertex",
	};
	return mapping[koshaId] ?? koshaId;
}

/** Provider display name map. */
const PROVIDER_LABELS: Record<string, string> = {
	anthropic: "Claude (Anthropic)",
	openai: "OpenAI (GPT / Codex / o-series)",
	gemini: "Google Gemini",
	github: "GitHub Models (free with gh CLI)",
	groq: "Groq (Fast Llama/Mixtral)",
	deepseek: "DeepSeek",
	mistral: "Mistral AI",
	together: "Together AI",
	openrouter: "OpenRouter",
	ollama: "Ollama (Local)",
	bedrock: "AWS Bedrock",
	vertex: "Google Vertex AI",
};

/** Build sorted provider selection options: authenticated first, then rest. */
function buildProviderOptions(
	allProviders: Record<string, string[]>,
	koshaStatus: Array<{ id: string; name: string; authenticated: boolean }>,
): Array<{ value: string; label: string; hint?: string }> {
	const statusMap = new Map(koshaStatus.map((s) => [s.id, s]));

	const authenticated: Array<{ value: string; label: string; hint?: string }> = [];
	const unauthenticated: Array<{ value: string; label: string; hint?: string }> = [];

	for (const provider of Object.keys(allProviders)) {
		const status = statusMap.get(provider);
		const label = PROVIDER_LABELS[provider] ?? provider;
		const hint = status?.authenticated
			? `✓ ${allProviders[provider].length} models`
			: undefined;

		const option = { value: provider, label, hint };

		if (status?.authenticated) {
			authenticated.push(option);
		} else {
			unauthenticated.push(option);
		}
	}

	return [...authenticated, ...unauthenticated];
}

function installFatalHandlers(): void {
	const cleanup = () => {
		process.stdout.write("\x1b[?1049l");
		process.stdout.write("\x1b[?25h");
		process.stdout.write("\x1b[?1000l\x1b[?1006l");
		process.stdout.write("\x1b[?2004l");
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
}

async function runInteractiveApp(config: TakumiConfig, args: ReturnType<typeof parseArgs>): Promise<void> {
	installFatalHandlers();

	// Show the colourful splash banner before entering the alternate screen
	printSplash(VERSION);
	if (!args.yes) {
		// Brief pause so the splash is visible before alt-screen takes over
		await new Promise((r) => setTimeout(r, 600));
	}

	const { TakumiApp } = await import("@takumi/tui");
	const { ToolRegistry, registerBuiltinTools, syncModelTiersFromKosha } = await import("@takumi/agent");

	// Sync model tiers from kosha-discovery (non-blocking, best-effort)
	koshaProviderModels()
		.then((pm) => syncModelTiersFromKosha(pm))
		.catch(() => {});

	const provider = await createProvider(config, args.fallback);
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
			const agentModule = await import("@takumi/agent");
			const newProvider = await buildSingleProvider(providerName, config, agentModule);
			if (!newProvider) return null;
			return (messages: any, system: any, toolDefs: any, signal: any, options: any) =>
				newProvider.sendMessage(messages, system, toolDefs, signal, options);
		},
	});

	await app.start();
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv);

	if (args.version) {
		console.log(`takumi v${VERSION}`);
		process.exit(0);
	}
	if (args.help) {
		printHelp(VERSION);
		process.exit(0);
	}

	if (args.subcommand) {
		switch (args.subcommand) {
			case "list":
				await cmdList();
				return;
			case "status":
				if (!args.subcommandArg) {
					console.error("Usage: takumi status <id>");
					process.exit(1);
				}
				await cmdStatus(args.subcommandArg);
				return;
			case "logs":
				if (!args.subcommandArg) {
					console.error("Usage: takumi logs <id>");
					process.exit(1);
				}
				await cmdLogs(args.subcommandArg);
				return;
			case "export":
				if (!args.subcommandArg) {
					console.error("Usage: takumi export <id>");
					process.exit(1);
				}
				await cmdExport(args.subcommandArg);
				return;
			case "delete":
				if (!args.subcommandArg) {
					console.error("Usage: takumi delete <id>");
					process.exit(1);
				}
				await cmdDelete(args.subcommandArg);
				return;
			case "jobs":
				await cmdJobs();
				return;
			case "watch":
				await cmdWatch(args.subcommandArg);
				return;
			case "attach":
				if (!args.subcommandArg) {
					console.error("Usage: takumi attach <job-id>");
					process.exit(1);
				}
				await cmdAttach(args.subcommandArg);
				return;
			case "stop":
				if (!args.subcommandArg) {
					console.error("Usage: takumi stop <job-id>");
					process.exit(1);
				}
				await cmdStop(args.subcommandArg);
				return;
			case "daemon":
				await cmdDaemon(args.subcommandArg ?? "status");
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

	const config = loadConfig(overrides);
	const prompt = args.prompt.join(" ");
	const isNonTTY = !process.stdin.isTTY;
	const isOneShot = prompt.length > 0 || args.print || isNonTTY;

	// ── Zero-config auth: try every source before showing any UI ─────────────
	// If the user explicitly passed --provider or --api-key we skip auto-detect
	// so their intent is respected. Otherwise we probe CLI credentials, env
	// vars, and a local Ollama instance — in that priority order.
	const alreadyAuthenticated = Boolean(
		config.apiKey || config.proxyUrl || canSkipApiKey(config) || hasProviderEnvKey(config),
	);
	if (!alreadyAuthenticated && !args.apiKey) {
		const detected = await autoDetectAuth();
		if (detected) {
			// Only override the provider if the user didn't explicitly pick one
			if (!args.provider) config.provider = detected.provider;
			config.apiKey = detected.apiKey;
			if (detected.model && !args.model) config.model = detected.model;
			if (!isOneShot) {
				process.stderr.write(`\x1b[2m⚡ Auto-detected: ${detected.source}\x1b[0m\n`);
			}
		}
	}

	// ── Provider/model selection UI — only if nothing was auto-detected ───────
	const readyToRun = Boolean(
		config.apiKey || config.proxyUrl || canSkipApiKey(config) || hasProviderEnvKey(config),
	);
	if (!isOneShot && !args.provider && !args.model && !args.resume && !args.yes && !readyToRun) {
		await chooseProviderAndModel(config);
	}

	// ── Hard fail if still nothing ───────────────────────────────────────────
	if (!config.apiKey && !config.proxyUrl && !canSkipApiKey(config) && !hasProviderEnvKey(config)) {
		console.error(
			"\nError: No API key found.\n\n" +
				"Takumi uses kosha-discovery to scan for credentials:\n" +
				"  • Claude CLI  (~/.claude/.credentials.json)\n" +
				"  • Gemini CLI  (~/.gemini/.env)\n" +
				"  • Codex CLI   (~/.codex/auth.json)\n" +
				"  • GitHub Copilot (~/.config/github-copilot/)\n" +
				"  • GitHub CLI  (gh auth token)\n" +
				"  • Ollama      (localhost:11434)\n" +
				"  • AWS Bedrock (~/.aws/credentials)\n" +
				"  • Env vars    (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY …)\n\n" +
				"Install any CLI, set an env var, or pass --api-key <key>.\n" +
				"Or use --proxy <url> to connect through a Darpana proxy.\n",
		);
		process.exit(1);
	}

	if (config.workingDirectory && config.workingDirectory !== process.cwd()) {
		process.chdir(config.workingDirectory);
	}

	if (args.detach && !process.env.TAKUMI_DETACHED) {
		await startDetachedJob();
	}

	let issueContext = "";
	const issueRef = args.issue ?? (args.prompt.length > 0
		? (() => {
				const combined = args.prompt.join(" ");
				const m = combined.match(/https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)|#(\d+)/);
				return m ? (m[1] ?? m[2] ?? "") : "";
			})()
		: "");
	if (issueRef) issueContext = await fetchIssueContext(issueRef);

	if (isOneShot) {
		let finalPrompt = prompt;
		if (!finalPrompt && isNonTTY) finalPrompt = await readStdin();
		if (!finalPrompt) {
			console.error("Error: No prompt provided. Pass a message as a positional argument or pipe to stdin.");
			process.exit(1);
		}
		await runOneShot(config, issueContext + finalPrompt, args.fallback, args.stream);
		return;
	}

	await runInteractiveApp(config, args);
}

main().catch((err) => {
	console.error(`Fatal error: ${err.message}`);
	process.exit(1);
});
