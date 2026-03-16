/**
 * one-shot-helpers.ts — extracted helpers for one-shot exec runs.
 *
 * Keeps one-shot.ts focused on the main execution flow while housing
 * git detection, artifact building, session persistence, and provider
 * normalization logic.
 */

import type { TakumiConfig, Usage, HubArtifact, ExecRoutingBinding, ExecSessionBinding } from "@takumi/core";
import { createHubArtifact } from "@takumi/core";
import { ChitraguptaObserver } from "@takumi/bridge";
import type { bootstrapChitraguptaForExec } from "@takumi/agent";

/** Resolved Chitragupta bridge handle from bootstrapChitraguptaForExec. */
export type ExecBridge = NonNullable<Awaited<ReturnType<typeof bootstrapChitraguptaForExec>>["bridge"]>;

// ── Git helpers ───────────────────────────────────────────────────────────────

export async function listChangedFiles(cwd: string): Promise<string[]> {
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

export function dedupeFiles(files: string[]): string[] {
	return Array.from(new Set(files.filter(Boolean))).sort();
}

export async function detectGitBranch(cwd: string): Promise<string | undefined> {
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

// ── Capability classification ─────────────────────────────────────────────────

export function determineExecCapability(prompt: string): string {
	const lowered = prompt.toLowerCase();
	if (/\b(review|audit|security|validator|validate|bug hunt|threat)\b/.test(lowered)) {
		return "coding.review.strict";
	}
	if (prompt.length > 800 || /\b(design|architecture|refactor|deep|complex|root cause)\b/.test(lowered)) {
		return "coding.deep-reasoning";
	}
	return "coding.patch-cheap";
}

// ── Provider normalization ────────────────────────────────────────────────────

export function normalizeExecProviderFamily(value?: string): string | null {
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

export function extractSelectedModel(metadata: Record<string, unknown> | undefined): string | undefined {
	if (typeof metadata?.model === "string") return metadata.model;
	if (typeof metadata?.modelId === "string") return metadata.modelId;
	return undefined;
}

// ── Policy detection ──────────────────────────────────────────────────────────

export function isPolicyFailureOutput(output: string): boolean {
	return /headless run denied permission-required tool|permission denied for tool|permission required for tool|blocked by extension/i.test(
		output,
	);
}

// ── Artifact building ─────────────────────────────────────────────────────────

export interface ExecArtifactContext {
	fullText: string;
	failures: string[];
	routing: ExecRoutingBinding;
	filesChanged: string[];
}

export function buildHubArtifacts(ctx: ExecArtifactContext): HubArtifact[] {
	const artifacts: HubArtifact[] = [];

	if (ctx.fullText.trim()) {
		artifacts.push(
			createHubArtifact({
				kind: "assistant_response",
				producer: "takumi.exec",
				summary: ctx.fullText.trim().slice(0, 240),
				body: ctx.fullText,
				laneId: ctx.routing.laneId,
				confidence: ctx.failures.length === 0 ? 0.9 : 0.5,
			}),
		);
	}

	if (ctx.failures.length > 0) {
		artifacts.push(
			createHubArtifact({
				kind: "postmortem",
				producer: "takumi.exec",
				summary: ctx.failures.join(" | ").slice(0, 240),
				body: ctx.failures.join("\n"),
				laneId: ctx.routing.laneId,
				confidence: 1.0,
				metadata: { failureCount: ctx.failures.length },
			}),
		);
	}

	if (ctx.filesChanged.length > 0) {
		artifacts.push(
			createHubArtifact({
				kind: "implementation",
				producer: "takumi.exec",
				summary: `${ctx.filesChanged.length} file(s) changed`,
				laneId: ctx.routing.laneId,
				confidence: 0.8,
				metadata: { files: ctx.filesChanged },
			}),
		);
	}

	artifacts.push(
		createHubArtifact({
			kind: "exec_result",
			producer: "takumi.exec",
			summary: ctx.fullText.trim() ? "Execution completed" : "Execution completed without output",
			laneId: ctx.routing.laneId,
		}),
	);

	return artifacts;
}

// ── Session persistence ───────────────────────────────────────────────────────

export async function ensureExecCanonicalSession(
	bridge: ExecBridge,
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

// ── Routing resolution ────────────────────────────────────────────────────────

export async function resolveExecRouting(
	bridge: ExecBridge,
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

// ── Session persistence (turns) ───────────────────────────────────────────────

export async function persistExecSession(
	bridge: ExecBridge | null,
	session: ExecSessionBinding,
	prompt: string,
	fullText: string,
	usage?: Usage,
): Promise<void> {
	if (!bridge?.isConnected || !session.canonicalSessionId) return;

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
