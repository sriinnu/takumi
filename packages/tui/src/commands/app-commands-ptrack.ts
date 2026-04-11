/**
 * TUI commands for P-Track surfaces: approvals, eval-gate, fleet observability.
 */

import { type ApprovalRecord, evaluateGate, type ObservabilitySessionSummary } from "@takumi/core";
import {
	acknowledgeOperatorAlert,
	buildActiveOperatorAlerts,
	buildFleetSummary,
	buildRecentDegradedRoutingDecisions,
	describeRoutingDecisionTarget,
} from "../operator-observability.js";
import type { AppCommandContext } from "./app-command-context.js";

const APPROVAL_USAGE = "Usage: /approvals [list|pending|inspect <id|#>|approve <id|#>|deny <id|#>|export [jsonl|csv]]";
const FLEET_USAGE = "Usage: /fleet [summary|alerts|ack <id>|degraded]";

function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	if (maxLength <= 1) return text.slice(0, maxLength);
	return `${text.slice(0, maxLength - 1)}…`;
}

function classifyApprovalRisk(tool: string): "low" | "medium" | "high" {
	const normalized = tool.toLowerCase();
	if (
		[
			"shell",
			"run_in_terminal",
			"apply_patch",
			"create_file",
			"pgsql_modify",
			"delete",
			"kill_terminal",
			"run_vscode_command",
		].includes(normalized)
	) {
		return "high";
	}
	if (
		["read_file", "grep_search", "file_search", "list_dir", "semantic_search", "get_errors", "view_image"].includes(
			normalized,
		)
	) {
		return "low";
	}
	return "medium";
}

function formatApprovalStatusIcon(status: ApprovalRecord["status"]): string {
	if (status === "pending") return "⏳";
	if (status === "approved") return "✓";
	if (status === "denied") return "✗";
	if (status === "escalated") return "⇪";
	return "•";
}

function approvalReviewWindow(ctx: AppCommandContext): ApprovalRecord[] {
	return ctx.state.approvalQueue.snapshot().recent.slice(-15).reverse();
}

function resolveApprovalRecord(ctx: AppCommandContext, rawTarget: string): ApprovalRecord | null {
	const target = rawTarget.trim();
	if (!target) return null;

	const direct = ctx.state.approvalQueue.find(target);
	if (direct) return direct;

	const parsed = Number.parseInt(target, 10);
	if (Number.isNaN(parsed) || parsed < 1) return null;
	return approvalReviewWindow(ctx)[parsed - 1] ?? null;
}

function formatApprovalRow(record: ApprovalRecord, index: number, activeApprovalId?: string): string {
	const marker = record.id === activeApprovalId ? "*" : " ";
	const risk = classifyApprovalRisk(record.tool).toUpperCase().padEnd(6);
	const tool = truncate(record.tool, 16).padEnd(16);
	const lane = record.lane.padEnd(7);
	const session = truncate(record.sessionId ?? "—", 12).padEnd(12);
	const summary = truncate(record.argsSummary, 42);
	return `  ${String(index).padStart(2)} ${formatApprovalStatusIcon(record.status)}${marker} ${risk} ${tool} ${lane} ${session} ${summary}`;
}

function formatApprovalDetail(record: ApprovalRecord, activeApprovalId?: string): string {
	return [
		"## Approval Review",
		"",
		`ID: ${record.id}`,
		`Status: ${record.status}`,
		`Risk: ${classifyApprovalRisk(record.tool)}`,
		`Tool: ${record.tool}`,
		`Lane: ${record.lane}`,
		`Session: ${record.sessionId ?? "—"}`,
		`Active prompt: ${record.id === activeApprovalId ? "yes" : "no"}`,
		`Actor: ${record.actor}`,
		`Created: ${new Date(record.createdAt).toLocaleString()}`,
		`Decided: ${record.decidedAt ? new Date(record.decidedAt).toLocaleString() : "pending"}`,
		`Reason: ${record.reason ?? "—"}`,
		"",
		"### Args",
		record.argsSummary || "—",
		"",
		`Actions: /approvals approve ${record.id} • /approvals deny ${record.id}`,
	].join("\n");
}

function formatFleetSessionLine(session: ObservabilitySessionSummary): string {
	return [
		`  • ${session.sessionId}`,
		session.activity,
		`${session.provider}/${session.model}`,
		`ctx ${Math.round(session.contextPercent)}% (${session.pressure})`,
		`$${session.costUsd.toFixed(4)}`,
	].join(" • ");
}

function formatFleetAlertLine(alert: ReturnType<typeof buildActiveOperatorAlerts>[number]): string {
	const icon = alert.severity === "critical" ? "🔴" : alert.severity === "warning" ? "🟡" : "🔵";
	return `  ${icon} [${alert.kind}] ${alert.message}`;
}

function formatDegradedRouteLine(
	index: number,
	capability: string,
	target: string,
	fallback: string,
	reason: string,
): string {
	return `  ${String(index).padStart(2)}  ${capability} → ${target} • fallback ${fallback} • ${reason}`;
}

function getApprovalsCommandCompletions(ctx: AppCommandContext, partial: string): string[] {
	const normalized = partial.trimStart();
	const hasTrailingSpace = /\s$/.test(partial);
	const base = ["list", "pending", "inspect ", "approve ", "deny ", "export "];
	if (!normalized) return base;

	const tokens = normalized.split(/\s+/);
	if (tokens.length === 1 && !hasTrailingSpace) {
		return base.filter((value) => value.startsWith(tokens[0].toLowerCase()));
	}

	const pendingIds = ctx.state.approvalQueue.pending().map((record) => `${record.id} `);
	const subcommand = tokens[0].toLowerCase();
	if (subcommand === "inspect") {
		const prefix = hasTrailingSpace ? "" : (tokens[1] ?? "");
		return approvalReviewWindow(ctx)
			.map((record) => `${record.id} `)
			.filter((value) => value.startsWith(prefix));
	}

	if (["approve", "deny"].includes(subcommand)) {
		const prefix = hasTrailingSpace ? "" : (tokens[1] ?? "");
		return pendingIds.filter((value) => value.startsWith(prefix));
	}

	if (subcommand === "export") {
		const prefix = hasTrailingSpace ? "" : (tokens[1] ?? "");
		return ["jsonl", "csv"].filter((value) => value.startsWith(prefix));
	}

	return [];
}

function getFleetCommandCompletions(ctx: AppCommandContext, partial: string): string[] {
	const normalized = partial.trimStart();
	const hasTrailingSpace = /\s$/.test(partial);
	const base = ["summary", "alerts", "ack ", "degraded"];
	if (!normalized) return base;

	const tokens = normalized.split(/\s+/);
	if (tokens.length === 1 && !hasTrailingSpace) {
		return base.filter((value) => value.startsWith(tokens[0].toLowerCase()));
	}

	if (tokens[0].toLowerCase() !== "ack") return [];
	const prefix = hasTrailingSpace ? "" : (tokens[1] ?? "");
	return buildActiveOperatorAlerts(ctx.state)
		.map((alert) => `${alert.id} `)
		.filter((value) => value.startsWith(prefix));
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerPTrackCommands(ctx: AppCommandContext): void {
	// ── /approvals ────────────────────────────────────────────────────────
	ctx.commands.register(
		"/approvals",
		"Show pending approval requests and manage the audit trail",
		async (args) => {
			const queue = ctx.state.approvalQueue;
			const sub = args.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
			const activeApprovalId = ctx.state.pendingPermission.value?.approvalId;

			if (!sub || sub === "list") {
				const snap = queue.snapshot();
				if (snap.total === 0) return ctx.addInfoMessage("No approval records.");
				const rows = approvalReviewWindow(ctx).map((record, index) =>
					formatApprovalRow(record, index + 1, activeApprovalId),
				);
				return ctx.addInfoMessage(
					`## Approvals (${snap.total} total, ${snap.pending.length} pending)\n\n` +
						`  ${"#".padStart(2)}  ${"State".padEnd(2)} ${"Risk".padEnd(6)} ${"Tool".padEnd(16)} ${"Lane".padEnd(7)} ${"Session".padEnd(12)} Request\n` +
						`  ${"─".repeat(2)}  ${"─".repeat(2)} ${"─".repeat(6)} ${"─".repeat(16)} ${"─".repeat(7)} ${"─".repeat(12)} ${"─".repeat(42)}\n` +
						`${rows.join("\n")}\n\n` +
						`Active prompt marker: * • Inspect with /approvals inspect <#|id>`,
				);
			}

			if (sub === "inspect") {
				const target = args.trim().split(/\s+/)[1] ?? "";
				const record = resolveApprovalRecord(ctx, target);
				if (!record) {
					return ctx.addInfoMessage(`No approval record matched "${target}". Use /approvals or /approvals pending.`);
				}
				return ctx.addInfoMessage(formatApprovalDetail(record, activeApprovalId));
			}

			if (sub === "approve" || sub === "deny") {
				const target = args.trim().split(/\s+/)[1] ?? "";
				if (!target) return ctx.addInfoMessage(`Usage: /approvals ${sub} <id|#>`);
				const record = resolveApprovalRecord(ctx, target);
				if (!record) return ctx.addInfoMessage(`Approval record not found: ${target}`);
				if (record.status !== "pending") {
					return ctx.addInfoMessage(`Approval ${record.id} is already ${record.status}.`);
				}
				const status = sub === "approve" ? "approved" : "denied";
				const updated = await queue.decide(record.id, status as "approved" | "denied", "operator");
				if (!updated) return ctx.addInfoMessage(`Approval record not found: ${record.id}`);
				return ctx.addInfoMessage(`${status === "approved" ? "✓" : "✗"} ${record.id} → ${status}`);
			}

			if (sub === "export") {
				const format = (args.trim().split(/\s+/)[1] ?? "jsonl") as "jsonl" | "csv";
				const content = await queue.exportLog({ format });
				ctx.addInfoMessage(`\`\`\`\n${content.slice(0, 2000)}\n\`\`\``);
				return;
			}

			if (sub === "pending") {
				const pending = queue.pending();
				if (pending.length === 0) return ctx.addInfoMessage("No pending approvals.");
				const lines = pending
					.slice()
					.reverse()
					.map((record, index) => formatApprovalRow(record, index + 1, activeApprovalId));
				return ctx.addInfoMessage(
					`## Pending (${pending.length})\n\n` +
						`  ${"#".padStart(2)}  ${"State".padEnd(2)} ${"Risk".padEnd(6)} ${"Tool".padEnd(16)} ${"Lane".padEnd(7)} ${"Session".padEnd(12)} Request\n` +
						`  ${"─".repeat(2)}  ${"─".repeat(2)} ${"─".repeat(6)} ${"─".repeat(16)} ${"─".repeat(7)} ${"─".repeat(12)} ${"─".repeat(42)}\n` +
						`${lines.join("\n")}`,
				);
			}

			ctx.addInfoMessage(APPROVAL_USAGE);
		},
		{ aliases: ["/apr"], getArgumentCompletions: (partial) => getApprovalsCommandCompletions(ctx, partial) },
	);

	// ── /eval-gate ────────────────────────────────────────────────────────
	ctx.commands.register(
		"/eval-gate",
		"Run eval gate against benchmark results",
		async (args) => {
			const sub = args.trim().toLowerCase();

			if (!sub || sub === "status") {
				ctx.addInfoMessage(
					"Eval gate is ready. Use `/eval-gate run` to execute benchmarks.\n" +
						"Requires benchmark results — see `scripts/eval.ts` for the runner.",
				);
				return;
			}

			if (sub === "run") {
				ctx.addInfoMessage("Running eval gate...");
				try {
					const { readFile } = await import("node:fs/promises");
					const { join } = await import("node:path");
					const resultsPath = join(process.cwd(), ".takumi", "benchmark-results.json");
					const raw = await readFile(resultsPath, "utf-8");
					const results = JSON.parse(raw);
					if (!Array.isArray(results) || results.length === 0) {
						return ctx.addInfoMessage("No benchmark results found. Run `pnpm eval` first.");
					}
					const report = evaluateGate(results);
					const icon = report.verdict === "pass" ? "✅" : "❌";
					const violations =
						report.violations.length > 0
							? report.violations.map((v) => `  • ${v.check}: ${v.actual} (expected: ${v.expected})`).join("\n")
							: "  None";
					ctx.addInfoMessage(
						`## Eval Gate: ${icon} ${report.verdict.toUpperCase()}\n\n` +
							`Success rate: ${(report.metrics.successRate * 100).toFixed(1)}%\n` +
							`Avg cost: $${report.metrics.avgCostPerTask.toFixed(4)}\n` +
							`Avg duration: ${(report.metrics.avgDurationMs / 1000).toFixed(1)}s\n\n` +
							`Violations:\n${violations}`,
					);
				} catch (err) {
					if ((err as NodeJS.ErrnoException).code === "ENOENT") {
						return ctx.addInfoMessage(
							"No benchmark results file found at `.takumi/benchmark-results.json`.\nRun `pnpm eval --json` to generate results first.",
						);
					}
					ctx.addInfoMessage(`Eval gate failed: ${(err as Error).message}`);
				}
				return;
			}

			ctx.addInfoMessage("Usage: /eval-gate [status|run]");
		},
		["/gate"],
	);

	// ── /fleet ────────────────────────────────────────────────────────────
	ctx.commands.register(
		"/fleet",
		"Show fleet observability summary and alerts",
		async (args) => {
			const sub = args.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

			if (!sub || sub === "summary") {
				const fleet = buildFleetSummary(ctx.state);
				const sessionLines =
					fleet.sessions.length > 0
						? fleet.sessions.map((session) => formatFleetSessionLine(session)).join("\n")
						: "  None";
				const alertLines =
					fleet.activeAlerts.length > 0
						? fleet.activeAlerts
								.slice(0, 10)
								.map((alert) => formatFleetAlertLine(alert))
								.join("\n")
						: "  None";

				ctx.addInfoMessage(
					`## Fleet Summary\n\n` +
						`Agents: ${fleet.totalAgents} (${fleet.workingAgents} working, ${fleet.idleAgents} idle, ${fleet.errorAgents} error)\n` +
						`Total cost: $${fleet.totalCostUsd.toFixed(4)}\n` +
						`Alerts: ${fleet.activeAlerts.length} active (${fleet.alertCounts.critical} critical, ${fleet.alertCounts.warning} warning)\n\n` +
						`Sessions:\n${sessionLines}\n\n` +
						`Active alerts:\n${alertLines}`,
				);
				return;
			}

			if (sub === "alerts") {
				const alerts = buildActiveOperatorAlerts(ctx.state);
				if (alerts.length === 0) return ctx.addInfoMessage("No active alerts.");
				const lines = alerts.map(
					(alert) =>
						`  ${alert.severity === "critical" ? "🔴" : alert.severity === "warning" ? "🟡" : "🔵"} **${alert.id}** [${alert.kind}] ${alert.message}`,
				);
				return ctx.addInfoMessage(`## Alerts (${alerts.length})\n\n${lines.join("\n")}`);
			}

			if (sub === "ack") {
				const alertId = args.trim().split(/\s+/)[1];
				if (!alertId) return ctx.addInfoMessage("Usage: /fleet ack <alert-id>");
				const ok = acknowledgeOperatorAlert(ctx.state, alertId);
				return ctx.addInfoMessage(ok ? `✓ Alert ${alertId} acknowledged` : `Alert not found: ${alertId}`);
			}

			if (sub === "degraded") {
				const decisions = buildRecentDegradedRoutingDecisions(ctx.state);
				if (decisions.length === 0) return ctx.addInfoMessage("No degraded routing decisions recorded.");
				const lines = decisions.map((decision, index) =>
					formatDegradedRouteLine(
						index + 1,
						decision.request.capability,
						describeRoutingDecisionTarget(decision),
						decision.fallbackChain.length > 0 ? decision.fallbackChain.join(" → ") : "none",
						decision.reason,
					),
				);
				return ctx.addInfoMessage(`## Degraded Routes (${decisions.length})\n\n${lines.join("\n")}`);
			}

			ctx.addInfoMessage(FLEET_USAGE);
		},
		{ aliases: ["/obs"], getArgumentCompletions: (partial) => getFleetCommandCompletions(ctx, partial) },
	);
}
