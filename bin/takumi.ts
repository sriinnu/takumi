#!/usr/bin/env tsx

import { getConfiguredPluginPaths, loadConfig } from "@takumi/core";
import type { TakumiConfig } from "@takumi/core";
import { parseArgs } from "./cli/args.js";
import { cmdAttach, cmdJobs, cmdStop, cmdWatch, startDetachedJob } from "./cli/detached-jobs.js";
import { cmdDoctor } from "./cli/doctor.js";
import { installFatalHandlers } from "./cli/entry-runtime.js";
import { EXEC_EXIT_CODES, createExecRunId, createRunFailedEvent, emitExecEvent } from "./cli/exec-protocol.js";
import { printHelp } from "./cli/help.js";
import { cmdConfig } from "./cli/config.js";
import { cmdIde } from "./cli/ide.js";
import { cmdInit } from "./cli/init.js";
import { cmdKeybindings } from "./cli/keybindings.js";
import { fetchIssueContext, readStdin, runOneShot } from "./cli/one-shot.js";
import { cmdPlatform } from "./cli/platform.js";
import { confirmDegradedLocalMode } from "./cli/degraded-local-mode.js";
import {
	buildSingleProvider,
	isProviderConfigurationError,
	isRouteIncompatibleError,
	rebaseProviderConfig,
} from "./cli/provider.js";
import {
	formatRouteIncompatibleFailureMessage,
	formatStartupAccessFailureMessage,
} from "./cli/route-failure.js";
import { shouldTraceStartup, StartupTrace } from "./cli/startup-trace.js";
import { cmdDelete, cmdExport, cmdList, cmdLogs, cmdStatus } from "./cli/session-commands.js";
import { cmdDaemon } from "./cli/daemon.js";
import { printSplash } from "./cli/splash.js";
import { cmdPackage } from "./cli/packages.js";
import { bootstrapInteractiveContract } from "./cli/interactive-contract-bootstrap.js";
import { resolveInteractiveProviderWithOnboarding } from "./cli/interactive-provider-onboarding.js";
import { collectRuntimeBootstrap } from "./cli/runtime-bootstrap.js";
import { cmdSideAgents } from "./cli/side-agents.js";
import { describeStartupAuthSource } from "./cli/startup-auth-source.js";

const VERSION = "0.1.0";

/**
 * Start the interactive app after runtime/bootstrap truth is collected, so the
 * TUI sees the same routed provider/session state as headless execution.
 */
async function runInteractiveApp(
	config: TakumiConfig,
	args: ReturnType<typeof parseArgs>,
	startupAuthSource: string,
	startupTrace: StartupTrace,
): Promise<void> {
	installFatalHandlers();

	// Show the colourful splash banner before entering the alternate screen
	printSplash(VERSION);

	const { PROVIDER_MODELS, TakumiApp, mapBootstrapLanesToSessionState } = await import("@takumi/tui");
	const {
		buildPackageDoctorReport,
		buildPackageInspection,
		buildPackageRuntimeSnapshot,
		discoverAndLoadExtensionsFromSnapshot,
		ExtensionRunner,
		loadConventionFilesFromSnapshot,
		ToolRegistry,
		registerBuiltinTools,
		syncModelTiersFromKosha,
	} = await import("@takumi/agent");

	let availableProviderModels = { ...PROVIDER_MODELS };
	const cwd = process.cwd();
	const tools = new ToolRegistry();
	registerBuiltinTools(tools);

	// Phase 45 — Build one shared package snapshot for startup consumers
	const configuredPaths = getConfiguredPluginPaths(config.plugins);
	const [runtimeBootstrap, packageSnapshot] = await Promise.all([
		startupTrace.measure("runtime.bootstrap", () =>
			collectRuntimeBootstrap(config, {
				cwd,
				tools,
				enableChitraguptaBootstrap: true,
				includeProviderStatus: true,
				bootstrapMode: "interactive",
				consumer: "takumi",
				capability: "coding.patch-cheap",
			}),
		),
		startupTrace.measure("packages.snapshot", () => buildPackageRuntimeSnapshot(config, cwd)),
	]);
	const packageInspection = buildPackageInspection(packageSnapshot.report);
	const packageDoctorReport = buildPackageDoctorReport(packageInspection);
	const bootstrapBridge = runtimeBootstrap.chitragupta?.bridge ?? null;

	try {
		if (runtimeBootstrap.degradedLocalMode?.requiresOperatorConsent && !args.yes) {
			const accepted = await confirmDegradedLocalMode(runtimeBootstrap.degradedLocalMode);
			if (!accepted) return;
		}

		const interactiveBootstrap = await startupTrace.measure("chitragupta.interactive", () =>
			bootstrapInteractiveContract(config, runtimeBootstrap.chitragupta, { cwd }),
		);
		const providerResolution = await startupTrace.measure("provider.create", () =>
			resolveInteractiveProviderWithOnboarding(config, {
				fallbackName: args.fallback,
				preferredProvider: interactiveBootstrap.preferredProvider,
				preferredModel: interactiveBootstrap.preferredModel,
				strictPreferredRoute: interactiveBootstrap.strictPreferredRoute,
				bootstrapBridge: bootstrapBridge ?? undefined,
				providerModels: availableProviderModels,
				providerStatuses: runtimeBootstrap.providerStatuses,
				allowOnboarding: process.stdin.isTTY && process.stdout.isTTY && !args.yes,
			}),
		);
		const provider = providerResolution.provider;
		const resolvedConfig = providerResolution.resolvedConfig;
		const localModels = runtimeBootstrap.providerStatuses.find((provider) => provider.id === "ollama")?.models.slice(0, 4) ?? [];
		syncModelTiersFromKosha(availableProviderModels);
		const startupTraceLines = startupTrace.formatLines("Startup handoff");
		const startupNotes = [
			...runtimeBootstrap.warningLines,
			...interactiveBootstrap.warnings,
			...providerResolution.warnings,
			...startupTraceLines,
		]
			.filter(Boolean)
			.join("\n");
		const effectiveSource =
			providerResolution.source === "configured provider" ? startupAuthSource : providerResolution.source;
		const requestedModel =
			providerResolution.startupModelSelection ||
			config.provider !== resolvedConfig.provider ||
			config.model !== resolvedConfig.model
				? {
					provider: providerResolution.startupModelSelection?.requestedProvider ?? config.provider,
					model: providerResolution.startupModelSelection?.requestedModel ?? config.model,
					allow: providerResolution.startupModelSelection?.allow,
					prefer: providerResolution.startupModelSelection?.prefer,
				}
				: undefined;
		const startupRouteAuthority: "engine" | "takumi-fallback" = interactiveBootstrap.strictPreferredRoute
			? "engine"
			: "takumi-fallback";
		const startupRouteSummary = interactiveBootstrap.primaryLane?.routingDecision
			? {
					capability: interactiveBootstrap.primaryLane.routingDecision.capability ?? "coding.patch-cheap",
					selectedCapabilityId: interactiveBootstrap.primaryLane.routingDecision.selectedCapabilityId ?? undefined,
					preferredProvider: interactiveBootstrap.preferredProvider,
					preferredModel: interactiveBootstrap.preferredModel,
					authority: startupRouteAuthority,
					degraded: interactiveBootstrap.primaryLane.routingDecision.degraded,
				}
			: interactiveBootstrap.routingDecision
				? {
						capability: interactiveBootstrap.routingDecision.request.capability,
						selectedCapabilityId: interactiveBootstrap.routingDecision.selected?.id,
						preferredProvider: interactiveBootstrap.preferredProvider,
						preferredModel: interactiveBootstrap.preferredModel,
						authority: startupRouteAuthority,
						degraded: interactiveBootstrap.routingDecision.degraded,
					}
				: undefined;
			const extResult = await startupTrace.measure("extensions.discover", () =>
				discoverAndLoadExtensionsFromSnapshot(packageSnapshot, configuredPaths, cwd),
			);
		const extensionRunner = extResult.extensions.length > 0 ? new ExtensionRunner(extResult.extensions) : undefined;
			if (packageDoctorReport.degraded > 0 || packageDoctorReport.rejected > 0) {
				process.stderr.write(
					`\x1b[33m⚠ Packages: ${packageDoctorReport.ready} ready · ${packageDoctorReport.degraded} degraded · ${packageDoctorReport.rejected} rejected\x1b[0m\n`,
				);
				if (packageDoctorReport.degraded > 0) {
					process.stderr.write("\x1b[2mℹ Run `takumi package doctor` for package diagnostics.\x1b[0m\n");
				}
			}
			for (const err of packageDoctorReport.rejectedEntries) {
				process.stderr.write(`\x1b[33m⚠ Package discovery error (${err.path}): ${err.error}\x1b[0m\n`);
			}
		if (extResult.extensions.length > 0) {
			process.stderr.write(`\x1b[2m⚡ Loaded ${extResult.extensions.length} extension(s)\x1b[0m\n`);
		}
		for (const err of extResult.errors) {
			process.stderr.write(`\x1b[33m⚠ Extension error (${err.path}): ${err.error}\x1b[0m\n`);
		}

		// Phase 45 — Load convention files (.takumi/system-prompt.md, .takumi/tool-rules.json)
		const conventionFiles = loadConventionFilesFromSnapshot(packageSnapshot, cwd);
		if (conventionFiles.loadedFiles.length > 0) {
			process.stderr.write(`\x1b[2m⚡ Loaded ${conventionFiles.loadedFiles.length} convention file(s)\x1b[0m\n`);
		}

		const app = new TakumiApp({
			config: resolvedConfig,
			startupSummary: {
				provider: resolvedConfig.provider,
				model: resolvedConfig.model,
				source: effectiveSource,
				requestedModel,
				resolvedIntent: providerResolution.startupModelSelection?.resolvedIntent,
				resolvedVersion: providerResolution.startupModelSelection?.resolvedVersion,
				sideAgents: startupNotes || undefined,
				localModels,
				availableProviderModels,
				canonicalSessionId: interactiveBootstrap.canonicalSessionId,
				startupRoute: startupRouteSummary,
			},
			startupControlPlane: {
				canonicalSessionId: interactiveBootstrap.canonicalSessionId,
				memoryContext: runtimeBootstrap.chitragupta?.memoryContext,
				tendencies: runtimeBootstrap.chitragupta?.tendencies,
				health: runtimeBootstrap.chitragupta?.health,
				routingDecision: interactiveBootstrap.routingDecision,
				startupLanes: mapBootstrapLanesToSessionState(interactiveBootstrap.startupLanes),
			},
			sendMessage: (messages: any, system: any, toolDefs: any, signal: any, options: any) =>
				provider.sendMessage(messages, system, toolDefs, signal, options),
			tools,
			resumeSessionId: args.resume,
			autoPr: args.pr,
			autoShip: args.ship,
			extensionRunner,
			conventionFiles,
			providerFactory: async (providerName: string) => {
				const agentModule = await import("@takumi/agent");
				const providerConfig = rebaseProviderConfig(resolvedConfig, providerName);
				const newProvider = await buildSingleProvider(providerName, providerConfig, agentModule, bootstrapBridge ?? undefined).catch(
					() => null,
				);
				if (!newProvider) return null;
				return (messages: any, system: any, toolDefs: any, signal: any, options: any) =>
					newProvider.sendMessage(messages, system, toolDefs, signal, options);
			},
		});

		await app.start();
	} finally {
		if (bootstrapBridge?.isConnected) {
			await bootstrapBridge.disconnect().catch(() => undefined);
		}
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv);
	const isExecMode = args.subcommand === "exec";
	const execRunId = isExecMode || args.headless ? createExecRunId() : undefined;
	const startupTrace = new StartupTrace(shouldTraceStartup(Boolean(args.startupTrace)));

	if (args.invalidStream) {
		console.error(`Error: Unsupported stream format \"${args.invalidStream}\". Use \"text\" or \"ndjson\".`);
		process.exit(EXEC_EXIT_CODES.USAGE);
	}

	if (args.version) {
		console.log(`takumi v${VERSION}`);
		process.exit(0);
	}
	if (args.help) {
		printHelp(VERSION);
		process.exit(0);
	}

	if (args.workingDirectory) {
		process.chdir(args.workingDirectory);
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
	config.experimental = {
		...config.experimental,
		takumiExplicitApiKey: Boolean(args.apiKey),
		takumiExplicitEndpoint: Boolean(args.endpoint),
		takumiExplicitProxy: Boolean(args.proxy),
	};
	if (config.workingDirectory && process.cwd() !== config.workingDirectory) {
		process.chdir(config.workingDirectory);
	}

	if (args.subcommand) {
		switch (args.subcommand) {
			case "exec":
				break;
			case "list":
				await cmdList(args.json);
				return;
			case "status":
				if (!args.subcommandArg) {
					console.error("Usage: takumi status <id>");
					process.exit(1);
				}
				await cmdStatus(args.subcommandArg, args.json);
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
				await cmdJobs(args.json);
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
				await cmdDaemon(args.subcommandArg ?? "status", args.json);
				return;
			case "doctor":
				await cmdDoctor(config, VERSION, args.json, args.fix);
				return;
			case "platform":
				await cmdPlatform(config, VERSION, args.json, args.fix, args.subcommandArg);
				return;
			case "init":
				await cmdInit(args.subcommandArg ?? "open");
				return;
			case "config":
				await cmdConfig(args.subcommandArg ?? "open");
				return;
			case "ide":
				await cmdIde(args.subcommandArg ?? "status", args.prompt, args.json);
				return;
			case "package":
				await cmdPackage(config, args.subcommandArg ?? "list", args.prompt, args.json);
				return;
			case "side-agents":
				try {
					await cmdSideAgents(config, args.subcommandArg ?? "inspect", args.json);
				} catch (error) {
					console.error(error instanceof Error ? error.message : String(error));
					process.exit(1);
				}
				return;
			case "keybindings":
				await cmdKeybindings(args.subcommandArg ?? "open");
				return;
			}
		}
	const prompt = args.prompt.join(" ");
	const isNonTTY = !process.stdin.isTTY;
	const isOneShot = isExecMode || prompt.length > 0 || args.print || args.headless || isNonTTY;

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
	if (issueRef) {
		issueContext = await startupTrace.measure("issue.context", () => fetchIssueContext(issueRef));
	}

	if (isOneShot) {
		let finalPrompt = prompt;
		if (!finalPrompt && isNonTTY) finalPrompt = await readStdin();
		if (!finalPrompt) {
			if (isExecMode && args.stream === "ndjson" && execRunId) {
				emitExecEvent(
					createRunFailedEvent({
						runId: execRunId,
						exitCode: EXEC_EXIT_CODES.USAGE,
						phase: "usage",
						error: new Error("No prompt provided"),
					}),
				);
			}
			console.error("Error: No prompt provided. Pass a message as a positional argument or pipe to stdin.");
			process.exit(EXEC_EXIT_CODES.USAGE);
		}
		const result = await runOneShot(config, issueContext + finalPrompt, args.fallback, args.stream, {
			runId: execRunId ?? createExecRunId(),
			headless: Boolean(args.headless || isExecMode || args.print || isNonTTY),
			enableChitraguptaBootstrap: Boolean(isExecMode || args.headless),
			startupTrace,
		});
		process.exit(result.exitCode);
		return;
	}

	// Interactive startup no longer performs a credential preflight here; the
	// runtime/bootstrap + provider layer is now the single source of startup truth.
	await runInteractiveApp(config, args, describeStartupAuthSource(config, args), startupTrace);
}

main().catch((err) => {
	if (isRouteIncompatibleError(err)) {
		console.error(`\n${formatRouteIncompatibleFailureMessage(err)}\n`);
		process.exit(EXEC_EXIT_CODES.CONFIG);
	}
	if (isProviderConfigurationError(err)) {
		console.error(`\n${formatStartupAccessFailureMessage(err)}\n`);
		process.exit(EXEC_EXIT_CODES.CONFIG);
	}
	console.error(`Fatal error: ${err.message}`);
	process.exit(EXEC_EXIT_CODES.FATAL);
});
