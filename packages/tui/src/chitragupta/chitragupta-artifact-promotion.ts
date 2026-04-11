import type { ImportedArtifactInput, ImportedArtifactRecord } from "@takumi/bridge";
import {
	ArtifactStore,
	createArtifactContentHash,
	type HubArtifact,
	type SessionArtifactPromotionState,
} from "@takumi/core";
import type { AppState } from "../state.js";

const artifactStore = new ArtifactStore();

type StoredArtifact = HubArtifact & { _sessionId?: string };

export interface ArtifactPromotionSummary {
	status: SessionArtifactPromotionState["status"];
	pendingArtifactIds: string[];
	importedArtifactIds: string[];
	lastPromotionAt?: number;
	lastError?: string;
}

/** Read one normalized artifact-promotion snapshot from app state. */
export function readArtifactPromotionSummary(state: AppState): ArtifactPromotionSummary {
	return {
		status: state.artifactPromotion.value.status ?? "idle",
		pendingArtifactIds: state.artifactPromotion.value.pendingArtifactIds ?? [],
		importedArtifactIds: state.artifactPromotion.value.importedArtifactIds ?? [],
		lastPromotionAt: state.artifactPromotion.value.lastPromotionAt,
		lastError: state.artifactPromotion.value.lastError,
	};
}

/** Recompute the current artifact-promotion state without importing anything. */
export async function refreshArtifactPromotionState(
	state: AppState,
	canonicalSessionId?: string,
): Promise<ArtifactPromotionSummary> {
	const artifacts = await listTrackedSessionArtifacts(state);
	if (artifacts.length === 0) {
		setArtifactPromotionState(state, { status: "idle" });
		return readArtifactPromotionSummary(state);
	}

	const importedArtifactIds = artifacts
		.filter((artifact) => isArtifactImportedForSession(artifact, canonicalSessionId))
		.map((artifact) => artifact.artifactId);
	const pendingArtifactIds = artifacts
		.filter((artifact) => !isArtifactImportedForSession(artifact, canonicalSessionId))
		.map((artifact) => artifact.artifactId);
	setArtifactPromotionState(state, {
		status: pendingArtifactIds.length > 0 ? "pending" : "ready",
		pendingArtifactIds,
		importedArtifactIds,
	});
	return readArtifactPromotionSummary(state);
}

/** Promote pending local artifacts through the daemon-owned artifact ledger. */
export async function promotePendingSessionArtifacts(
	state: AppState,
	canonicalSessionId: string,
): Promise<ArtifactPromotionSummary> {
	const bridge = state.chitraguptaBridge.value;
	const artifacts = await listTrackedSessionArtifacts(state);
	if (artifacts.length === 0) {
		setArtifactPromotionState(state, { status: "idle" });
		return readArtifactPromotionSummary(state);
	}

	const importedArtifactIds = artifacts
		.filter((artifact) => isArtifactImportedForSession(artifact, canonicalSessionId))
		.map((artifact) => artifact.artifactId);
	const pendingArtifacts = artifacts.filter((artifact) => !isArtifactImportedForSession(artifact, canonicalSessionId));
	if (pendingArtifacts.length === 0) {
		setArtifactPromotionState(state, {
			status: "ready",
			pendingArtifactIds: [],
			importedArtifactIds,
			lastError: undefined,
		});
		return readArtifactPromotionSummary(state);
	}

	setArtifactPromotionState(state, {
		status: "syncing",
		pendingArtifactIds: pendingArtifacts.map((artifact) => artifact.artifactId),
		importedArtifactIds,
		lastError: undefined,
	});

	if (!bridge?.isConnected) {
		setArtifactPromotionState(state, {
			status: "pending",
			pendingArtifactIds: pendingArtifacts.map((artifact) => artifact.artifactId),
			importedArtifactIds,
		});
		return readArtifactPromotionSummary(state);
	}

	const now = Date.now();
	try {
		const preparedArtifacts = await Promise.all(
			pendingArtifacts.map((artifact) => prepareArtifactForImport(state, artifact, canonicalSessionId)),
		);
		const batch = await bridge.artifactImportBatch(
			process.cwd(),
			"takumi",
			preparedArtifacts.map(toImportedArtifactInput),
			canonicalSessionId,
		);
		if (!batch) {
			setArtifactPromotionState(state, {
				status: "pending",
				pendingArtifactIds: preparedArtifacts.map((artifact) => artifact.artifactId),
				importedArtifactIds,
				lastError: "Artifact import is unavailable on the current Chitragupta transport.",
			});
			return readArtifactPromotionSummary(state);
		}

		const importedList = await bridge.artifactListImported(process.cwd(), "takumi", canonicalSessionId);
		const recordsByLocalId = new Map(
			(importedList?.items ?? []).map((record) => [record.localArtifactId, record] as const),
		);
		const recordsByContentHash = new Map(
			(importedList?.items ?? []).map((record) => [record.contentHash, record] as const),
		);
		const preparedById = new Map(preparedArtifacts.map((artifact) => [artifact.artifactId, artifact] as const));
		const importedIds = [...importedArtifactIds];
		const pendingIds: string[] = [];
		let firstError: string | undefined;

		for (const entry of batch.imported) {
			const artifact = preparedById.get(entry.localArtifactId);
			if (!artifact) continue;
			const record = recordsByLocalId.get(entry.localArtifactId);
			await markArtifactImported(
				artifact,
				record,
				canonicalSessionId,
				now,
				entry.canonicalArtifactId,
				entry.contentHash,
			);
			importedIds.push(entry.localArtifactId);
		}

		for (const entry of batch.skipped) {
			const artifact = preparedById.get(entry.localArtifactId);
			if (!artifact) continue;
			const record = recordsByLocalId.get(entry.localArtifactId) ?? recordsByContentHash.get(artifact.contentHash);
			if (!record) {
				pendingIds.push(entry.localArtifactId);
				firstError ??= `Artifact ${entry.localArtifactId} was skipped as duplicate but could not be resolved.`;
				continue;
			}
			await markArtifactImported(
				artifact,
				record,
				canonicalSessionId,
				now,
				record.canonicalArtifactId,
				record.contentHash,
			);
			importedIds.push(entry.localArtifactId);
		}

		for (const entry of batch.failed) {
			if (!entry.localArtifactId) {
				firstError ??= entry.error;
				continue;
			}
			const artifact = preparedById.get(entry.localArtifactId);
			if (!artifact) continue;
			await artifactStore.updateImportState(entry.localArtifactId, {
				promoted: false,
				canonicalSessionId,
				importStatus: "failed",
				lastImportAt: now,
				lastImportError: entry.error,
			});
			pendingIds.push(entry.localArtifactId);
			firstError ??= entry.error;
		}

		setArtifactPromotionState(state, {
			status: pendingIds.length > 0 ? "failed" : "ready",
			pendingArtifactIds: pendingIds,
			importedArtifactIds: uniqueArtifactIds(importedIds),
			lastPromotionAt: now,
			lastError: pendingIds.length > 0 ? firstError : undefined,
		});
		return readArtifactPromotionSummary(state);
	} catch (error) {
		const message = (error as Error).message;
		await Promise.all(
			pendingArtifacts.map((artifact) =>
				artifactStore.updateImportState(artifact.artifactId, {
					promoted: false,
					canonicalSessionId,
					importStatus: "failed",
					lastImportAt: now,
					lastImportError: message,
				}),
			),
		);
		setArtifactPromotionState(state, {
			status: "failed",
			pendingArtifactIds: pendingArtifacts.map((artifact) => artifact.artifactId),
			importedArtifactIds,
			lastPromotionAt: now,
			lastError: message,
		});
		return readArtifactPromotionSummary(state);
	}
}

async function listTrackedSessionArtifacts(state: AppState): Promise<StoredArtifact[]> {
	const sessionIds = uniqueArtifactIds([state.sessionId.value, state.canonicalSessionId.value].filter(Boolean));
	const seen = new Map<string, StoredArtifact>();
	const queries = sessionIds.length > 0 ? sessionIds : [undefined];
	for (const sessionId of queries) {
		const artifacts = await artifactStore.query({ sessionId });
		for (const artifact of artifacts) {
			seen.set(artifact.artifactId, artifact);
		}
	}
	return [...seen.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function isArtifactImportedForSession(artifact: StoredArtifact, canonicalSessionId?: string): boolean {
	return (
		artifact.importStatus === "imported" &&
		artifact.promoted === true &&
		typeof artifact.canonicalArtifactId === "string" &&
		artifact.canonicalArtifactId.length > 0 &&
		(!canonicalSessionId || artifact.canonicalSessionId === canonicalSessionId)
	);
}

async function prepareArtifactForImport(
	state: AppState,
	artifact: StoredArtifact,
	canonicalSessionId: string,
): Promise<StoredArtifact> {
	const localSessionId = artifact.localSessionId ?? artifact._sessionId ?? state.sessionId.value ?? undefined;
	const runId = artifact.runId ?? artifact.taskId;
	const contentHash =
		artifact.contentHash ||
		createArtifactContentHash({
			kind: artifact.kind,
			producer: artifact.producer,
			summary: artifact.summary,
			body: artifact.body,
			path: artifact.path,
			createdAt: artifact.createdAt,
			taskId: artifact.taskId,
			laneId: artifact.laneId,
		});
	const preparedArtifact: StoredArtifact = {
		...artifact,
		contentHash,
		runId,
		localSessionId,
		canonicalSessionId,
	};
	await artifactStore.save(preparedArtifact, artifact._sessionId);
	return preparedArtifact;
}

function toImportedArtifactInput(artifact: StoredArtifact): ImportedArtifactInput {
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

async function markArtifactImported(
	artifact: StoredArtifact,
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
		localSessionId: artifact.localSessionId ?? artifact._sessionId,
		runId: artifact.runId ?? artifact.taskId,
		contentHash,
		importStatus: "imported",
		lastImportAt: importedAt,
		lastImportError: undefined,
	});
	if (!record?.localSessionId || artifact.localSessionId) return;
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
		artifact._sessionId,
	);
}

function setArtifactPromotionState(state: AppState, patch: Partial<SessionArtifactPromotionState>): void {
	const nextState: SessionArtifactPromotionState = {
		status: "idle",
		...state.artifactPromotion.value,
		...patch,
	};
	for (const [key, value] of Object.entries(patch) as Array<
		[keyof SessionArtifactPromotionState, SessionArtifactPromotionState[keyof SessionArtifactPromotionState]]
	>) {
		if (value === undefined) {
			delete nextState[key];
		}
	}
	state.artifactPromotion.value = nextState;
}

function uniqueArtifactIds(ids: string[]): string[] {
	return [...new Set(ids.filter(Boolean))];
}
