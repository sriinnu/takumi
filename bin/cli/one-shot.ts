import type { AgentEvent, TakumiConfig, Usage } from "@takumi/core";
import { bootstrapChitraguptaForExec } from "@takumi/agent";
import { ChitraguptaObserver } from "@takumi/bridge";
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
		});

		for await (const event of loop) {
			trackAgentEvent(event);

			if (streamFormat === "ndjson") {
				emitExecEvent(createAgentEventEnvelope(runId, event));
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

	if (streamFormat === "text") {
		process.stdout.write("\n");
	}

	if (streamFormat === "ndjson") {
		const filesAfter = await listChangedFiles(process.cwd());
		const artifacts = buildExecArtifacts(fullText, failures);
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
				filesChanged: dedupeFiles([...filesBefore, ...filesAfter]),
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

async function ensureExecCanonicalSession(
	bridge: NonNullable<Awaited<ReturnType<typeof bootstrapChitraguptaForExec>>["bridge"]>,
	prompt: string,
	config: TakumiConfig,
): Promise<ExecSessionBinding> {
	try {
		const result = await bridge.sessionCreate({
			project: process.cwd(),
			title: prompt.slice(0, 80) || "Takumi exec",
			agent: "takumi.exec",
			model: config.model,
			provider: config.provider,
			branch: await detectGitBranch(process.cwd()),
		});
		return {
			projectPath: process.cwd(),
			canonicalSessionId: result.id,
			title: prompt.slice(0, 80) || "Takumi exec",
		};
	} catch {
		return { projectPath: process.cwd() };
	}
}

async function resolveExecRouting(
	bridge: NonNullable<Awaited<ReturnType<typeof bootstrapChitraguptaForExec>>["bridge"]>,
	session: ExecSessionBinding,
	prompt: string,
	config: TakumiConfig,
	capability: string,
): Promise<ExecRoutingBinding> {
	try {
		const observer = new ChitraguptaObserver(bridge as never);
		const decision = await observer.routeResolve({
			consumer: "takumi.exec",
			sessionId: session.canonicalSessionId ?? "transient",
			capability,
			constraints: { requireStreaming: true, hardProviderFamily: normalizeExecProviderFamily(config.provider) ?? undefined },
			context: {
				projectPath: session.projectPath,
				promptLength: prompt.length,
				configuredModel: config.model,
				configuredProvider: config.provider,
			},
		});
		const selected = decision?.selected;
		const selectedModel = extractSelectedModel(selected?.metadata);
		const selectedProvider = normalizeExecProviderFamily(selected?.providerFamily);
		const configuredProvider = normalizeExecProviderFamily(config.provider);
		const canApplyModel = Boolean(selected && selectedModel && (!selectedProvider || selectedProvider === configuredProvider));
		return {
			capability,
			authority: canApplyModel ? "engine" : "takumi-fallback",
			enforcement: canApplyModel ? "same-provider" : "capability-only",
			provider: selected?.providerFamily ?? config.provider,
			model: canApplyModel ? selectedModel : config.model,
			laneId: selected?.id,
			degraded: decision?.degraded ?? false,
		};
	} catch {
		return {
			capability,
			authority: "takumi-fallback",
			enforcement: "capability-only",
			provider: config.provider,
			model: config.model,
		};
	}
}

async function persistExecSession(
	bridge: Awaited<ReturnType<typeof bootstrapChitraguptaForExec>>["bridge"] | null,
	session: ExecSessionBinding,
	prompt: string,
	fullText: string,
	usage?: Usage,
): Promise<void> {
	if (!bridge?.isConnected || !session.canonicalSessionId) {
		return;
	}

	try {
		const maxTurn = await bridge.turnMaxNumber(session.canonicalSessionId).catch(() => 0);
		await bridge.turnAdd(session.canonicalSessionId, session.projectPath, {
			number: maxTurn + 1,
			role: "user",
			content: prompt,
			timestamp: Date.now(),
			model: undefined,
		});
		await bridge.turnAdd(session.canonicalSessionId, session.projectPath, {
			number: maxTurn + 2,
			role: "assistant",
			content: fullText,
			timestamp: Date.now(),
			model: undefined,
			tokens: usage
				? {
					prompt: usage.inputTokens,
					completion: usage.outputTokens,
					total: usage.inputTokens + usage.outputTokens,
				}
				: undefined,
		});
		await bridge.sessionMetaUpdate(session.canonicalSessionId, {
			completed: true,
			durationMs: undefined,
			costUsd: undefined,
		});
	} catch {
		// best effort
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

async function listChangedFiles(cwd: string): Promise<string[]> {
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);
	try {
		const { stdout } = await execFileAsync("git", ["status", "--short", "--untracked-files=all"], { cwd });
		return stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => line.slice(3).trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

function dedupeFiles(files: string[]): string[] {
	return Array.from(new Set(files.filter(Boolean))).sort();
}

async function detectGitBranch(cwd: string): Promise<string | undefined> {
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
		return stdout.trim() || undefined;
	} catch {
		return undefined;
	}
}

function determineExecCapability(prompt: string): string {
	const lowered = prompt.toLowerCase();
	if (/(review|audit|security|validator|validate|bug hunt|threat)/.test(lowered)) {
		return "coding.review.strict";
	}
	if (prompt.length > 800 || /(design|architecture|refactor|deep|complex|root cause)/.test(lowered)) {
		return "coding.deep-reasoning";
	}
	return "coding.patch-cheap";
}

function extractSelectedModel(metadata: Record<string, unknown> | undefined): string | undefined {
	if (typeof metadata?.model === "string") {
		return metadata.model;
	}
	if (typeof metadata?.modelId === "string") {
		return metadata.modelId;
	}
	return undefined;
}

function normalizeExecProviderFamily(value?: string): string | null {
	if (!value) return null;
	switch (value.toLowerCase()) {
		case "anthropic":
		case "openai":
			return value.toLowerCase();
		case "google":
		case "gemini":
			return "google";
		case "openai-compat":
		case "openrouter":
		case "ollama":
		case "github":
		case "groq":
		case "deepseek":
		case "mistral":
		case "together":
			return "openai-compat";
		default:
			return null;
	}
}
