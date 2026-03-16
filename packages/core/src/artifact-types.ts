/**
 * Structured artifact types for the hub boundary contract.
 *
 * Artifacts are typed, first-class objects that Takumi produces during
 * execution and Chitragupta persists as durable records.  They carry
 * enough metadata for the hub to index, promote, and recall them without
 * re-parsing prose.
 */

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

// ── Core artifact ─────────────────────────────────────────────────────────────

export interface HubArtifact {
	/** Unique artifact identifier (generated at creation). */
	artifactId: string;
	/** Discriminated kind — determines how consumers interpret the body. */
	kind: ArtifactKind;
	/** Which system produced this artifact. */
	producer: ArtifactProducer;
	/** Associated task identifier (hub-scoped). */
	taskId?: string;
	/** Execution lane that produced this artifact. */
	laneId?: string;
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

export function createArtifactId(now = Date.now()): string {
	artifactCounter += 1;
	return `art-${now.toString(36)}-${instanceSuffix}-${artifactCounter.toString(36).padStart(3, "0")}`;
}

export function createHubArtifact(input: {
	kind: ArtifactKind;
	producer: ArtifactProducer;
	summary: string;
	body?: string;
	path?: string;
	confidence?: number;
	taskId?: string;
	laneId?: string;
	metadata?: Record<string, unknown>;
}): HubArtifact {
	return {
		artifactId: createArtifactId(),
		kind: input.kind,
		producer: input.producer,
		taskId: input.taskId,
		laneId: input.laneId,
		createdAt: new Date().toISOString(),
		summary: input.summary.slice(0, 240),
		body: input.body,
		path: input.path,
		confidence: input.confidence,
		promoted: false,
		metadata: sanitizeMetadata(input.metadata),
	};
}

/** Reset artifact counter — only for tests. */
export function resetArtifactCounter(): void {
	artifactCounter = 0;
}
