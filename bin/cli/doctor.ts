import type { TakumiConfig } from "@takumi/core";
import { ChitraguptaBridge } from "@takumi/bridge";
import { autoDetectAuth } from "./cli-auth.js";
import { cmdDaemon } from "./daemon.js";
import { getDaemonStatus, type DaemonStatusSummary } from "./daemon-status.js";
import { loadDetachedJobs } from "./detached-jobs.js";
import { koshaProviders } from "./kosha-bridge.js";
import { canSkipApiKey } from "./provider.js";

export type DoctorSeverity = "ok" | "warn" | "fail";

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
	generatedAt?: number;
}

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
		warnings.push("Kosha did not report any authenticated providers.");
		fixes.push("Refresh CLI auth (`gh auth login`, `claude login`, or provider env vars) so Kosha can discover live credentials.");
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
		overall,
		warnings,
		fixes: Array.from(new Set(fixes)),
	};
}

export function formatDoctorReport(report: DoctorReport): string {
	const lines = [
		`Takumi Doctor — ${report.overall.toUpperCase()}`,
		"",
		`Version:           ${report.version}`,
		`Workspace:         ${report.workspace}`,
		`Provider / Model:  ${report.provider} / ${report.model}`,
		`Auth:              ${report.auth.ready ? "ready" : "missing"} (${report.auth.source})`,
		`Daemon:            ${report.daemon.healthy ? "healthy" : "degraded"}${report.daemon.pid ? ` (pid ${report.daemon.pid})` : ""}`,
		`Kosha providers:   ${report.kosha.authenticatedProviders}/${report.kosha.totalProviders} authenticated`,
		`Active instances:  ${report.telemetry.activeInstances} (${report.telemetry.working} working, ${report.telemetry.waitingInput} waiting)` ,
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

export async function collectDoctorReport(config: TakumiConfig, version: string): Promise<DoctorReport> {
	const detectedAuth = await autoDetectAuth();
	const daemon = await getDaemonStatus();
	const providers = await koshaProviders().catch(() => []);
	const jobs = await loadDetachedJobs();
	const bridge = new ChitraguptaBridge();
	const telemetry = await bridge.telemetrySnapshot().catch(() => null);

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
		workspace: process.cwd(),
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
	});
}

export async function applyDoctorFixes(report: DoctorReport): Promise<string[]> {
	const applied: string[] = [];
	if (!report.daemon.healthy) {
		await cmdDaemon("start");
		applied.push("Started Chitragupta daemon");
	}
	return applied;
}

export async function resolveDoctorReport(
	config: TakumiConfig,
	version: string,
	applyFixes = false,
): Promise<DoctorReport> {
	const initialReport = await collectDoctorReport(config, version);
	const appliedFixes = applyFixes ? await applyDoctorFixes(initialReport) : [];
	const report = applyFixes ? await collectDoctorReport(config, version) : initialReport;

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