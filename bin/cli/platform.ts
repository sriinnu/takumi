import type { TakumiConfig } from "@takumi/core";
import type { DaemonStatusSummary } from "./daemon-status.js";
import { loadDetachedJobs, toDetachedJobView, type DetachedJobView } from "./detached-jobs.js";
import { formatDoctorReport, resolveDoctorReport, type DoctorReport, type DoctorSeverity } from "./doctor.js";
import { toSessionListEntry, type SessionListEntry } from "./session-commands.js";

export interface PlatformReport {
	version: string;
	generatedAt: number;
	workspace: string;
	overall: DoctorSeverity;
	doctor: DoctorReport;
	daemon: DaemonStatusSummary;
	sessions: SessionListEntry[];
	detachedJobs: DetachedJobView[];
	summary: {
		recentSessions: number;
		totalDetachedJobs: number;
		runningDetachedJobs: number;
		authenticatedProviders: number;
		totalProviders: number;
		daemonHealthy: boolean;
	};
}

export interface BuildPlatformReportInput {
	doctor: DoctorReport;
	sessions: SessionListEntry[];
	detachedJobs: DetachedJobView[];
	generatedAt?: number;
}

export function buildPlatformReport(input: BuildPlatformReportInput): PlatformReport {
	const runningDetachedJobs = input.detachedJobs.filter((job) => job.state === "running").length;
	return {
		version: input.doctor.version,
		generatedAt: input.generatedAt ?? Date.now(),
		workspace: input.doctor.workspace,
		overall: input.doctor.overall,
		doctor: input.doctor,
		daemon: input.doctor.daemon,
		sessions: input.sessions,
		detachedJobs: input.detachedJobs,
		summary: {
			recentSessions: input.sessions.length,
			totalDetachedJobs: input.detachedJobs.length,
			runningDetachedJobs,
			authenticatedProviders: input.doctor.kosha.authenticatedProviders,
			totalProviders: input.doctor.kosha.totalProviders,
			daemonHealthy: input.doctor.daemon.healthy,
		},
	};
}

export function formatPlatformReport(report: PlatformReport): string {
	const lines = [
		`Takumi Platform — ${report.overall.toUpperCase()}`,
		"",
		`Workspace:         ${report.workspace}`,
		`Daemon:            ${report.summary.daemonHealthy ? "healthy" : "degraded"}`,
		`Providers:         ${report.summary.authenticatedProviders}/${report.summary.totalProviders} authenticated`,
		`Detached jobs:     ${report.summary.runningDetachedJobs}/${report.summary.totalDetachedJobs} running`,
		`Recent sessions:   ${report.summary.recentSessions}`,
		"",
		"Doctor:",
		...formatDoctorReport(report.doctor)
			.split("\n")
			.map((line) => `  ${line}`),
	];

	if (report.sessions.length > 0) {
		lines.push("", "Recent sessions:");
		for (const session of report.sessions) {
			lines.push(
				`  - ${session.id} | ${session.model} | ${session.messageCount} msg | ${session.updatedAge}${session.title ? ` | ${session.title}` : ""}`,
			);
		}
	} else {
		lines.push("", "Recent sessions:", "  - none");
	}

	if (report.detachedJobs.length > 0) {
		lines.push("", "Detached jobs:");
		for (const job of report.detachedJobs) {
			lines.push(`  - ${job.id} | ${job.state} | pid ${job.pid} | ${job.logFile}`);
		}
	} else {
		lines.push("", "Detached jobs:", "  - none");
	}

	return lines.join("\n");
}

export async function collectPlatformReport(
	config: TakumiConfig,
	version: string,
	applyFixes = false,
): Promise<PlatformReport> {
	const doctor = await resolveDoctorReport(config, version, applyFixes);
	const [{ listSessions }, jobs] = await Promise.all([import("@takumi/core"), loadDetachedJobs()]);
	const sessions = (await listSessions(5)).map(toSessionListEntry);
	const detachedJobs = jobs.map(toDetachedJobView);

	return buildPlatformReport({
		doctor,
		sessions,
		detachedJobs,
	});
}

export async function cmdPlatform(
	config: TakumiConfig,
	version: string,
	asJson = false,
	applyFixes = false,
	mode?: string,
): Promise<void> {
	if (mode === "watch") {
		const { cmdPlatformWatch } = await import("./platform-watch.js");
		await cmdPlatformWatch(config, version, applyFixes);
		return;
	}
	const report = await collectPlatformReport(config, version, applyFixes);
	if (asJson) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}
	console.log(formatPlatformReport(report));
}