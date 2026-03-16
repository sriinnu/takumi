/**
 * TUI commands for P-Track surfaces: approvals, eval-gate, fleet observability.
 */

import { evaluateGate, type ObservabilitySessionSummary } from "@takumi/core";
import type { AppCommandContext } from "./app-command-context.js";

// ── Registration ──────────────────────────────────────────────────────────────

export function registerPTrackCommands(ctx: AppCommandContext): void {
	// ── /approvals ────────────────────────────────────────────────────────
	ctx.commands.register(
		"/approvals",
		"Show pending approval requests and manage the audit trail",
		async (args) => {
			const queue = ctx.state.approvalQueue;
			const sub = args.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

			if (!sub || sub === "list") {
				const snap = queue.snapshot();
				if (snap.total === 0) return ctx.addInfoMessage("No approval records.");
				const rows = snap.recent
					.slice(-15)
					.map((r: { status: string; tool: string; argsSummary: string }, i: number) => {
						const icon = r.status === "pending" ? "⏳" : r.status === "approved" ? "✓" : "✗";
						return `  ${icon} ${String(i + 1).padStart(2)}  ${r.tool.padEnd(16)} ${r.status.padEnd(10)} ${r.argsSummary.slice(0, 50)}`;
					});
				return ctx.addInfoMessage(
					`## Approvals (${snap.total} total, ${snap.pending.length} pending)\n\n${rows.join("\n")}`,
				);
			}

			if (sub === "approve" || sub === "deny") {
				const id = args.trim().split(/\s+/)[1];
				if (!id) return ctx.addInfoMessage(`Usage: /approvals ${sub} <id>`);
				const status = sub === "approve" ? "approved" : "denied";
				const updated = await queue.decide(id, status as "approved" | "denied", "operator");
				if (!updated) return ctx.addInfoMessage(`Approval record not found: ${id}`);
				return ctx.addInfoMessage(`${status === "approved" ? "✓" : "✗"} ${id} → ${status}`);
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
				const lines = pending.map((r) => `  ⏳ **${r.id}**  ${r.tool}  ${r.argsSummary.slice(0, 60)}`);
				return ctx.addInfoMessage(`## Pending (${pending.length})\n\n${lines.join("\n")}`);
			}

			ctx.addInfoMessage("Usage: /approvals [list|pending|approve <id>|deny <id>|export [jsonl|csv]]");
		},
		["/apr"],
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
			const engine = ctx.state.alertEngine;
			const sub = args.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

			if (!sub || sub === "summary") {
				const sessions = buildSessionSummaries(ctx);
				engine.evaluateStaleness(sessions);
				for (const s of sessions) engine.evaluateSession(s);
				const fleet = engine.buildFleetSummary(sessions);

				const alertLines =
					fleet.activeAlerts.length > 0
						? fleet.activeAlerts
								.slice(0, 10)
								.map((a) => `  ${a.severity === "critical" ? "🔴" : "🟡"} [${a.kind}] ${a.message}`)
								.join("\n")
						: "  None";

				ctx.addInfoMessage(
					`## Fleet Summary\n\n` +
						`Agents: ${fleet.totalAgents} (${fleet.workingAgents} working, ${fleet.idleAgents} idle, ${fleet.errorAgents} error)\n` +
						`Total cost: $${fleet.totalCostUsd.toFixed(4)}\n` +
						`Alerts: ${fleet.activeAlerts.length} active (${fleet.alertCounts.critical} critical, ${fleet.alertCounts.warning} warning)\n\n` +
						`Active alerts:\n${alertLines}`,
				);
				return;
			}

			if (sub === "alerts") {
				const alerts = engine.activeAlerts();
				if (alerts.length === 0) return ctx.addInfoMessage("No active alerts.");
				const lines = alerts.map(
					(a) => `  ${a.severity === "critical" ? "🔴" : "🟡"} **${a.id}** [${a.kind}] ${a.message}`,
				);
				return ctx.addInfoMessage(`## Alerts (${alerts.length})\n\n${lines.join("\n")}`);
			}

			if (sub === "ack") {
				const alertId = args.trim().split(/\s+/)[1];
				if (!alertId) return ctx.addInfoMessage("Usage: /fleet ack <alert-id>");
				const ok = engine.acknowledge(alertId);
				return ctx.addInfoMessage(ok ? `✓ Alert ${alertId} acknowledged` : `Alert not found: ${alertId}`);
			}

			if (sub === "degraded") {
				const runs = engine.getDegradedRuns();
				if (runs.length === 0) return ctx.addInfoMessage("No degraded runs recorded.");
				const lines = runs.map(
					(r) => `  ${r.fallbackChain.join(" → ")} (${r.reason}) @ ${new Date(r.occurredAt).toLocaleTimeString()}`,
				);
				return ctx.addInfoMessage(`## Degraded Runs (${runs.length})\n\n${lines.join("\n")}`);
			}

			ctx.addInfoMessage("Usage: /fleet [summary|alerts|ack <id>|degraded]");
		},
		["/obs"],
	);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build session summaries from current TUI state for fleet evaluation. */
function buildSessionSummaries(ctx: AppCommandContext): ObservabilitySessionSummary[] {
	const state = ctx.state;
	const contextPct = state.contextPercent?.value ?? 0;
	const pressure =
		contextPct >= 95 ? "at_limit" : contextPct >= 85 ? "near_limit" : contextPct >= 70 ? "approaching_limit" : "normal";
	const summary: ObservabilitySessionSummary = {
		sessionId: state.sessionId.value ?? "unknown",
		activity: state.agentPhase.value !== "idle" ? "working" : "idle",
		model: state.model.value,
		provider: state.provider.value,
		costUsd: state.totalCost.value,
		contextPercent: contextPct,
		pressure,
		toolFailures: 0,
		lastHeartbeatAt: Date.now(),
		degraded: false,
		turnCount: state.turnCount.value,
	};
	return [summary];
}
