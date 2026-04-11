/**
 * Structured artifact types for the hub boundary contract.
 *
 * Artifacts are typed, first-class objects that Takumi produces during
 * execution and Chitragupta persists as durable records.  They carry
 * enough metadata for the hub to index, promote, and recall them without
 * re-parsing prose.
 */

import crypto from "node:crypto";

// ── Artifact kinds ────────────────────────────────────────────────────────────

export type ArtifactKind =
	| "plan"
	| "design_review"
	| "implementation"
	| "validation"
	| "postmortem"
	| "handoff"
	| "assistant_response"
	| "exec_result"
	| "reflection"
	| "summary";

export type ArtifactProducer =
	| "takumi.exec"
	| "takumi.tui"
	| "takumi.cluster.planner"
	| "takumi.cluster.worker"
	| "takumi.cluster.validator"
	| "takumi.cluster.adversarial"
	| "chitragupta"
	| "scarlett";

/** Durable promotion lifecycle for one locally persisted artifact. */
export type ArtifactImportStatus = "pending" | "importing" | "imported" | "failed";

// ── Core artifact ─────────────────────────────────────────────────────────────

export interface HubArtifact {
	/** Unique artifact identifier (generated at creation). */
	artifactId: string;
	/** Discriminated kind — determines how consumers interpret the body. */
	kind: ArtifactKind;
	/** Which system produced this artifact. */
	producer: ArtifactProducer;
	/** Stable content hash used when importing into Chitragupta. */
	contentHash: string;
	/** Associated task identifier (hub-scoped). */
	taskId?: string;
	/** Runtime run identifier that produced this artifact. */
	runId?: string;
	/** Execution lane that produced this artifact. */
	laneId?: string;
	/** Local Takumi session identifier that persisted this artifact first. */
	localSessionId?: string;
	/** Canonical Chitragupta session identifier once bound. */
	canonicalSessionId?: string;
	/** ISO 8601 creation timestamp. */
	createdAt: string;
	/** Human-readable summary (≤240 chars, always present). */
	summary: string;
	/** Full artifact body (plan text, validation findings, etc.). */
	body?: string;
	/** File path relevant to this artifact (if applicable). */
	path?: string;
	/** Producer confidence in this artifact (0.0–1.0). */
	confidence?: number;
	/** Whether the hub has promoted this as a canonical reference. */
	promoted: boolean;
	/** Import lifecycle state for degraded-local promotion into Chitragupta. */
	importStatus?: ArtifactImportStatus;
	/** Epoch ms when the most recent import attempt completed. */
	lastImportAt?: number;
	/** Error from the most recent failed import attempt. */
	lastImportError?: string;
	/** Canonical Chitragupta artifact identifier after successful import. */
	canonicalArtifactId?: string;
	/** Extensible metadata bag for kind-specific fields. */
	metadata?: Record<string, unknown>;
}

// ── Kind-specific metadata helpers ────────────────────────────────────────────

export interface ValidationArtifactMeta {
	status: "passed" | "failed" | "unknown";
	checks: string[];
	validatorCount?: number;
	consensusScore?: number;
}

export interface PlanArtifactMeta {
	steps: number;
	estimatedFiles?: number;
	complexity?: string;
}

export interface HandoffArtifactMeta {
	fromLane?: string;
	toLane?: string;
	reason: string;
}

export interface ReflectionArtifactMeta {
	failures: string[];
	lessonCount: number;
}

// ── Factory ───────────────────────────────────────────────────────────────────

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Strip prototype-pollution keys from metadata. */
function sanitizeMetadata(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
	if (!meta) return undefined;
	const clean: Record<string, unknown> = Object.create(null);
	for (const key of Object.keys(meta)) {
		if (!DANGEROUS_KEYS.has(key)) clean[key] = meta[key];
	}
	return clean;
}

let artifactCounter = 0;
const instanceSuffix = Math.random().toString(36).slice(2, 6);

/** Build the stable digest input used for Chitragupta artifact import dedupe. */
function buildArtifactContentSeed(input: {
	kind: ArtifactKind;
	producer: ArtifactProducer;
	summary: string;
	body?: string;
	path?: string;
	createdAt: string;
	taskId?: string;
	laneId?: string;
}): string {
	return JSON.stringify({
		kind: input.kind,
		producer: input.producer,
		summary: input.summary,
		body: input.body,
		path: input.path,
		createdAt: input.createdAt,
		taskId: input.taskId,
		laneId: input.laneId,
	});
}

/** Build the stable content hash used by Chitragupta import and dedupe. */
export function createArtifactContentHash(input: {
	kind: ArtifactKind;
	producer: ArtifactProducer;
	summary: string;
	body?: string;
	path?: string;
	createdAt: string;
	taskId?: string;
	laneId?: string;
}): string {
	return crypto.createHash("sha256").update(buildArtifactContentSeed(input)).digest("hex");
}

/** Create one local artifact identifier. */
export function createArtifactId(now = Date.now()): string {
	artifactCounter += 1;
	return `art-${now.toString(36)}-${instanceSuffix}-${artifactCounter.toString(36).padStart(3, "0")}`;
}

/** Build one HubArtifact with stable import metadata. */
export function createHubArtifact(input: {
	kind: ArtifactKind;
	producer: ArtifactProducer;
	summary: string;
	body?: string;
	path?: string;
	confidence?: number;
	taskId?: string;
	runId?: string;
	laneId?: string;
	localSessionId?: string;
	canonicalSessionId?: string;
	importStatus?: ArtifactImportStatus;
	lastImportAt?: number;
	lastImportError?: string;
	canonicalArtifactId?: string;
	contentHash?: string;
	metadata?: Record<string, unknown>;
}): HubArtifact {
	const createdAt = new Date().toISOString();
	const summary = input.summary.slice(0, 240);
	return {
		artifactId: createArtifactId(),
		kind: input.kind,
		producer: input.producer,
		contentHash:
			input.contentHash ??
			createArtifactContentHash({
				kind: input.kind,
				producer: input.producer,
				summary,
				body: input.body,
				path: input.path,
				createdAt,
				taskId: input.taskId,
				laneId: input.laneId,
			}),
		taskId: input.taskId,
		runId: input.runId,
		laneId: input.laneId,
		localSessionId: input.localSessionId,
		canonicalSessionId: input.canonicalSessionId,
		createdAt,
		summary,
		body: input.body,
		path: input.path,
		confidence: input.confidence,
		promoted: false,
		importStatus: input.importStatus,
		lastImportAt: input.lastImportAt,
		lastImportError: input.lastImportError,
		canonicalArtifactId: input.canonicalArtifactId,
		metadata: sanitizeMetadata(input.metadata),
	};
}

/** Reset artifact counter — only for tests. */
export function resetArtifactCounter(): void {
	artifactCounter = 0;
}
