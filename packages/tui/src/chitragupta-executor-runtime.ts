import type { ObservationEvent } from "@takumi/bridge";
import { createLogger } from "@takumi/core";
import type { AppState } from "./state.js";

const log = createLogger("chitragupta-executor-runtime");

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
