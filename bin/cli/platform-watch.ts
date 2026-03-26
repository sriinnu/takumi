import { ANSI } from "@takumi/core";
import type { TakumiConfig } from "@takumi/core";
import { formatDoctorReport } from "./doctor.js";
import { collectPlatformReport, type PlatformReport } from "./platform.js";

export interface PlatformWatchState {
	showDoctor: boolean;
	showSessions: boolean;
	showJobs: boolean;
	showHelp: boolean;
	focus: PlatformWatchSection;
	paused: boolean;
	lastMessage: string | null;
	lastRefreshAt: number;
	refreshing: boolean;
	fixesApplied: number;
	error: string | null;
}

export type PlatformWatchSection = "doctor" | "sessions" | "jobs";

export type PlatformWatchAction =
	| "quit"
	| "refresh"
	| "hard-refresh"
	| "fix"
	| "toggle-doctor"
	| "toggle-sessions"
	| "toggle-jobs"
	| "toggle-help"
	| "cycle-focus"
	| "toggle-focused"
	| "focus-doctor"
	| "focus-sessions"
	| "focus-jobs"
	| "pause"
	| "focus-first"
	| "focus-last"
	| null;

const REFRESH_MS = 2_000;
const SIDE_AGENT_AUDIT_CACHE_MS = 15_000;

export function decodePlatformWatchAction(input: Buffer | string): PlatformWatchAction {
	const value = typeof input === "string" ? input : input.toString("utf8");
	if (value === "\u0003" || value === "q" || value === "Q" || value === "\u001b") return "quit";
	if (value === "R") return "hard-refresh";
	if (value === "r") return "refresh";
	if (value === "f" || value === "F") return "fix";
	if (value === "d" || value === "D") return "toggle-doctor";
	if (value === "s" || value === "S") return "toggle-sessions";
	if (value === "j" || value === "J") return "toggle-jobs";
	if (value === "1") return "focus-doctor";
	if (value === "2") return "focus-sessions";
	if (value === "3") return "focus-jobs";
	if (value === "\t") return "cycle-focus";
	if (value === " ") return "toggle-focused";
	if (value === "p" || value === "P") return "pause";
	if (value === "g") return "focus-first";
	if (value === "G") return "focus-last";
	if (value === "?" || value === "h" || value === "H") return "toggle-help";
	return null;
}

export function formatPlatformWatchScreen(report: PlatformReport, state: PlatformWatchState, width = 120): string {
	const lines = [
		`${colorForOverall(report.overall)}Takumi Platform Watch${ANSI.RESET}  ${chipForOverall(report.overall)}  ${statusChip(
			report.daemon.healthy,
			"daemon",
		)}  ${providerChip(report.summary.authenticatedProviders, report.summary.totalProviders)}`,
		`${ANSI.DIM}updated ${new Date(report.generatedAt).toLocaleTimeString()} · refresh ${REFRESH_MS / 1000}s · ${
			state.paused ? "paused" : "live"
		} · focus ${state.focus} · q quit · r refresh · f fix · ? help${ANSI.RESET}`,
		"",
		`${label("workspace")} ${report.workspace}`,
		`${label("model")} ${report.doctor.provider} / ${report.doctor.model}`,
		`${label("side-agents")} ${report.summary.activeSideAgents} active · ${report.summary.sideAgentIssues} issue(s) · ${report.summary.orphanedSideAgentWorktrees} orphaned`,
		`${label("sessions")} ${report.summary.recentSessions} recent · ${report.doctor.telemetry.activeInstances} active instance(s) · ${report.doctor.telemetry.working} working`,
		`${label("jobs")} ${report.summary.runningDetachedJobs}/${report.summary.totalDetachedJobs} running · ${report.doctor.telemetry.waitingInput} waiting input`,
		`${label("warnings")} ${report.doctor.warnings.length} · ${report.doctor.fixes.length} suggested fix(es) · ${state.fixesApplied} applied this watch`,
	];

	if (state.lastMessage) {
		lines.push(`${label("note")} ${state.lastMessage}`);
	}
	if (state.error) {
		lines.push(`${ANSI.BOLD}\x1b[31merror${ANSI.RESET} ${state.error}`);
	}
	if (state.showHelp) {
		lines.push(
			"",
			`${ANSI.BOLD}Keys${ANSI.RESET}`,
			"  q / Esc / Ctrl+C  quit",
			"  r                 refresh now",
			"  R                 hard refresh + clear transient errors",
			"  f                 apply safe fixes then refresh",
			"  d                 toggle doctor details",
			"  s                 toggle recent sessions",
			"  j                 toggle detached jobs",
			"  1 / 2 / 3         focus doctor / sessions / jobs",
			"  Tab               cycle focus",
			"  Space             toggle the focused section",
			"  p                 pause or resume auto-refresh",
			"  g / G             jump focus to first / last section",
			"  ? / h             toggle this help",
		);
	}

	if (state.showDoctor) {
		lines.push("", renderSectionHeading("doctor", state.focus));
		for (const line of formatDoctorReport(report.doctor).split("\n")) {
			lines.push(`  ${line}`);
		}
	}

	if (state.showSessions) {
		lines.push("", renderSectionHeading("sessions", state.focus, "Recent Sessions"));
		if (report.sessions.length === 0) {
			lines.push("  none");
		} else {
			for (const session of report.sessions) {
				lines.push(
					`  ${session.id} · ${session.model} · ${session.messageCount} msg · ${session.updatedAge}${session.title ? ` · ${session.title}` : ""}`,
				);
			}
		}
	}

	if (state.showJobs) {
		lines.push("", renderSectionHeading("jobs", state.focus, "Detached Jobs"));
		if (report.detachedJobs.length === 0) {
			lines.push("  none");
		} else {
			for (const job of report.detachedJobs) {
				lines.push(`  ${job.id} · ${job.state} · pid ${job.pid} · ${job.logFile}`);
			}
		}
	}

	return lines.map((line) => truncateAnsiAware(line, width)).join("\n");
}

export async function cmdPlatformWatch(config: TakumiConfig, version: string, applyFixes = false): Promise<void> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		console.error("Platform watch requires an interactive TTY.");
		process.exit(1);
	}

	const state: PlatformWatchState = {
		showDoctor: true,
		showSessions: true,
		showJobs: true,
		showHelp: false,
		focus: "doctor",
		paused: false,
		lastMessage: applyFixes ? "Applying safe fixes on initial refresh…" : "Watch ready.",
		lastRefreshAt: 0,
		refreshing: false,
		fixesApplied: 0,
		error: null,
	};

	let report: PlatformReport | null = null;
	let running = true;
	let refreshTimer: NodeJS.Timeout | null = null;

	const cleanup = () => {
		if (refreshTimer) clearInterval(refreshTimer);
		process.stdin.off("data", onData);
		process.off("SIGINT", onSigint);
		process.off("SIGTERM", onSigint);
		if (typeof (process.stdin as NodeJS.ReadStream).setRawMode === "function") {
			(process.stdin as NodeJS.ReadStream).setRawMode(false);
		}
		process.stdout.write(ANSI.CURSOR_SHOW + ANSI.ALT_SCREEN_OFF);
	};

	const render = () => {
		if (!report) return;
		const width = process.stdout.columns ?? 120;
		process.stdout.write(ANSI.ALT_SCREEN_ON + ANSI.CURSOR_HIDE + ANSI.CLEAR_SCREEN + ANSI.CURSOR_HOME);
		process.stdout.write(formatPlatformWatchScreen(report, state, width));
		process.stdout.write("\n");
	};

		const refresh = async (withFixes = false, hard = false, allowCachedAudit = false) => {
			if (state.refreshing) return;
			state.refreshing = true;
			if (hard) {
				state.error = null;
				state.lastMessage = "Hard refresh requested…";
			} else {
				state.lastMessage = withFixes ? "Applying safe fixes…" : "Refreshing platform state…";
			}
			try {
				report = await collectPlatformReport(config, version, withFixes, {
					sideAgentAuditMaxAgeMs: allowCachedAudit ? SIDE_AGENT_AUDIT_CACHE_MS : 0,
				});
				state.lastRefreshAt = Date.now();
			if (withFixes) {
				state.fixesApplied += 1;
				state.lastMessage = "Refresh complete after safe fixes.";
			} else if (hard) {
				state.lastMessage = `Hard refresh complete at ${new Date(state.lastRefreshAt).toLocaleTimeString()}.`;
			} else {
				state.lastMessage = `Refresh complete at ${new Date(state.lastRefreshAt).toLocaleTimeString()}.`;
			}
		} catch (error) {
			state.error = (error as Error).message;
			state.lastMessage = "Refresh failed.";
		} finally {
			state.refreshing = false;
			render();
		}
	};

	const onData = (data: Buffer) => {
		const action = decodePlatformWatchAction(data);
		switch (action) {
			case "quit":
				running = false;
				cleanup();
				process.exit(0);
				break;
				case "refresh":
					void refresh(false, false, false);
					break;
				case "hard-refresh":
					void refresh(false, true, false);
					break;
				case "fix":
					void refresh(true, false, false);
					break;
			case "toggle-doctor":
				state.showDoctor = !state.showDoctor;
				state.lastMessage = `Doctor section ${state.showDoctor ? "shown" : "hidden"}.`;
				render();
				break;
			case "toggle-sessions":
				state.showSessions = !state.showSessions;
				state.lastMessage = `Sessions section ${state.showSessions ? "shown" : "hidden"}.`;
				render();
				break;
			case "toggle-jobs":
				state.showJobs = !state.showJobs;
				state.lastMessage = `Detached jobs section ${state.showJobs ? "shown" : "hidden"}.`;
				render();
				break;
			case "toggle-help":
				state.showHelp = !state.showHelp;
				state.lastMessage = state.showHelp ? "Key help shown." : "Key help hidden.";
				render();
				break;
			case "focus-doctor":
				state.focus = "doctor";
				state.lastMessage = "Focus moved to doctor.";
				render();
				break;
			case "focus-sessions":
				state.focus = "sessions";
				state.lastMessage = "Focus moved to recent sessions.";
				render();
				break;
			case "focus-jobs":
				state.focus = "jobs";
				state.lastMessage = "Focus moved to detached jobs.";
				render();
				break;
			case "cycle-focus":
				state.focus = nextFocus(state.focus);
				state.lastMessage = `Focus moved to ${state.focus}.`;
				render();
				break;
			case "toggle-focused":
				toggleFocusedSection(state);
				state.lastMessage = `${state.focus} section toggled.`;
				render();
				break;
			case "pause":
				state.paused = !state.paused;
				state.lastMessage = state.paused ? "Auto-refresh paused." : "Auto-refresh resumed.";
				render();
				break;
			case "focus-first":
				state.focus = "doctor";
				state.lastMessage = "Focus reset to doctor.";
				render();
				break;
			case "focus-last":
				state.focus = "jobs";
				state.lastMessage = "Focus moved to detached jobs.";
				render();
				break;
			default:
				break;
		}
	};

	const onSigint = () => {
		if (!running) return;
		running = false;
		cleanup();
		process.exit(0);
	};

	process.stdin.on("data", onData);
	process.on("SIGINT", onSigint);
	process.on("SIGTERM", onSigint);
	if (typeof (process.stdin as NodeJS.ReadStream).setRawMode === "function") {
		(process.stdin as NodeJS.ReadStream).setRawMode(true);
		process.stdin.resume();
	}

		await refresh(applyFixes, false, false);
		refreshTimer = setInterval(() => {
			if (!state.paused) {
				void refresh(false, false, true);
			}
		}, REFRESH_MS);
	while (running) {
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
}

function renderSectionHeading(section: PlatformWatchSection, focus: PlatformWatchSection, labelText?: string): string {
	const active = section === focus;
	const text = labelText ?? capitalize(section);
	return active ? `${ANSI.BOLD}\x1b[36m▶ ${text}${ANSI.RESET}` : `${ANSI.BOLD}${text}${ANSI.RESET}`;
}

function nextFocus(current: PlatformWatchSection): PlatformWatchSection {
	return current === "doctor" ? "sessions" : current === "sessions" ? "jobs" : "doctor";
}

function toggleFocusedSection(state: PlatformWatchState): void {
	switch (state.focus) {
		case "doctor":
			state.showDoctor = !state.showDoctor;
			break;
		case "sessions":
			state.showSessions = !state.showSessions;
			break;
		case "jobs":
			state.showJobs = !state.showJobs;
			break;
	}
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function chipForOverall(overall: PlatformReport["overall"]): string {
	switch (overall) {
		case "ok":
			return `${ANSI.BOLD}\x1b[32m[OK]${ANSI.RESET}`;
		case "warn":
			return `${ANSI.BOLD}\x1b[33m[WARN]${ANSI.RESET}`;
		case "fail":
			return `${ANSI.BOLD}\x1b[31m[FAIL]${ANSI.RESET}`;
	}
	return "[?]";
}

function colorForOverall(overall: PlatformReport["overall"]): string {
	return overall === "ok" ? "\x1b[32m" : overall === "warn" ? "\x1b[33m" : "\x1b[31m";
}

function statusChip(ok: boolean, labelText: string): string {
	return `${ok ? "\x1b[32m" : "\x1b[31m"}${labelText}:${ok ? "up" : "down"}${ANSI.RESET}`;
}

function providerChip(authenticated: number, total: number): string {
	const color = authenticated > 0 ? "\x1b[32m" : total > 0 ? "\x1b[33m" : "\x1b[2m";
	return `${color}providers:${authenticated}/${total}${ANSI.RESET}`;
}

function label(text: string): string {
	return `${ANSI.DIM}${text.padEnd(10)}${ANSI.RESET}`;
}

function truncateAnsiAware(line: string, width: number): string {
	const plain = line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
	if (plain.length <= width) return line;
	const target = Math.max(0, width - 1);
	let visible = 0;
	let output = "";
	for (let i = 0; i < line.length && visible < target; i++) {
		if (line[i] === "\x1b") {
			const match = /\x1b\[[0-9;?]*[A-Za-z]/.exec(line.slice(i));
			if (match) {
				output += match[0];
				i += match[0].length - 1;
				continue;
			}
		}
		output += line[i];
		visible += 1;
	}
	return `${output}…${ANSI.RESET}`;
}
