import type { AgentEvent, ExecBootstrapSnapshot, TakumiConfig, Usage, ExecLaneSnapshot } from "@takumi/core";
import { normalizeProviderName } from "@takumi/core";
import {
	EXEC_EXIT_CODES,
	type ExecRoutingBinding,
	type ExecSessionBinding,
	createAgentEventEnvelope,
	createBootstrapStatusEvent,
	createRunCompletedEvent,
	createRunFailedEvent,
	createRunStartedEvent,
	emitExecEvent,
} from "./exec-protocol.js";
import { createResolvedProvider, isProviderConfigurationError, isRouteIncompatibleError } from "./provider.js";
import { formatRouteIncompatibleFailureMessage } from "./route-failure.js";
import { buildReflexionPrompt, loadRecentReflexions, saveReflexion } from "./reflexion-lite.js";
import { resolveExecRouting } from "./exec-routing.js";
import {
	buildHubArtifacts,
	dedupeFiles,
	determineExecCapability,
	ensureExecCanonicalSession,
	isPolicyFailureOutput,
	listChangedFiles,
	persistExecArtifacts,
	persistExecSession,
} from "./one-shot-helpers.js";
import { buildExecArtifacts } from "./one-shot-io.js";
import { collectRuntimeBootstrap, type RuntimeBootstrapResult } from "./runtime-bootstrap.js";
import type { StartupTrace } from "./startup-trace.js";
/** Pre-built dependencies a persistent worker can reuse across dispatches. */
export interface OneShotPrebuiltDeps {
	tools: InstanceType<typeof import("@takumi/agent").ToolRegistry>;
	runtimeBootstrap: RuntimeBootstrapResult;
}
export interface OneShotOptions {
	runId: string;
	headless: boolean;
	enableChitraguptaBootstrap?: boolean;
	runtimeRole?: "core" | "side-agent-worker";
	startupTrace?: StartupTrace;
	/** When supplied, skip per-dispatch bootstrap — caller manages lifecycle. */
	prebuiltDeps?: OneShotPrebuiltDeps;
}
export interface OneShotResult {
	runId: string;
	exitCode: number;
}
export { fetchIssueContext, readStdin } from "./one-shot-io.js";

/**
 * Run a single headless task while preserving the same Chitragupta-first route
 * and provider resolution semantics as the interactive startup path.
 */
export async function runOneShot(
	config: TakumiConfig,
	prompt: string,
	fallbackName?: string,
	streamFormat: "text" | "ndjson" = "text",
	options?: OneShotOptions,
): Promise<OneShotResult> {
	const { ToolRegistry, registerBuiltinTools, agentLoop, buildContext } = await import("@takumi/agent");
	const startupTrace = options?.startupTrace;
	const runId = options?.runId ?? `exec-${Date.now().toString(36)}`;
	const startedAt = Date.now();
	const failures: string[] = [];
	let lastUsage: Usage | undefined;
	let stopReason: string | undefined;
	let textChars = 0;
	let fullText = "";
	let toolCalls = 0;
	let toolErrors = 0;
	let agentError: Error | undefined;
	let policyError: Error | undefined;
	let bootstrapConnected = false;
	let bootstrapBridge: NonNullable<Awaited<ReturnType<typeof collectRuntimeBootstrap>>["chitragupta"]>["bridge"] | null = null;
	let sessionBinding: ExecSessionBinding = { projectPath: process.cwd() };
	let routedModel = config.model;
	const routingBinding: ExecRoutingBinding = {
		capability: determineExecCapability(prompt),
		authority: "takumi-fallback",
		enforcement: "capability-only",
		provider: config.provider,
		model: routedModel,
	};
	const filesBefore = await listChangedFiles(process.cwd());

	try {
		/** Trace-or-noop: eliminates the startupTrace branching duplication. */
		const traced = <T>(label: string, fn: () => Promise<T>): Promise<T> =>
			startupTrace?.measure(label, fn) ?? fn();

		const tools = options?.prebuiltDeps?.tools ?? (() => {
			const reg = new ToolRegistry();
			registerBuiltinTools(reg);
			return reg;
		})();

		let runtimeBootstrap: RuntimeBootstrapResult;
		let recentReflexions: Awaited<ReturnType<typeof loadRecentReflexions>>;
		if (options?.prebuiltDeps?.runtimeBootstrap) {
			runtimeBootstrap = options.prebuiltDeps.runtimeBootstrap;
			recentReflexions = await traced("reflexion.load", () => loadRecentReflexions(5));
		} else {
			[runtimeBootstrap, recentReflexions] = await Promise.all([
				traced("runtime.bootstrap", () =>
					collectRuntimeBootstrap(config, {
						cwd: process.cwd(),
						tools,
						enableChitraguptaBootstrap: Boolean(options?.enableChitraguptaBootstrap),
						includeProviderStatus: Boolean(options?.enableChitraguptaBootstrap),
						bootstrapMode: "exec",
						runtimeRole: options?.runtimeRole ?? "core",
						consumer: "takumi",
						capability: routingBinding.capability,
					}),
				),
				traced("reflexion.load", () => loadRecentReflexions(5)),
			]);
		}
		if (runtimeBootstrap.sideAgents.degraded) {
			failures.push(`side_agent_bootstrap: ${runtimeBootstrap.sideAgents.summary}`);
		}
		const reflexionPrompt = buildReflexionPrompt(recentReflexions);
		const bootstrapSnapshot: ExecBootstrapSnapshot = runtimeBootstrap.bootstrap;
		bootstrapConnected = runtimeBootstrap.bootstrap.connected;
		bootstrapBridge = runtimeBootstrap.chitragupta?.bridge ?? null;
		const bootstrapPrompt = runtimeBootstrap.chitragupta?.memoryContext ?? "";
		if (bootstrapBridge?.isConnected) {
			sessionBinding = runtimeBootstrap.chitragupta?.canonicalSessionId
				? {
						projectPath: process.cwd(),
						canonicalSessionId: runtimeBootstrap.chitragupta.canonicalSessionId,
						title: prompt.slice(0, 80) || "Takumi exec",
					}
				: await ensureExecCanonicalSession(bootstrapBridge, prompt, config);
			const routed = await resolveExecRouting(bootstrapBridge, sessionBinding, prompt, config, routingBinding.capability);
			routingBinding.authority = routed.authority;
			routingBinding.enforcement = routed.enforcement;
			routingBinding.model = routed.model;
			routingBinding.provider = routed.provider;
			routingBinding.laneId = routed.laneId;
			routingBinding.degraded = routed.degraded;
			routedModel = routed.model ?? routedModel;
		}

		const requestedProvider = routingBinding.provider;
		const providerResolution = await traced("provider.create", () =>
			createResolvedProvider(config, {
				fallbackName,
				preferredProvider: requestedProvider,
				preferredModel: routingBinding.model ?? routedModel,
				strictPreferredRoute: routingBinding.authority === "engine",
				bootstrapBridge: bootstrapBridge ?? undefined,
			}),
		);
		const resolvedProvider = providerResolution.provider;
		const resolvedProviderName = providerResolution.resolvedConfig.provider;
		routedModel = providerResolution.resolvedConfig.model ?? routedModel;

		if (
			requestedProvider &&
			(normalizeProviderName(requestedProvider) ?? requestedProvider) !== resolvedProviderName
		) {
			// If Takumi had to substitute the requested provider locally, mark the
			// lane as a fallback so exec reporting stays honest for operators.
			routingBinding.authority = "takumi-fallback";
			routingBinding.enforcement = "capability-only";
			routingBinding.laneId = undefined;
			routingBinding.degraded = true;
		}

		routingBinding.provider = resolvedProviderName;
		routingBinding.model = routedModel;

		if (streamFormat === "text") {
			for (const line of [...runtimeBootstrap.warningLines, ...providerResolution.warnings]) {
				process.stderr.write(`[warning] ${line}\n`);
			}
		}
		for (const line of startupTrace?.formatLines() ?? []) {
			process.stderr.write(`[startup] ${line}\n`);
		}
		if (streamFormat === "ndjson") {
			emitExecEvent(
				createRunStartedEvent({
					runId,
					cwd: process.cwd(),
					prompt,
					headless: options?.headless ?? false,
					streamFormat,
					provider: routingBinding.provider,
					model: routingBinding.model,
					session: sessionBinding,
					routing: routingBinding,
					lane: {
						capability: routingBinding.capability,
						authority: routingBinding.authority,
						enforcement: routingBinding.enforcement,
						selectedModel: routingBinding.model,
						laneId: routingBinding.laneId,
						degraded: routingBinding.degraded ?? false,
					},
				}),
			);
			emitExecEvent(
				createBootstrapStatusEvent({
					runId,
					bootstrap: bootstrapSnapshot,
				}),
			);
		}

		const combinedSystemPrompt = [config.systemPrompt || "", reflexionPrompt, bootstrapPrompt]
			.filter(Boolean)
			.join("\n\n");

		const system = await buildContext({
			cwd: process.cwd(),
			tools: tools.getDefinitions(),
			customPrompt: combinedSystemPrompt || undefined,
		});

		const loop = agentLoop(prompt, [], {
			sendMessage: (messages: any, sys: any, toolDefs: any, signal: any, innerOptions: any) =>
				resolvedProvider.sendMessage(messages, sys, toolDefs, signal, innerOptions),
			model: routedModel,
			tools,
			systemPrompt: system,
			maxTurns: config.maxTurns,
			checkToolPermission: async (toolName: string) => ({
				allowed: false,
				reason: `Headless run denied permission-required tool: ${toolName}`,
			}),
		});

		for await (const event of loop) {
			trackAgentEvent(event);

			if (streamFormat === "ndjson") {
				emitExecEvent(createAgentEventEnvelope(runId, event, routingBinding.laneId));
				continue;
			}

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
						process.stderr.write("done\n");
					}
					break;
				case "error":
					process.stderr.write(`\nError: ${event.error.message}\n`);
					break;
			}
		}
	} catch (error) {
		if (isRouteIncompatibleError(error)) {
			failures.push(`route_incompatible: ${(error as Error).message.slice(0, 280)}`);
			if (streamFormat === "ndjson") {
				emitExecEvent(
					createRunFailedEvent({
						runId,
						exitCode: EXEC_EXIT_CODES.CONFIG,
						phase: "config",
						category: "route_incompatible",
						error,
						session: sessionBinding,
						routing: routingBinding,
					}),
				);
			} else {
				process.stderr.write(`\n${formatRouteIncompatibleFailureMessage(error as Error)}\n`);
			}
			return { runId, exitCode: EXEC_EXIT_CODES.CONFIG };
		}
		if (isProviderConfigurationError(error)) {
			failures.push(`provider_config: ${(error as Error).message.slice(0, 280)}`);
			if (streamFormat === "ndjson") {
				emitExecEvent(
					createRunFailedEvent({
						runId,
						exitCode: EXEC_EXIT_CODES.CONFIG,
						phase: "config",
						error,
						session: sessionBinding,
						routing: routingBinding,
					}),
				);
			} else {
				// Text-mode exec still gets a human-readable config classification
				// instead of the old startup-time API-key nag.
				process.stderr.write(`\nConfiguration error: ${(error as Error).message}\n`);
			}
			return { runId, exitCode: EXEC_EXIT_CODES.CONFIG };
		}

		failures.push(`internal_error: ${(error as Error).message.slice(0, 280)}`);
		if (streamFormat === "ndjson") {
			emitExecEvent(
				createRunFailedEvent({
					runId,
					exitCode: EXEC_EXIT_CODES.FATAL,
					phase: "internal",
					error,
					session: sessionBinding,
					routing: routingBinding,
				}),
			);
		}
		return { runId, exitCode: EXEC_EXIT_CODES.FATAL };
	} finally {
		try {
			// When prebuiltDeps is provided, the caller manages the bridge lifecycle.
			if (!options?.prebuiltDeps && bootstrapBridge?.isConnected) await bootstrapBridge.disconnect();
		} catch {
			// best effort
		}
	}
	if (failures.length > 0) {
		await saveReflexion(prompt, failures).catch(() => undefined);
	}

	if (agentError) {
		if (streamFormat === "ndjson") {
			emitExecEvent(
				createRunFailedEvent({
					runId,
					exitCode: EXEC_EXIT_CODES.AGENT_ERROR,
					phase: "agent_loop",
					error: agentError,
					session: sessionBinding,
					routing: routingBinding,
				}),
			);
		}
		return { runId, exitCode: EXEC_EXIT_CODES.AGENT_ERROR };
	}

	if (policyError) {
		if (streamFormat === "ndjson") {
			emitExecEvent(
				createRunFailedEvent({
					runId,
					exitCode: EXEC_EXIT_CODES.POLICY,
					phase: "policy",
					error: policyError,
					session: sessionBinding,
					routing: routingBinding,
				}),
			);
		} else {
			process.stderr.write(`\nPolicy error: ${policyError.message}\n`);
		}
		return { runId, exitCode: EXEC_EXIT_CODES.POLICY };
	}

	if (streamFormat === "text") {
		process.stdout.write("\n");
	}

	if (streamFormat === "ndjson") {
		const filesAfter = await listChangedFiles(process.cwd());
		const artifacts = buildExecArtifacts(fullText, failures);
		const filesChanged = dedupeFiles([...filesBefore, ...filesAfter]);
		const hubArtifacts = buildHubArtifacts({ fullText, failures, routing: routingBinding, filesChanged });
		const lane: ExecLaneSnapshot = {
			capability: routingBinding.capability,
			authority: routingBinding.authority,
			enforcement: routingBinding.enforcement,
			selectedModel: routingBinding.model,
			laneId: routingBinding.laneId,
			degraded: routingBinding.degraded ?? false,
		};
		await persistExecSession(bootstrapBridge, sessionBinding, prompt, fullText, lastUsage);
		await persistExecArtifacts(bootstrapBridge, sessionBinding, runId, hubArtifacts);
		emitExecEvent(
			createRunCompletedEvent({
				runId,
				durationMs: Date.now() - startedAt,
				stopReason,
				usage: lastUsage,
				stats: { textChars, toolCalls, toolErrors },
				bootstrapConnected,
				session: sessionBinding,
				routing: routingBinding,
				artifacts,
				hubArtifacts,
				filesChanged,
				lane,
				validation: { status: "not-run", checks: [] },
			}),
		);
	}

	return { runId, exitCode: EXEC_EXIT_CODES.OK };

	function trackAgentEvent(event: AgentEvent): void {
		if (event.type === "text_delta") {
			textChars += event.text.length;
			fullText += event.text;
			return;
		}

		if (event.type === "tool_use") {
			toolCalls += 1;
			return;
		}

		if (event.type === "tool_result") {
			if (event.isError) {
				toolErrors += 1;
				failures.push(`${event.name}: ${event.output.slice(0, 280).replace(/\s+/g, " ")}`);
				if (!policyError && isPolicyFailureOutput(event.output)) {
					policyError = new Error(event.output);
				}
			}
			return;
		}

		if (event.type === "usage_update") {
			lastUsage = event.usage;
			return;
		}

		if (event.type === "done") {
			stopReason = event.stopReason;
			return;
		}

		if (event.type === "error") {
			agentError = event.error;
			failures.push(`agent_error: ${event.error.message.slice(0, 280)}`);
		}
	}
}
