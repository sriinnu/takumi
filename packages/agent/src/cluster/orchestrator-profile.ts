/**
 * Orchestrator profile-routing helpers.
 *
 * Extracted from ClusterOrchestrator to keep orchestrator.ts within the
 * 450-line LOC guard. Provides Lucy's profile-biased topology selection
 * and capability-aware model routing, both powered by AgentProfileStore.
 */

import { createLogger } from "@takumi/core";
import type { AgentProfileStore } from "./agent-identity.js";
import type { AgentRole, ClusterTopology } from "./types.js";

const log = createLogger("orchestrator-profile");

// ── Topology bias ────────────────────────────────────────────────────────────

/**
 * Lucy topology bias — nudges the proposed topology toward the historically
 * best-performing one based on profile win-rates.
 *
 * Conditions before overriding:
 * - The winning topology must have at least 3 recorded runs.
 * - Win rate must be ≥ 65%.
 * - The winner must differ from the proposed topology.
 */
export function lucyBiasTopology(proposed: ClusterTopology, store: AgentProfileStore): ClusterTopology {
	const rates = store.topologyRates();
	const qualified = rates.filter((r) => r.total >= 3 && r.winRate >= 0.65);
	if (qualified.length === 0) return proposed;

	const best = qualified[0];
	if (best.topology === proposed) return proposed;

	log.info(
		`Lucy profile-biased topology: ${proposed} → ${best.topology} ` +
			`(win=${(best.winRate * 100).toFixed(0)}% n=${best.total})`,
	);
	return best.topology as ClusterTopology;
}

// ── Profile-aware model routing ──────────────────────────────────────────────

/**
 * Return the best model for a given agent role.
 *
 * Priority: explicit modelOverrides → profile-store best match → undefined.
 *
 * When the store is consulted, inferred task capabilities are used to bias
 * selection toward agents that have performed well on similar work.
 */
export function getProfileBiasedModel(
	role: AgentRole,
	overrides: Partial<Record<AgentRole, string>> | undefined,
	store: AgentProfileStore,
	taskDescription: string,
): string | undefined {
	if (overrides?.[role]) return overrides[role];
	const caps = inferRoutingCaps(taskDescription);
	return store.bestModelForRole(role, caps);
}

// ── Capability inference (lightweight, no classifier dependency) ─────────────

export function inferRoutingCaps(description: string): string[] {
	const caps: string[] = [];
	if (/test|spec|tdd/i.test(description)) caps.push("testing");
	if (/security|auth|cve|vuln/i.test(description)) caps.push("security");
	if (/refactor|clean|modular/i.test(description)) caps.push("refactoring");
	if (/typescript|ts\b/i.test(description)) caps.push("typescript");
	if (/python|py\b/i.test(description)) caps.push("python");
	if (/react|component|jsx/i.test(description)) caps.push("react");
	if (/bug|fix|debug/i.test(description)) caps.push("debugging");
	if (/perf|optimi|fast/i.test(description)) caps.push("performance");
	return caps;
}
