import { createLogger } from "@takumi/core";
import type { AppState } from "../state.js";

const log = createLogger("coding-agent");

/** I persist Sabha executor confidence snapshots without bloating the main coding-agent runtime. */
export async function recordSabhaExecutorOutcome(
	state: AppState,
	sessionId: string,
	confidence: number,
): Promise<void> {
	const sabhaId = state.lastSabhaId.value;
	const observer = state.chitraguptaObserver.value;
	if (!sabhaId || !observer) return;
	try {
		await observer.sabhaRecord({
			id: sabhaId,
			sessionId,
			project: process.cwd(),
			category: "executor-run",
			confidence,
		});
	} catch (error) {
		log.debug(`Failed to record Sabha executor outcome: ${(error as Error).message}`);
	}
}
