import type { ClusterOrchestrator } from "@takumi/agent";

/** I collapse the latest checkpoint-compatibility state into one operator-facing note. */
export function buildResumeCompatibilitySummary(orchestrator: ClusterOrchestrator | null): string | null {
	const compatibility = orchestrator?.getLastResumeCompatibility();
	return compatibility?.summary ? [compatibility.summary, ...compatibility.warnings].filter(Boolean).join("\n") : null;
}
