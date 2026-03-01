/**
 * Chitragupta-related slash commands (Phase 15 & 16).
 * Extracted from app-commands-core.ts to meet LOC limit.
 */

import type { AppCommandContext } from "./app-command-context.js";

export function registerChitraguptaCommands(ctx: AppCommandContext): void {
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
}
