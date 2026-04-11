/**
 * one-shot-helpers.ts — extracted helpers for one-shot exec runs.
 *
 * Keeps one-shot.ts focused on the main execution flow while housing
 * git detection, artifact building, session persistence, and provider
 * normalization logic.
 */

import { inferProvider } from "@takumi/agent";
import type { ImportedArtifactInput, ImportedArtifactRecord } from "@takumi/bridge";
import {
	ArtifactStore,
	createHubArtifact,
	normalizeProviderName,
	type ExecRoutingBinding,
	type ExecSessionBinding,
	type HubArtifact,
	type TakumiConfig,
	type Usage,
} from "@takumi/core";
import type { bootstrapChitraguptaForExec } from "@takumi/agent";

/** Resolved Chitragupta bridge handle from bootstrapChitraguptaForExec. */
export type ExecBridge = NonNullable<Awaited<ReturnType<typeof bootstrapChitraguptaForExec>>["bridge"]>;
export type ExecArtifactBridge = Pick<ExecBridge, "isConnected" | "artifactImportBatch" | "artifactListImported">;

const artifactStore = new ArtifactStore();
const OPENAI_COMPAT_PROVIDERS = new Set([
	"openai",
	"openrouter",
	"ollama",
	"github",
	"groq",
	"deepseek",
	"mistral",
	"together",
	"xai",
	"alibaba",
	"bedrock",
	"zai",
]);

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

/** Read the daemon-selected concrete provider when the route metadata already carries one. */
export function extractSelectedProvider(metadata: Record<string, unknown> | undefined): string | undefined {
	const candidates = [metadata?.providerId, metadata?.provider, metadata?.boundProviderId, metadata?.compatibleProvider];
	for (const candidate of candidates) {
		if (typeof candidate !== "string") continue;
		const normalized = normalizeProviderName(candidate);
		if (normalized) return normalized;
	}
	return undefined;
}

function mapExecProviderFamilyToConcreteProvider(
	family: string | undefined,
	configuredProvider: string | undefined,
): string | undefined {
	const normalizedFamily = normalizeProviderName(family);
	if (!normalizedFamily) return undefined;
	if (normalizedFamily === "openai-compat") {
		const normalizedConfiguredProvider = normalizeProviderName(configuredProvider);
		return normalizedConfiguredProvider && OPENAI_COMPAT_PROVIDERS.has(normalizedConfiguredProvider)
			? normalizedConfiguredProvider
			: undefined;
	}
	return normalizedFamily;
}

/** Collapse daemon provider-family hints plus exact model metadata into one concrete provider Takumi can really bind. */
export function resolveExecConcreteProvider(
	providerFamily: string | undefined,
	selectedProvider: string | undefined,
	selectedModel: string | undefined,
	configuredProvider: string | undefined,
): string | undefined {
	const normalizedFamily = normalizeProviderName(providerFamily);
	const normalizedSelectedProvider = normalizeProviderName(selectedProvider);
	if (normalizedFamily === "openai-compat") {
		if (normalizedSelectedProvider && OPENAI_COMPAT_PROVIDERS.has(normalizedSelectedProvider)) {
			return normalizedSelectedProvider;
		}
		return mapExecProviderFamilyToConcreteProvider(providerFamily, configuredProvider);
	}
	if (normalizedSelectedProvider) return normalizedSelectedProvider;
	const providerFromFamily = mapExecProviderFamilyToConcreteProvider(providerFamily, configuredProvider);
	if (providerFromFamily) return providerFromFamily;
	return selectedModel ? mapExecProviderFamilyToConcreteProvider(inferProvider(selectedModel), configuredProvider) : undefined;
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

// ── Artifact persistence / promotion ─────────────────────────────────────────

/** Persist one-shot artifacts locally and promote them when a daemon session exists. */
export async function persistExecArtifacts(
	bridge: ExecArtifactBridge | null,
	session: ExecSessionBinding,
	runId: string,
	artifacts: HubArtifact[],
): Promise<void> {
	if (artifacts.length === 0) return;

	const storageSessionId = session.canonicalSessionId ?? runId;
	const preparedArtifacts = artifacts.map((artifact) => ({
		...artifact,
		taskId: artifact.taskId ?? runId,
		runId,
		localSessionId: artifact.localSessionId ?? runId,
		canonicalSessionId: session.canonicalSessionId ?? artifact.canonicalSessionId,
		importStatus: artifact.importStatus ?? "pending",
	}));

	await Promise.all(preparedArtifacts.map((artifact) => artifactStore.save(artifact, storageSessionId)));

	if (!bridge?.isConnected || !session.canonicalSessionId) return;

	const batch = await bridge.artifactImportBatch(
		session.projectPath,
		"takumi",
		preparedArtifacts.map(toImportedArtifactInput),
		session.canonicalSessionId,
	);
	if (!batch) return;

	const importedList = await bridge.artifactListImported(session.projectPath, "takumi", session.canonicalSessionId);
	const recordsByLocalId = new Map((importedList?.items ?? []).map((record) => [record.localArtifactId, record] as const));
	const recordsByContentHash = new Map((importedList?.items ?? []).map((record) => [record.contentHash, record] as const));
	const artifactsById = new Map(preparedArtifacts.map((artifact) => [artifact.artifactId, artifact] as const));
	const importedAt = Date.now();

	for (const entry of batch.imported) {
		const artifact = artifactsById.get(entry.localArtifactId);
		if (!artifact) continue;
		const record = recordsByLocalId.get(entry.localArtifactId);
		await markExecArtifactImported(
			artifact,
			record,
			session.canonicalSessionId,
			importedAt,
			entry.canonicalArtifactId,
			entry.contentHash,
		);
	}

	for (const entry of batch.skipped) {
		const artifact = artifactsById.get(entry.localArtifactId);
		if (!artifact) continue;
		const record = recordsByLocalId.get(entry.localArtifactId) ?? recordsByContentHash.get(artifact.contentHash);
		if (!record) continue;
		await markExecArtifactImported(
			artifact,
			record,
			session.canonicalSessionId,
			importedAt,
			record.canonicalArtifactId,
			record.contentHash,
		);
	}

	for (const entry of batch.failed) {
		if (!entry.localArtifactId) continue;
		await artifactStore.updateImportState(entry.localArtifactId, {
			promoted: false,
			canonicalSessionId: session.canonicalSessionId,
			importStatus: "failed",
			lastImportAt: importedAt,
			lastImportError: entry.error,
		});
	}
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

function toImportedArtifactInput(artifact: HubArtifact): ImportedArtifactInput {
	return {
		localArtifactId: artifact.artifactId,
		kind: artifact.kind,
		producer: artifact.producer,
		summary: artifact.summary,
		body: artifact.body,
		path: artifact.path,
		confidence: artifact.confidence,
		createdAt: artifact.createdAt,
		taskId: artifact.taskId,
		laneId: artifact.laneId,
		localSessionId: artifact.localSessionId,
		canonicalSessionId: artifact.canonicalSessionId,
		runId: artifact.runId,
		contentHash: artifact.contentHash,
		metadata: artifact.metadata,
	};
}

async function markExecArtifactImported(
	artifact: HubArtifact,
	record: ImportedArtifactRecord | undefined,
	canonicalSessionId: string,
	importedAt: number,
	canonicalArtifactId: string,
	contentHash: string,
): Promise<void> {
	await artifactStore.updateImportState(artifact.artifactId, {
		promoted: true,
		canonicalArtifactId,
		canonicalSessionId,
		localSessionId: artifact.localSessionId,
		runId: artifact.runId,
		contentHash,
		importStatus: "imported",
		lastImportAt: importedAt,
		lastImportError: undefined,
	});

	if (record?.localSessionId && !artifact.localSessionId) {
		await artifactStore.save(
			{
				...artifact,
				localSessionId: record.localSessionId,
				canonicalSessionId,
				canonicalArtifactId,
				contentHash,
				importStatus: "imported",
				lastImportAt: importedAt,
				lastImportError: undefined,
				promoted: true,
			},
			canonicalSessionId,
		);
	}
}
