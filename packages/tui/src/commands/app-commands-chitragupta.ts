/**
 * Chitragupta-related slash commands (Phase 15 & 16).
 * Extracted from app-commands-core.ts to meet LOC limit.
 */

import { formatCapabilityHealthSnapshot, mergeControlPlaneCapabilities } from "../control-plane-state.js";
import { formatDefaultSabhaSummary } from "../sabha-defaults.js";
import { formatScarlettIntegrityReport } from "../scarlett-runtime.js";
import type { AppCommandContext } from "./app-command-context.js";
import {
	formatAvailableAgents,
	formatRebindMessage,
	formatSabhaState,
	formatWorkingAgents,
} from "./app-commands-chitragupta-formatters.js";
import { registerRouteCommand } from "./route-command-surface.js";

export function registerChitraguptaCommands(ctx: AppCommandContext): void {
	ctx.commands.register(
		"/rebind",
		"Reconnect and sync pending local turns to Chitragupta",
		async () => {
			if (!ctx.reconnectChitragupta) {
				return ctx.addInfoMessage("Rebind is unavailable in this runtime.");
			}

			ctx.addInfoMessage("Rebinding to Chitragupta...");
			const result = await ctx.reconnectChitragupta();
			ctx.addInfoMessage(formatRebindMessage(result));
		},
		["/reconnect"],
	);

	ctx.commands.register("/day", "Temporal memory navigation", async (args) => {
		const bridge = ctx.state.chitraguptaBridge.value;
		if (!bridge?.isConnected) return ctx.addInfoMessage("Chitragupta not connected");
		if (!args) {
			return ctx.addInfoMessage(
				"Usage:\n  /day list             — list days\n  /day show YYYY-MM-DD  — show day\n  /day search <query>   — search days",
			);
		}
		const parts = args.trim().split(/\s+/);
		const sub = parts[0];

		if (sub === "list") {
			try {
				const dates = await bridge.dayList();
				if (dates.length === 0) return ctx.addInfoMessage("No day files");
				ctx.addInfoMessage(`Day files (${dates.length}):\n${dates.map((d, i) => `${i + 1}. ${d}`).join("\n")}`);
			} catch (err) {
				ctx.addInfoMessage(`Failed: ${(err as Error).message}`);
			}
			return;
		}
		if (sub === "show") {
			const date = parts[1];
			if (!date) return ctx.addInfoMessage("Usage: /day show YYYY-MM-DD");
			try {
				const result = await bridge.dayShow(date);
				if (!result.content) return ctx.addInfoMessage(`No content for ${date}`);
				ctx.addInfoMessage(`Day: ${result.date}\n\n${result.content}`);
			} catch (err) {
				ctx.addInfoMessage(`Failed: ${(err as Error).message}`);
			}
			return;
		}
		if (sub === "search") {
			const query = parts.slice(1).join(" ");
			if (!query) return ctx.addInfoMessage("Usage: /day search <query>");
			try {
				const results = await bridge.daySearch(query, 10);
				if (results.length === 0) return ctx.addInfoMessage(`No results for: ${query}`);
				const fmt = results.map((r, i) => `${i + 1}. ${r.date} [${r.score.toFixed(2)}]\n${r.content}`).join("\n\n");
				ctx.addInfoMessage(`Results (${results.length}):\n\n${fmt}`);
			} catch (err) {
				ctx.addInfoMessage(`Failed: ${(err as Error).message}`);
			}
			return;
		}
		ctx.addInfoMessage(`Unknown: ${sub}\nUse /day for usage.`);
	});

	ctx.commands.register("/vidhi", "List or match learned procedures", async (args) => {
		const bridge = ctx.state.chitraguptaBridge.value;
		if (!bridge?.isConnected) return ctx.addInfoMessage("Chitragupta not connected");
		const project = process.cwd();

		if (!args || args === "list") {
			const vidhis = await bridge.vidhiList(project, 20);
			if (vidhis.length === 0) return ctx.addInfoMessage("No vidhis — run /consolidate first");
			const lines = vidhis.map(
				(v) =>
					`• **${v.name}** (${v.confidence.toFixed(2)} conf, ${v.usageCount} uses)\n  \`${v.pattern}\` → ${v.action}`,
			);
			return ctx.addInfoMessage(`## Vidhis (${vidhis.length})\n\n${lines.join("\n\n")}`);
		}
		if (args.startsWith("match ")) {
			const query = args.slice(6).trim();
			if (!query) return ctx.addInfoMessage("Usage: `/vidhi match <query>`");
			const match = await bridge.vidhiMatch(project, query);
			if (!match) return ctx.addInfoMessage(`No match for: "${query}"`);
			return ctx.addInfoMessage(
				`## Match (${match.score.toFixed(2)})\n**${match.vidhi.name}**: \`${match.vidhi.pattern}\` → ${match.vidhi.action}\n\n${match.context}`,
			);
		}
		ctx.addInfoMessage("Usage: `/vidhi list` or `/vidhi match <query>`");
	});

	ctx.commands.register("/consolidate", "Run memory consolidation", async (args) => {
		const bridge = ctx.state.chitraguptaBridge.value;
		if (!bridge?.isConnected) return ctx.addInfoMessage("Chitragupta not connected");
		const project = process.cwd();
		let count = 20;
		if (args) {
			const n = Number.parseInt(args, 10);
			if (!Number.isNaN(n) && n > 0 && n <= 100) count = n;
		}
		ctx.addInfoMessage(`Running consolidation (${count} sessions)...`);
		try {
			const r = await bridge.consolidationRun(project, count);
			ctx.addInfoMessage(
				`## Done\n• ${r.sessionCount} sessions\n• ${r.vidhisExtracted} vidhis\n• ${r.factsExtracted} facts\n• ${r.daysSaved} days\n• ${(r.elapsed / 1000).toFixed(1)}s`,
			);
		} catch (err) {
			ctx.addInfoMessage(`❌ ${(err as Error).message}`);
		}
	});

	ctx.commands.register("/facts", "Extract structured facts", async (args) => {
		if (!args) return ctx.addInfoMessage("Usage: `/facts <text>`");
		const bridge = ctx.state.chitraguptaBridge.value;
		if (!bridge?.isConnected) return ctx.addInfoMessage("Chitragupta not connected");
		ctx.addInfoMessage("Extracting...");
		try {
			const facts = await bridge.factExtract(args, process.cwd());
			if (facts.length === 0) return ctx.addInfoMessage("No facts extracted");
			const lines = facts.map((f) => `• **${f.type}** (${(f.confidence * 100).toFixed(0)}%)\n  ${f.text}`);
			ctx.addInfoMessage(`## Facts (${facts.length})\n\n${lines.join("\n\n")}`);
		} catch (err) {
			ctx.addInfoMessage(`❌ ${(err as Error).message}`);
		}
	});

	ctx.commands.register("/csession", "Create session in chitragupta", async (args) => {
		const bridge = ctx.state.chitraguptaBridge.value;
		if (!bridge?.isConnected) return ctx.addInfoMessage("Chitragupta not connected");

		const title = args?.trim() || `Session ${new Date().toISOString().split("T")[0]}`;
		const project = process.cwd();

		try {
			const result = await bridge.sessionCreate({
				project,
				title,
				agent: "takumi",
				model: ctx.state.model.value ?? "claude-sonnet-4",
				provider: ctx.state.provider.value ?? "anthropic",
			});
			ctx.addInfoMessage(`✓ Session created: ${result.id}`);
		} catch (err) {
			ctx.addInfoMessage(`❌ Failed: ${(err as Error).message}`);
		}
	});

	ctx.commands.register("/daemon", "Show daemon status", async () => {
		const bridge = ctx.state.chitraguptaBridge.value;
		if (!bridge?.isConnected) return ctx.addInfoMessage("Chitragupta not connected");
		try {
			const status = await bridge.daemonStatus();
			if (!status) return ctx.addInfoMessage("Daemon not running or status unavailable");
			const c = status.counts;
			ctx.addInfoMessage(
				`## Daemon Status\n` +
					`• Sessions: ${c.sessions}\n• Turns: ${c.turns}\n• Rules: ${c.rules}\n` +
					`• Vidhis: ${c.vidhis}\n• Samskaras: ${c.samskaras}\n• Vasanas: ${c.vasanas}\n` +
					`• Akasha: ${c.akashaTraces}\n• Timestamp: ${new Date(status.timestamp).toISOString()}`,
			);
		} catch (err) {
			ctx.addInfoMessage(`Failed: ${(err as Error).message}`);
		}
	});

	ctx.commands.register("/turns", "List turns for a session", async (args) => {
		const bridge = ctx.state.chitraguptaBridge.value;
		if (!bridge?.isConnected) return ctx.addInfoMessage("Chitragupta not connected");
		const sessionId = args?.trim() || ctx.state.sessionId.value;
		if (!sessionId) return ctx.addInfoMessage("Usage: /turns <session-id>");
		try {
			const turns = await bridge.turnList(sessionId);
			if (turns.length === 0) return ctx.addInfoMessage("No turns found");
			const lines = turns.map(
				(t) => `${t.number}. [${t.role}] ${t.content.slice(0, 80)}${t.content.length > 80 ? "…" : ""}`,
			);
			ctx.addInfoMessage(`Turns (${turns.length}):\n${lines.join("\n")}`);
		} catch (err) {
			ctx.addInfoMessage(`Failed: ${(err as Error).message}`);
		}
	});

	ctx.commands.register("/track", "Track last turn to chitragupta (experimental)", async () => {
		const bridge = ctx.state.chitraguptaBridge.value;
		if (!bridge?.isConnected) return ctx.addInfoMessage("Chitragupta not connected");

		// Get current session info
		const sessionId = ctx.state.sessionId.value ?? "unknown";
		const project = process.cwd();
		const messages = ctx.state.messages.value;

		if (messages.length === 0) {
			return ctx.addInfoMessage("No messages to track");
		}

		try {
			// Get max turn number, then add last exchange as a turn
			const maxTurn = await bridge.turnMaxNumber(sessionId);
			const lastMsg = messages[messages.length - 1];

			const turn: import("@takumi/bridge").Turn = {
				number: maxTurn + 1,
				role: lastMsg.role as "user" | "assistant" | "system",
				content:
					typeof lastMsg.content === "string"
						? lastMsg.content
						: lastMsg.content.map((c) => (c.type === "text" ? c.text : "")).join(""),
				timestamp: Date.now(),
				model: ctx.state.model.value,
			};

			await bridge.turnAdd(sessionId, project, turn);
			ctx.addInfoMessage(`✓ Turn ${turn.number} tracked`);
		} catch (err) {
			ctx.addInfoMessage(`❌ Failed: ${(err as Error).message}`);
		}
	});

	// ── Phase 51: Prediction & Pattern Commands ──────────────────────────

	ctx.commands.register("/predict", "Show Chitragupta predictions for current context", async () => {
		const observer = ctx.state.chitraguptaObserver.value;
		if (!observer) return ctx.addInfoMessage("Chitragupta observer not available");

		ctx.addInfoMessage("Querying predictions...");
		try {
			const result = await observer.predictNext({
				currentFile: undefined,
				currentTool: ctx.state.activeTool.value ?? undefined,
				sessionId: ctx.state.sessionId.value,
			});
			if (result.predictions.length === 0) return ctx.addInfoMessage("No predictions available yet");
			const lines = result.predictions.map(
				(p, i) => `${i + 1}. **${p.type}** (${(p.confidence * 100).toFixed(0)}%)\n   ${p.action ?? p.reasoning}`,
			);
			ctx.addInfoMessage(`## Predictions\n\n${lines.join("\n\n")}`);
		} catch (err) {
			ctx.addInfoMessage(`❌ ${(err as Error).message}`);
		}
	});

	ctx.commands.register("/patterns", "Show detected behavioral patterns", async (args) => {
		const observer = ctx.state.chitraguptaObserver.value;
		if (!observer) return ctx.addInfoMessage("Chitragupta observer not available");

		const minConf = args ? Number.parseFloat(args) : undefined;
		try {
			const result = await observer.patternQuery({
				minConfidence: !Number.isNaN(minConf!) ? minConf : 0.5,
				limit: 15,
			});
			if (result.patterns.length === 0) return ctx.addInfoMessage("No patterns detected yet");
			const lines = result.patterns.map(
				(p, i) =>
					`${i + 1}. **${p.type}** — ${String(p.pattern)} (${(p.confidence * 100).toFixed(0)}%, ${p.occurrences} occ.)`,
			);
			ctx.addInfoMessage(`## Patterns\n\n${lines.join("\n")}`);
		} catch (err) {
			ctx.addInfoMessage(`❌ ${(err as Error).message}`);
		}
	});

	ctx.commands.register("/healthx", "Extended health status from Chitragupta", async () => {
		const observer = ctx.state.chitraguptaObserver.value;
		if (!observer) return ctx.addInfoMessage("Chitragupta observer not available");

		try {
			const h = await observer.healthStatusExtended();
			if (!h) return ctx.addInfoMessage("Health status unavailable");
			const anomalyLines =
				h.anomalies.length > 0
					? h.anomalies.map((a) => `  • [${a.severity}] ${a.type}: ${a.details}`).join("\n")
					: "  None";
			const costTrajectory = `current=${h.costTrajectory.currentCost.toFixed(2)} dailyAvg=${h.costTrajectory.dailyAvg.toFixed(2)} projected=${h.costTrajectory.projectedCost.toFixed(2)}`;
			ctx.addInfoMessage(
				`## Extended Health\n• Error rate: ${(h.errorRate * 100).toFixed(1)}%\n• Cost trajectory: ${costTrajectory}\n• Anomalies:\n${anomalyLines}`,
			);
		} catch (err) {
			ctx.addInfoMessage(`❌ ${(err as Error).message}`);
		}
	});

	ctx.commands.register("/capabilities", "Show current control-plane capabilities", async () => {
		const observer = ctx.state.chitraguptaObserver.value;
		if (!observer) return ctx.addInfoMessage("Chitragupta observer not available");

		try {
			const live = await observer.capabilities({ includeDegraded: true, includeDown: true, limit: 25 });
			const capabilities = mergeControlPlaneCapabilities(live.capabilities);
			ctx.state.controlPlaneCapabilities.value = capabilities;
			if (capabilities.length === 0) return ctx.addInfoMessage("No capabilities available");
			const lines = capabilities.map(
				(capability) =>
					`• **${capability.id}** — ${capability.kind} | ${capability.health} | ${capability.trust} | ${capability.capabilities.join(", ")}`,
			);
			ctx.addInfoMessage(`## Capabilities\n\n${lines.join("\n")}`);
		} catch (err) {
			ctx.addInfoMessage(`❌ ${(err as Error).message}`);
		}
	});

	registerRouteCommand(ctx);

	ctx.commands.register("/healthcaps", "Show capability health snapshots", async () => {
		const snapshots = ctx.state.capabilityHealthSnapshots.value;
		if (snapshots.length === 0) return ctx.addInfoMessage("No capability health snapshots available");
		ctx.addInfoMessage(`## Capability Health\n\n${snapshots.map(formatCapabilityHealthSnapshot).join("\n\n")}`);
	});

	ctx.commands.register("/sabha", "Show tracked Sabha, working agents, and available agent lanes", async (args) => {
		const bridge = ctx.state.chitraguptaBridge.value;
		const observer = ctx.state.chitraguptaObserver.value;
		if (!bridge?.isConnected || !observer) {
			return ctx.addInfoMessage("Chitragupta not connected");
		}

		const requestedSabhaId = args.trim();
		const sabhaId = requestedSabhaId || ctx.state.lastSabhaId.value;

		const [telemetry, capabilityResult, gathered] = await Promise.all([
			bridge.telemetrySnapshot().catch(() => null),
			observer.capabilities({ includeDegraded: true, includeDown: false, limit: 25 }).catch(() => null),
			sabhaId ? observer.sabhaGather({ id: sabhaId }).catch(() => null) : Promise.resolve(null),
		]);

		const capabilities = capabilityResult ? mergeControlPlaneCapabilities(capabilityResult.capabilities) : [];
		if (capabilities.length > 0) {
			ctx.state.controlPlaneCapabilities.value = capabilities;
		}

		ctx.addInfoMessage(
			[
				"## Sabha",
				formatSabhaState(gathered?.sabha ?? null, sabhaId),
				"",
				formatDefaultSabhaSummary(),
				"",
				formatWorkingAgents(telemetry),
				"",
				formatAvailableAgents(capabilities),
			].join("\n\n"),
		);
	});

	ctx.commands.register(
		"/integrity",
		"Show Scarlett integrity report",
		async () => {
			ctx.addInfoMessage(formatScarlettIntegrityReport(ctx.state.scarlettIntegrityReport.value));
		},
		["/scarlett"],
	);
}
