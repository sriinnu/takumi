/**
 * Hub-aware slash commands (P0-2).
 *
 * Provides /lane and /artifacts commands for hub boundary
 * visibility directly from the TUI input field.
 */

import type { AppCommandContext } from "./app-command-context.js";

/** Strip ANSI escape sequences from untrusted data before TUI display. */
function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

export function registerHubCommands(ctx: AppCommandContext): void {
	// ── /lane — show execution lanes ──────────────────────────────────────────
	ctx.commands.register(
		"/lane",
		"Show execution lanes and routing decisions",
		async (args) => {
			const decisions = ctx.state.routingDecisions.value;
			if (decisions.length === 0) {
				return ctx.addInfoMessage("No execution lanes recorded yet.");
			}

			const sub = args.trim().toLowerCase();

			// /lane list — compact table
			if (!sub || sub === "list") {
				const rows = decisions
					.slice(-10)
					.reverse()
					.map((d, i) => {
						const icon = d.degraded === true ? "⚠" : "✓";
						const cap = stripAnsi(d.request?.capability ?? "unknown");
						const model = stripAnsi(d.selected?.id ?? "—");
						const enf = d.selected ? "SP" : "CO";
						return `  ${icon} ${String(i + 1).padStart(2)}  ${enf}  ${cap.padEnd(22)} ${model}`;
					});
				return ctx.addInfoMessage(
					`## Execution Lanes (last ${rows.length})\n\n` +
						`  ${"#".padStart(4)}  Enf ${"Capability".padEnd(22)} Model\n` +
						`  ${"─".repeat(4)}  ${"─".repeat(3)} ${"─".repeat(22)} ${"─".repeat(20)}\n` +
						rows.join("\n"),
				);
			}

			// /lane summary — routing health overview
			if (sub === "summary") {
				const total = decisions.length;
				const degradedCount = decisions.filter((d) => d.degraded === true).length;
				const engineCount = decisions.filter((d) => d.selected !== null).length;
				const fallbackCount = total - engineCount;
				const lines = [
					"## Routing Summary",
					"",
					`Total decisions: ${total}`,
					`Engine-routed:   ${engineCount} (${total > 0 ? Math.round((engineCount / total) * 100) : 0}%)`,
					`Local fallback:  ${fallbackCount} (${total > 0 ? Math.round((fallbackCount / total) * 100) : 0}%)`,
					`Degraded:        ${degradedCount} (${total > 0 ? Math.round((degradedCount / total) * 100) : 0}%)`,
				];
				return ctx.addInfoMessage(lines.join("\n"));
			}

			// /lane inspect <n> — detail for a specific lane
			if (sub.startsWith("inspect") || sub.startsWith("detail")) {
				const numStr = sub.replace(/^(inspect|detail)\s*/, "").trim();
				const parsed = Number.parseInt(numStr, 10);
				if (!numStr || Number.isNaN(parsed)) {
					return ctx.addInfoMessage("Usage: /lane inspect <number> (e.g., `/lane inspect 1`).");
				}
				const idx = parsed - 1;
				const reversed = decisions.slice(-10).reverse();
				if (idx < 0 || idx >= reversed.length) {
					return ctx.addInfoMessage(`Lane index out of range (1–${reversed.length}).`);
				}
				const d = reversed[idx];
				const enforcement = d.selected ? "same-provider" : "capability-only";
				const lines = [
					`## Lane #${idx + 1} Detail`,
					"",
					`**Capability:** ${stripAnsi(d.request?.capability ?? "unknown")}`,
					`**Consumer:** ${stripAnsi(d.request?.consumer ?? "—")}`,
					`**Enforcement:** ${enforcement}`,
					`**Degraded:** ${d.degraded === true ? "yes" : "no"}`,
					`**Reason:** ${stripAnsi(d.reason ?? "—")}`,
				];
				if (d.selected) {
					lines.push(
						"",
						"### Selected Provider",
						`  ID: ${stripAnsi(d.selected.id ?? "—")}`,
						`  Label: ${stripAnsi(d.selected.label ?? "—")}`,
						`  Family: ${stripAnsi(d.selected.providerFamily ?? "—")}`,
						`  Health: ${stripAnsi(String(d.selected.health ?? "—"))}`,
						`  Cost: ${stripAnsi(d.selected.costClass ?? "—")}`,
					);
				}
				if (d.fallbackChain && d.fallbackChain.length > 0) {
					lines.push("", "### Fallback Chain");
					for (const fb of d.fallbackChain) {
						lines.push(`  - ${fb}`);
					}
				}
				if (d.policyTrace && d.policyTrace.length > 0) {
					lines.push("", "### Policy Trace");
					for (const pt of d.policyTrace) {
						lines.push(`  - ${pt}`);
					}
				}
				return ctx.addInfoMessage(lines.join("\n"));
			}

			// /lane <capability> — filter by capability
			const filtered = decisions.filter((d) => d.request.capability?.toLowerCase().includes(sub));
			if (filtered.length === 0) {
				return ctx.addInfoMessage(`No lanes matching capability "${stripAnsi(sub)}".`);
			}
			const rows = filtered
				.slice(-10)
				.reverse()
				.map((d, i) => {
					const icon = d.degraded ? "⚠" : "✓";
					const model = stripAnsi(d.selected?.id ?? "—");
					return `  ${icon} ${String(i + 1).padStart(2)}  ${stripAnsi(d.request.capability ?? "—").padEnd(24)} ${model}`;
				});
			return ctx.addInfoMessage(`## Lanes matching "${sub}" (${rows.length})\n\n${rows.join("\n")}`);
		},
		["/lanes"],
	);

	// ── /artifacts — list hub artifacts from this session ─────────────────────
	ctx.commands.register(
		"/artifacts",
		"List hub artifacts from the current session",
		async (args) => {
			const bridge = ctx.state.chitraguptaBridge.value;
			if (!bridge?.isConnected) {
				return ctx.addInfoMessage("Hub artifact listing requires Chitragupta connection (not connected).");
			}

			const sub = args.trim().toLowerCase();
			const sessionId = ctx.state.canonicalSessionId.value;

			if (!sessionId) {
				return ctx.addInfoMessage("No canonical session active — artifacts require an active hub session.");
			}

			try {
				// artifactList is a future bridge API — guard dynamically.
				const bridgeAny = bridge as unknown as Record<string, unknown>;
				if (typeof bridgeAny.artifactList !== "function") {
					return ctx.addInfoMessage("Artifact listing not yet supported (requires updated Chitragupta bridge).");
				}
				const fetchArtifacts = bridgeAny.artifactList as (
					sid: string,
					kind?: string,
				) => Promise<Array<{ kind: string; summary: string; createdAt: string; promoted: boolean }>>;

				const list = await Promise.race([
					fetchArtifacts(sessionId, sub || undefined),
					new Promise<null>((_, reject) => setTimeout(() => reject(new Error("Bridge request timed out (5s)")), 5000)),
				]);

				if (!list || !Array.isArray(list) || list.length === 0) {
					return ctx.addInfoMessage("No hub artifacts recorded for this session yet.");
				}

				const rows = list.map((a, i) => {
					if (!a || typeof a.kind !== "string") return `  · ${String(i + 1).padStart(2)}  (malformed artifact)`;
					const tag = a.promoted ? "★" : "·";
					const time = a.createdAt ? new Date(a.createdAt).toLocaleTimeString() : "—";
					return `  ${tag} ${String(i + 1).padStart(2)}  ${stripAnsi(a.kind).padEnd(20)} ${time}  ${stripAnsi((a.summary ?? "").slice(0, 60))}`;
				});

				return ctx.addInfoMessage(
					`## Hub Artifacts (${rows.length})\n\n` +
						`  ${"#".padStart(4)}  ${"Kind".padEnd(20)} ${"Time".padEnd(10)} Summary\n` +
						`  ${"─".repeat(4)}  ${"─".repeat(20)} ${"─".repeat(10)} ${"─".repeat(40)}\n` +
						rows.join("\n"),
				);
			} catch (err) {
				return ctx.addInfoMessage(`Failed to load artifacts: ${err instanceof Error ? err.message : String(err)}`);
			}
		},
		["/art"],
	);
}
