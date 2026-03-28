import { join } from "node:path";
import { auditSideAgentRuntime, repairPersistedSideAgentRegistry, type SideAgentRuntimeAudit } from "@takumi/agent";
import type { TakumiConfig } from "@takumi/core";
import { ChitraguptaBridge } from "@takumi/bridge";
import { autoDetectAuth, collectFastProviderStatus } from "./cli-auth.js";
import { cmdDaemon } from "./daemon.js";
import { getDaemonStatus, type DaemonStatusSummary } from "./daemon-status.js";
import { loadDetachedJobs } from "./detached-jobs.js";
import { canSkipApiKey } from "./provider.js";
import { resolveSideAgentStateDir, type SideAgentBootstrapStatus } from "./side-agent-tools.js";
import { collectRuntimeBootstrap } from "./runtime-bootstrap.js";

export type DoctorSeverity = "ok" | "warn" | "fail";

/**
 * I separate side-agent bootstrap readiness from runtime drift so diagnostics
 * can stay explicit about whether the problem is startup prerequisites or
 * persisted lane state.
 */
export interface DoctorSideAgentReport {
	bootstrap: SideAgentBootstrapStatus;
	audit: SideAgentRuntimeAudit | null;
	auditError?: string;
}

export interface DoctorReport {
	version: string;
	generatedAt: number;
	workspace: string;
	provider: string;
	model: string;
	auth: {
		ready: boolean;
		source: string;
		canSkipApiKey: boolean;
	};
	daemon: DaemonStatusSummary;
	kosha: {
		totalProviders: number;
		authenticatedProviders: number;
		authenticatedIds: string[];
	};
	telemetry: {
		activeInstances: number;
		working: number;
		waitingInput: number;
		atLimit: number;
		nearLimit: number;
	};
	detachedJobs: {
		total: number;
		running: number;
	};
	sideAgents: DoctorSideAgentReport;
	overall: DoctorSeverity;
	warnings: string[];
	fixes: string[];
}

export interface BuildDoctorReportInput {
	version: string;
	workspace: string;
	provider: string;
	model: string;
	auth: DoctorReport["auth"];
	daemon: DaemonStatusSummary;
	kosha: DoctorReport["kosha"];
	telemetry: DoctorReport["telemetry"];
	detachedJobs: DoctorReport["detachedJobs"];
	sideAgents: DoctorReport["sideAgents"];
	generatedAt?: number;
}

export interface DoctorCollectionOptions {
	sideAgentAuditMaxAgeMs?: number;
}

interface CachedSideAgentAudit {
	audit: SideAgentRuntimeAudit | null;
	auditError?: string;
	capturedAt: number;
}

const SIDE_AGENT_AUDIT_CACHE = new Map<string, CachedSideAgentAudit>();

export function buildDoctorReport(input: BuildDoctorReportInput): DoctorReport {
	const warnings: string[] = [];
	const fixes: string[] = [];
	let overall: DoctorSeverity = "ok";

	if (!input.auth.ready) {
		overall = "fail";
		warnings.push("No usable auth path detected for the current provider configuration.");
		fixes.push("Authenticate a provider CLI or set an API key / proxy before running interactive sessions.");
	}

	if (!input.daemon.healthy) {
		if (overall !== "fail") overall = "warn";
		warnings.push("Chitragupta daemon is not fully healthy; control-plane features may degrade.");
		fixes.push("Run `takumi daemon start` or `takumi doctor --fix` to restore the daemon.");
	}

	if (input.kosha.authenticatedProviders === 0) {
		if (overall !== "fail") overall = "warn";
		warnings.push("Fast provider discovery did not find any authenticated providers.");
		fixes.push("Refresh CLI auth (`gh auth login`, `claude login`, or provider env vars) so Takumi can resolve a live runtime path.");
	}

	if (input.telemetry.atLimit > 0) {
		if (overall !== "fail") overall = "warn";
		warnings.push("One or more active Takumi instances are at context limit.");
		fixes.push("Compact or conclude the saturated sessions before starting new heavy runs.");
	}

	if (input.telemetry.nearLimit > 0 && input.telemetry.atLimit === 0) {
		if (overall === "ok") overall = "warn";
		warnings.push("One or more active Takumi instances are near context limit.");
		fixes.push("Watch active sessions and compact early to avoid context cliffs.");
	}

	if (input.sideAgents.bootstrap.degraded) {
		if (overall === "ok") overall = "warn";
		warnings.push(`Side-agent runtime is degraded: ${input.sideAgents.bootstrap.summary}.`);
		fixes.push(sideAgentBootstrapFixFor(input.sideAgents.bootstrap));
	}

	if (input.sideAgents.auditError) {
		if (overall === "ok") overall = "warn";
		warnings.push(`Side-agent audit could not complete: ${input.sideAgents.auditError}.`);
		fixes.push("Rerun `takumi doctor` after confirming git metadata and tmux are reachable from this shell.");
	}

	if (input.sideAgents.audit) {
		const audit = input.sideAgents.audit;
		const failCount = audit.issues.filter((issue) => issue.severity === "fail").length;
		if (failCount > 0) {
			overall = "fail";
		} else if (audit.issues.length > 0 && overall === "ok") {
			overall = "warn";
		}
		if (audit.issues.length > 0) {
			warnings.push(sideAgentAuditWarning(audit));
			for (const fix of sideAgentAuditFixes(audit)) {
				fixes.push(fix);
			}
		}
	}

	return {
		version: input.version,
		generatedAt: input.generatedAt ?? Date.now(),
		workspace: input.workspace,
		provider: input.provider,
		model: input.model,
		auth: input.auth,
		daemon: input.daemon,
		kosha: input.kosha,
		telemetry: input.telemetry,
		detachedJobs: input.detachedJobs,
		sideAgents: input.sideAgents,
		overall,
		warnings,
		fixes: Array.from(new Set(fixes)),
	};
}

/**
 * I keep side-agent remediation specific so doctor output points to the next
 * concrete operator action instead of another vague bootstrap message.
 */
function sideAgentBootstrapFixFor(status: SideAgentBootstrapStatus): string {
	if (status.reason === "tmux_unavailable") {
		return "Install tmux and make sure `tmux -V` succeeds in the same shell Takumi uses.";
	}
	return "Repair the side-agent runtime prerequisites and rerun `takumi doctor`.";
}

function sideAgentAuditWarning(audit: SideAgentRuntimeAudit): string {
	const registryIssues = countAuditIssues(audit, REGISTRY_AUDIT_CODES);
	const liveIssues = countAuditIssues(audit, LIVE_AUDIT_CODES);
	const residueIssues = countAuditIssues(audit, RESIDUAL_AUDIT_CODES);
	const parts = [`${audit.issues.length} issue(s)`];
	if (liveIssues > 0) parts.push(`${liveIssues} live mismatch${liveIssues === 1 ? "" : "es"}`);
	if (registryIssues > 0) parts.push(`${registryIssues} registry inconsisten${registryIssues === 1 ? "cy" : "cies"}`);
	if (residueIssues > 0) parts.push(`${residueIssues} residual resource issue${residueIssues === 1 ? "" : "s"}`);
	return `Side-agent audit found ${parts.join(", ")}.`;
}

function sideAgentAuditFixes(audit: SideAgentRuntimeAudit): string[] {
	const fixes: string[] = [];
	if (countAuditIssues(audit, LIVE_AUDIT_CODES) > 0) {
		fixes.push("Inspect and stop the affected live side agents before starting new lanes; git/tmux state drifted from the registry.");
	}
		if (countAuditIssues(audit, REGISTRY_AUDIT_CODES) > 0) {
			fixes.push("Run `takumi side-agents inspect` to review persisted registry drift, then `takumi side-agents repair` to rewrite retained normalized rows.");
		}
	if (countAuditIssues(audit, RESIDUAL_AUDIT_CODES) > 0) {
		fixes.push(
			"Run a normal Takumi session in this repo so side-agent bootstrap can reconcile leaked worktrees or tmux windows, then rerun `takumi doctor`.",
		);
	}
	return fixes;
}

function countAuditIssues(audit: SideAgentRuntimeAudit, codes: ReadonlySet<string>): number {
	return audit.issues.filter((issue) => codes.has(issue.code)).length;
}

function formatSideAgentAuditSummary(audit: SideAgentRuntimeAudit | null, auditError?: string): string {
	if (auditError) {
		return `unavailable (${auditError})`;
	}
	if (!audit) {
		return "not applicable";
	}
	return [
		`${audit.registry.totalEntries} persisted`,
		`${audit.activeAgents} active`,
		`${audit.terminalAgents} terminal`,
		`${audit.issues.length} issue(s)`,
		`${audit.orphanedWorktrees.length} orphaned`,
		`tmux ${audit.tmuxInspected ? "checked" : "skipped"}`,
	].join(", ");
}

export function formatDoctorReport(report: DoctorReport): string {
	const sideAgentState = report.sideAgents.bootstrap.degraded
		? "degraded"
		: report.sideAgents.bootstrap.enabled
			? "ready"
			: "disabled";
	const lines = [
		`Takumi Doctor — ${report.overall.toUpperCase()}`,
		"",
		`Version:           ${report.version}`,
		`Workspace:         ${report.workspace}`,
		`Provider / Model:  ${report.provider} / ${report.model}`,
		`Auth:              ${report.auth.ready ? "ready" : "missing"} (${report.auth.source})`,
		`Daemon:            ${report.daemon.healthy ? "healthy" : "degraded"}${report.daemon.pid ? ` (pid ${report.daemon.pid})` : ""}`,
		`Providers:         ${report.kosha.authenticatedProviders}/${report.kosha.totalProviders} authenticated`,
		`Side agents:       ${sideAgentState} (${report.sideAgents.bootstrap.summary})`,
		`Side-agent audit:  ${formatSideAgentAuditSummary(report.sideAgents.audit, report.sideAgents.auditError)}`,
		`Active instances:  ${report.telemetry.activeInstances} (${report.telemetry.working} working, ${report.telemetry.waitingInput} waiting)`,
		`Detached jobs:     ${report.detachedJobs.running}/${report.detachedJobs.total} running`,
	];

	if (report.kosha.authenticatedIds.length > 0) {
		lines.push(`Authenticated IDs: ${report.kosha.authenticatedIds.join(", ")}`);
	}

	if (report.warnings.length > 0) {
		lines.push("", "Warnings:");
		for (const warning of report.warnings) {
			lines.push(`  - ${warning}`);
		}
	} else {
		lines.push("", "Warnings:", "  - none. CLI looks crisp.");
	}

	if (report.fixes.length > 0) {
		lines.push("", "Fixes:");
		for (const fix of report.fixes) {
			lines.push(`  - ${fix}`);
		}
	}

	return lines.join("\n");
}

export async function collectDoctorReport(
	config: TakumiConfig,
	version: string,
	options: DoctorCollectionOptions = {},
): Promise<DoctorReport> {
	const cwd = process.cwd();
	const [detectedAuth, daemon, providers, jobs, telemetry, runtimeBootstrap] = await Promise.all([
		autoDetectAuth(),
		getDaemonStatus(),
		collectFastProviderStatus().catch(() => []),
		loadDetachedJobs(),
		new ChitraguptaBridge().telemetrySnapshot().catch(() => null),
		collectRuntimeBootstrap(config, { cwd }),
	]);
	const sideAgentBootstrap = runtimeBootstrap.sideAgents;
	const sideAgents = await collectDoctorSideAgentReport(config, cwd, sideAgentBootstrap, options);

	const canSkip = canSkipApiKey(config);
	const authReady = Boolean(config.apiKey || config.proxyUrl || canSkip || detectedAuth);
	const authSource = config.proxyUrl
		? "proxy"
		: config.apiKey
			? "explicit api key"
			: canSkip
				? "local endpoint"
				: detectedAuth?.source ?? "not found";

	return buildDoctorReport({
		version,
		workspace: cwd,
		provider: config.provider,
		model: config.model,
		auth: {
			ready: authReady,
			source: authSource,
			canSkipApiKey: canSkip,
		},
		daemon,
		kosha: {
			totalProviders: providers.length,
			authenticatedProviders: providers.filter((provider) => provider.authenticated || provider.id === "ollama").length,
			authenticatedIds: providers
				.filter((provider) => provider.authenticated || provider.id === "ollama")
				.map((provider) => provider.id)
				.sort(),
		},
		telemetry: {
			activeInstances: telemetry?.counts.total ?? 0,
			working: telemetry?.counts.working ?? 0,
			waitingInput: telemetry?.counts.waiting_input ?? 0,
			atLimit: telemetry?.context.atLimit ?? 0,
			nearLimit: telemetry?.context.nearLimit ?? 0,
		},
		detachedJobs: {
			total: jobs.length,
			running: jobs.filter((job) => job.status !== "stopped" && job.status !== "exited").length,
		},
		sideAgents,
	});
}

async function collectDoctorSideAgentReport(
	config: TakumiConfig,
	cwd: string,
	bootstrap: SideAgentBootstrapStatus,
	options: DoctorCollectionOptions,
): Promise<DoctorSideAgentReport> {
	if (bootstrap.reason === "not_git_repo") {
		return { bootstrap, audit: null };
	}
	const cacheKey = [cwd, config.sideAgent?.worktreeDir ?? "", bootstrap.reason].join("|");
	const cacheTtlMs = options.sideAgentAuditMaxAgeMs ?? 0;
	if (cacheTtlMs > 0) {
		const cached = SIDE_AGENT_AUDIT_CACHE.get(cacheKey);
		if (cached && Date.now() - cached.capturedAt <= cacheTtlMs) {
			return { bootstrap, audit: cached.audit, auditError: cached.auditError };
		}
	}
	try {
			const audit = await auditSideAgentRuntime({
				repoRoot: cwd,
				registryBaseDir: resolveSideAgentStateDir(cwd),
			worktreeBaseDir: config.sideAgent?.worktreeDir,
			defaultTmuxSessionName: "takumi-side-agents",
			tmuxAvailable: bootstrap.reason === "enabled" ? true : bootstrap.reason === "tmux_unavailable" ? false : undefined,
		});
		if (cacheTtlMs > 0) {
			SIDE_AGENT_AUDIT_CACHE.set(cacheKey, { audit, capturedAt: Date.now() });
		}
		return { bootstrap, audit };
	} catch (error) {
		const auditError = error instanceof Error ? error.message : String(error);
		if (cacheTtlMs > 0) {
			SIDE_AGENT_AUDIT_CACHE.set(cacheKey, { audit: null, auditError, capturedAt: Date.now() });
		}
		return { bootstrap, audit: null, auditError };
	}
}

const REGISTRY_AUDIT_CODES = new Set([
	"registry_read_failed",
	"registry_parse_failed",
	"registry_entry_malformed",
	"registry_entry_normalized",
]);
const AUTO_REPAIR_AUDIT_CODES = new Set(["registry_parse_failed", "registry_entry_malformed", "registry_entry_normalized"]);
const LIVE_AUDIT_CODES = new Set([
	"live_metadata_incomplete",
	"live_worktree_missing",
	"live_tmux_missing",
	"live_branch_drift",
]);
const RESIDUAL_AUDIT_CODES = new Set(["terminal_worktree_residual", "terminal_tmux_residual", "orphaned_worktree"]);

export interface DoctorFixDependencies {
	startDaemon(): Promise<void>;
	repairSideAgentRegistry(baseDir: string): Promise<{ changed: boolean; mode: string }>;
}

const DEFAULT_DOCTOR_FIX_DEPENDENCIES: DoctorFixDependencies = {
	startDaemon: () => cmdDaemon("start"),
	repairSideAgentRegistry: repairPersistedSideAgentRegistry,
};

export async function applyDoctorFixes(
	report: DoctorReport,
	dependencies: DoctorFixDependencies = DEFAULT_DOCTOR_FIX_DEPENDENCIES,
): Promise<string[]> {
	const applied: string[] = [];
	if (!report.daemon.healthy) {
		await dependencies.startDaemon();
		applied.push("Started Chitragupta daemon");
	}
	if (shouldAutoRepairSideAgentRegistry(report.sideAgents)) {
		const result = await dependencies.repairSideAgentRegistry(resolveSideAgentStateDir(report.workspace));
		if (result.changed) {
			applied.push(`Repaired side-agent registry (${result.mode})`);
		}
	}
	return applied;
}

function shouldAutoRepairSideAgentRegistry(report: DoctorSideAgentReport): boolean {
	if (!report.audit || report.auditError) {
		return false;
	}
	if (countAuditIssues(report.audit, LIVE_AUDIT_CODES) > 0) {
		return false;
	}
	if (countAuditIssues(report.audit, RESIDUAL_AUDIT_CODES) > 0) {
		return false;
	}
	return countAuditIssues(report.audit, AUTO_REPAIR_AUDIT_CODES) > 0;
}

export async function resolveDoctorReport(
	config: TakumiConfig,
	version: string,
	applyFixes = false,
	options: DoctorCollectionOptions = {},
): Promise<DoctorReport> {
	const initialReport = await collectDoctorReport(config, version, options);
	const appliedFixes = applyFixes ? await applyDoctorFixes(initialReport) : [];
	const report = applyFixes ? await collectDoctorReport(config, version, options) : initialReport;

	return appliedFixes.length > 0 ? { ...report, fixes: [...appliedFixes, ...report.fixes] } : report;
}

export async function cmdDoctor(config: TakumiConfig, version: string, asJson = false, applyFixes = false): Promise<void> {
	const finalReport = await resolveDoctorReport(config, version, applyFixes);

	if (asJson) {
		console.log(JSON.stringify(finalReport, null, 2));
		return;
	}

	console.log(formatDoctorReport(finalReport));
}
