import type {
	CapabilityDescriptor,
	CapabilityHealthSnapshot,
	ChitraguptaHealth,
	RoutingDecision,
} from "@takumi/bridge";

export type ScarlettIntegrityState = "healthy" | "warning" | "critical";

export interface ScarlettIntegrityFinding {
	source: "bridge" | "capability" | "routing" | "anomaly" | "auth" | "health";
	severity: ScarlettIntegrityState;
	message: string;
}

export interface ScarlettIntegrityReport {
	status: ScarlettIntegrityState;
	summary: string;
	findings: ScarlettIntegrityFinding[];
	observedCapabilities: number;
	observedSnapshots: number;
	degradedCapabilities: string[];
	downCapabilities: string[];
	authFailureCount: number;
	degradedRouteCount: number;
	observedAt: number;
}

export interface BuildScarlettIntegrityReportInput {
	connected: boolean;
	capabilities: CapabilityDescriptor[];
	snapshots: CapabilityHealthSnapshot[];
	routingDecisions: RoutingDecision[];
	anomaly?: {
		severity: string;
		details: string;
		suggestion: string | null;
	} | null;
	health?: ChitraguptaHealth | null;
	now?: number;
}

const SEVERITY_RANK: Record<ScarlettIntegrityState, number> = {
	healthy: 0,
	warning: 1,
	critical: 2,
};

function escalate(current: ScarlettIntegrityState, next: ScarlettIntegrityState): ScarlettIntegrityState {
	return SEVERITY_RANK[next] > SEVERITY_RANK[current] ? next : current;
}

function summarizeIds(ids: string[]): string {
	if (ids.length === 0) {
		return "none";
	}
	if (ids.length <= 3) {
		return ids.join(", ");
	}
	return `${ids.slice(0, 3).join(", ")}, +${ids.length - 3} more`;
}

export function buildScarlettIntegrityReport(input: BuildScarlettIntegrityReportInput): ScarlettIntegrityReport {
	const findings: ScarlettIntegrityFinding[] = [];
	let status: ScarlettIntegrityState = "healthy";
	const now = input.now ?? Date.now();
	const downCapabilities = input.snapshots
		.filter((snapshot) => snapshot.state === "down")
		.map((snapshot) => snapshot.capabilityId);
	const degradedCapabilities = input.snapshots
		.filter((snapshot) => snapshot.state === "degraded")
		.map((snapshot) => snapshot.capabilityId);
	const authFailureCount = input.snapshots.reduce((total, snapshot) => total + (snapshot.authFailures ?? 0), 0);
	const degradedRouteCount = input.routingDecisions.filter((decision) => decision.degraded).length;
	const unresolvedRouteCount = input.routingDecisions.filter((decision) => decision.selected === null).length;

	if (!input.connected) {
		status = escalate(status, "critical");
		findings.push({
			source: "bridge",
			severity: "critical",
			message: "Chitragupta bridge is disconnected",
		});
	}

	if (input.connected && input.capabilities.length === 0) {
		status = escalate(status, "warning");
		findings.push({
			source: "capability",
			severity: "warning",
			message: "Capability inventory has not been observed yet",
		});
	}

	if (input.connected && input.snapshots.length === 0) {
		status = escalate(status, "warning");
		findings.push({
			source: "health",
			severity: "warning",
			message: "Capability health snapshots are missing",
		});
	}

	if (downCapabilities.length > 0) {
		status = escalate(status, "critical");
		findings.push({
			source: "capability",
			severity: "critical",
			message: `Capabilities down: ${summarizeIds(downCapabilities)}`,
		});
	}

	if (degradedCapabilities.length > 0) {
		status = escalate(status, "warning");
		findings.push({
			source: "capability",
			severity: "warning",
			message: `Capabilities degraded: ${summarizeIds(degradedCapabilities)}`,
		});
	}

	if (authFailureCount > 0) {
		const severity: ScarlettIntegrityState = authFailureCount >= 3 ? "critical" : "warning";
		status = escalate(status, severity);
		findings.push({
			source: "auth",
			severity,
			message: `${authFailureCount} auth failure${authFailureCount === 1 ? "" : "s"} observed across capability snapshots`,
		});
	}

	if (degradedRouteCount > 0) {
		status = escalate(status, "warning");
		findings.push({
			source: "routing",
			severity: "warning",
			message: `${degradedRouteCount} recent routing decision${degradedRouteCount === 1 ? " was" : "s were"} marked degraded`,
		});
	}

	if (unresolvedRouteCount > 0) {
		status = escalate(status, "critical");
		findings.push({
			source: "routing",
			severity: "critical",
			message: `${unresolvedRouteCount} routing decision${unresolvedRouteCount === 1 ? " has" : "s have"} no selected capability`,
		});
	}

	if (input.anomaly) {
		const anomalySeverity = input.anomaly.severity === "critical" ? "critical" : "warning";
		status = escalate(status, anomalySeverity);
		findings.push({
			source: "anomaly",
			severity: anomalySeverity,
			message: input.anomaly.suggestion
				? `${input.anomaly.details} — suggestion: ${input.anomaly.suggestion}`
				: input.anomaly.details,
		});
	}

	if (typeof input.health?.dominant === "string" && input.health.dominant.toLowerCase() === "tamas") {
		status = escalate(status, "warning");
		findings.push({
			source: "health",
			severity: "warning",
			message: "Chitragupta health dominant state is tamas",
		});
	}

	const summary =
		status === "healthy"
			? "Scarlett sees a stable control plane."
			: status === "warning"
				? `Scarlett sees drift across ${findings.length} signal${findings.length === 1 ? "" : "s"}.`
				: `Scarlett sees integrity risk across ${findings.length} signal${findings.length === 1 ? "" : "s"}.`;

	return {
		status,
		summary,
		findings,
		observedCapabilities: input.capabilities.length,
		observedSnapshots: input.snapshots.length,
		degradedCapabilities,
		downCapabilities,
		authFailureCount,
		degradedRouteCount,
		observedAt: now,
	};
}

export function formatScarlettIntegrityReport(report: ScarlettIntegrityReport): string {
	const findings =
		report.findings.length === 0
			? "• none"
			: report.findings.map((finding) => `• [${finding.severity}] ${finding.source}: ${finding.message}`).join("\n");

	return [
		"## Scarlett Integrity",
		`• Status: ${report.status}`,
		`• Summary: ${report.summary}`,
		`• Observed capabilities: ${report.observedCapabilities}`,
		`• Capability snapshots: ${report.observedSnapshots}`,
		`• Degraded routes: ${report.degradedRouteCount}`,
		`• Auth failures: ${report.authFailureCount}`,
		"",
		"### Findings",
		findings,
	].join("\n");
}
