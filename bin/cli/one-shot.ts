import type { AgentEvent, TakumiConfig, Usage, ExecLaneSnapshot } from "@takumi/core";
import { bootstrapChitraguptaForExec } from "@takumi/agent";
import {
	EXEC_EXIT_CODES,
	type ExecArtifact,
	type ExecRoutingBinding,
	type ExecSessionBinding,
	createAgentEventEnvelope,
	createBootstrapStatusEvent,
	createRunCompletedEvent,
	createRunFailedEvent,
	createRunStartedEvent,
	emitExecEvent,
} from "./exec-protocol.js";
import { createProvider } from "./provider.js";
import { buildReflexionPrompt, loadRecentReflexions, saveReflexion } from "./reflexion-lite.js";
import {
	buildHubArtifacts,
	dedupeFiles,
	determineExecCapability,
	ensureExecCanonicalSession,
	isPolicyFailureOutput,
	listChangedFiles,
	persistExecSession,
	resolveExecRouting,
} from "./one-shot-helpers.js";

export interface OneShotOptions {
	runId: string;
	headless: boolean;
	enableChitraguptaBootstrap?: boolean;
}

export interface OneShotResult {
	runId: string;
	exitCode: number;
}

export async function fetchIssueContext(issueRef: string): Promise<string> {
	const { spawn } = await import("node:child_process");
	return new Promise((resolve) => {
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

export async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	return Buffer.concat(chunks).toString("utf-8").trim();
}

export async function runOneShot(
	config: TakumiConfig,
	prompt: string,
	fallbackName?: string,
	streamFormat: "text" | "ndjson" = "text",
	options?: OneShotOptions,
): Promise<OneShotResult> {
	const { ToolRegistry, registerBuiltinTools, agentLoop, buildContext } = await import("@takumi/agent");
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
	let bootstrapBridge: Awaited<ReturnType<typeof bootstrapChitraguptaForExec>>["bridge"] | null = null;
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

	if (streamFormat === "ndjson") {
		emitExecEvent(
			createRunStartedEvent({
				runId,
				cwd: process.cwd(),
				prompt,
				headless: options?.headless ?? false,
				streamFormat,
				provider: config.provider,
				model: config.model,
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
	}

	try {
		const provider = await createProvider(config, fallbackName);
		const tools = new ToolRegistry();
		registerBuiltinTools(tools);
		const recentReflexions = await loadRecentReflexions(5);
		const reflexionPrompt = buildReflexionPrompt(recentReflexions);

		let bootstrapPrompt = "";
		if (options?.enableChitraguptaBootstrap) {
			const bootstrap = await bootstrapChitraguptaForExec({ cwd: process.cwd() });
			bootstrapConnected = bootstrap.connected;
			bootstrapBridge = bootstrap.bridge;
			bootstrapPrompt = bootstrap.memoryContext ?? "";
			if (bootstrapBridge?.isConnected) {
				sessionBinding = await ensureExecCanonicalSession(bootstrapBridge, prompt, config);
				const routed = await resolveExecRouting(bootstrapBridge, sessionBinding, prompt, config, routingBinding.capability);
				routingBinding.authority = routed.authority;
				routingBinding.enforcement = routed.enforcement;
				routingBinding.model = routed.model;
				routingBinding.provider = routed.provider;
				routingBinding.laneId = routed.laneId;
				routingBinding.degraded = routed.degraded;
				routedModel = routed.model ?? routedModel;
			}
			if (streamFormat === "ndjson") {
				emitExecEvent(
					createBootstrapStatusEvent({
						runId,
						bootstrap,
					}),
				);
			}
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
				provider.sendMessage(messages, sys, toolDefs, signal, innerOptions),
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
			if (bootstrapBridge?.isConnected) await bootstrapBridge.disconnect();
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

function buildExecArtifacts(fullText: string, failures: string[]): ExecArtifact[] {
	const artifacts: ExecArtifact[] = [];
	if (fullText.trim()) {
		artifacts.push({
			type: "assistant_response",
			summary: fullText.trim().slice(0, 240),
		});
	}
	if (failures.length > 0) {
		artifacts.push({
			type: "postmortem",
			summary: failures.join(" | ").slice(0, 240),
		});
	}
	artifacts.push({
		type: "exec-result",
		summary: fullText.trim() ? "One-shot execution completed" : "One-shot execution completed without assistant text",
	});
	return artifacts;
}
