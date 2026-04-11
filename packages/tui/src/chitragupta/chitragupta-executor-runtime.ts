import type { ObservationEvent } from "@takumi/bridge";
import { type ArtifactKind, ArtifactStore, createHubArtifact, createLogger } from "@takumi/core";
import type { AppState } from "../state.js";

const log = createLogger("chitragupta-executor-runtime");
const artifactStore = new ArtifactStore();

function mapArtifactKind(kind: string): ArtifactKind {
	if (kind === "exec-result") return "exec_result";
	if (kind === "plan" || kind === "validation" || kind === "summary" || kind === "handoff" || kind === "postmortem") {
		return kind;
	}
	return "summary";
}

export function getBoundSessionId(state: AppState): string {
	return state.canonicalSessionId.value || state.sessionId.value || "transient";
}

export async function ensureCanonicalSessionBinding(state: AppState): Promise<string | null> {
	if (state.canonicalSessionId.value) {
		return state.canonicalSessionId.value;
	}

	const bridge = state.chitraguptaBridge.value;
	if (!bridge?.isConnected) {
		return null;
	}

	try {
		const result = await bridge.sessionCreate({
			project: process.cwd(),
			title: `Takumi ${new Date().toISOString()}`,
			agent: "takumi",
			model: state.model.value,
			provider: state.provider.value,
		});
		state.canonicalSessionId.value = result.id;
		return result.id;
	} catch (error) {
		log.debug(`Failed to bind canonical Chitragupta session: ${(error as Error).message}`);
		return null;
	}
}

export async function observeExecutorEvents(state: AppState, events: ObservationEvent[]): Promise<void> {
	for (const event of events) {
		if (event.type !== "executor_artifact") continue;
		try {
			const runId = typeof event.metadata?.runId === "string" ? event.metadata.runId : undefined;
			await artifactStore.save(
				createHubArtifact({
					kind: mapArtifactKind(event.artifactType),
					producer: "takumi.tui",
					summary: event.summary,
					path: event.path,
					taskId: runId,
					runId,
					localSessionId: event.sessionId,
					canonicalSessionId: state.canonicalSessionId.value || undefined,
					importStatus: "pending",
					metadata: {
						projectPath: event.projectPath,
						...event.metadata,
					},
				}),
				event.sessionId,
			);
		} catch (error) {
			log.debug(`Failed to persist local artifact: ${(error as Error).message}`);
		}
	}

	const observer = state.chitraguptaObserver.value;
	if (!observer || events.length === 0) {
		return;
	}

	try {
		await observer.observeBatch(events);
	} catch (error) {
		log.debug(`Failed to observe executor events: ${(error as Error).message}`);
	}
}
