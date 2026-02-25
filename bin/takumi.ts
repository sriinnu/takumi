#!/usr/bin/env tsx

import { loadConfig } from "@takumi/core";
import type { TakumiConfig } from "@takumi/core";
import { parseArgs } from "./cli/args.js";
import { cmdAttach, cmdJobs, cmdStop, cmdWatch, startDetachedJob } from "./cli/detached-jobs.js";
import { printHelp } from "./cli/help.js";
import { fetchIssueContext, readStdin, runOneShot } from "./cli/one-shot.js";
import { buildSingleProvider, canSkipApiKey, createProvider } from "./cli/provider.js";
import { cmdDelete, cmdExport, cmdList, cmdLogs, cmdStatus } from "./cli/session-commands.js";

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

	const providerChoice = await p.select({
		message: "Select AI Provider",
		options: [
			{ value: "anthropic", label: "Claude (Anthropic)" },
			{ value: "openai", label: "OpenAI (GPT / Codex / o-series)" },
			{ value: "gemini", label: "Google Gemini" },
			{ value: "groq", label: "Groq (Fast Llama/Mixtral)" },
			{ value: "deepseek", label: "DeepSeek" },
			{ value: "mistral", label: "Mistral AI" },
			{ value: "together", label: "Together AI" },
			{ value: "openrouter", label: "OpenRouter" },
			{ value: "ollama", label: "Ollama (Local)" },
		],
		initialValue: config.provider || "anthropic",
	});

	if (p.isCancel(providerChoice)) {
		p.outro("Cancelled.");
		process.exit(0);
	}

	const selectedProvider = providerChoice as string;
	const models = PROVIDER_MODELS[selectedProvider] || [];

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

	const { TakumiApp } = await import("@takumi/tui");
	const { ToolRegistry, registerBuiltinTools } = await import("@takumi/agent");

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

	if (!isOneShot && !args.provider && !args.model && !args.resume && !args.yes) {
		await chooseProviderAndModel(config);
	}

	if (!config.apiKey && !config.proxyUrl && !canSkipApiKey(config) && !hasProviderEnvKey(config)) {
		console.error(
			`\nError: No API key configured for provider '${config.provider}'.\n\n` +
				"Set an API key environment variable for your provider:\n" +
				"  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, etc.\n\n" +
				"Or pass --api-key <key> on the command line.\n" +
				"Or configure apiKey in:\n" +
				"  .takumi/config.json\n" +
				"  ~/.takumi/config.json\n\n" +
				"Or use --proxy to connect through Darpana.\n" +
				"Or use --provider ollama for local models (no key needed).\n",
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
		await runOneShot(config, issueContext + finalPrompt, args.fallback);
		return;
	}

	await runInteractiveApp(config, args);
}

main().catch((err) => {
	console.error(`Fatal error: ${err.message}`);
	process.exit(1);
});
