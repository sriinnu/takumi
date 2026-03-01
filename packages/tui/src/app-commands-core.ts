import { compactHistory } from "@takumi/agent";
import { gitDiff } from "@takumi/bridge";
import type { Message } from "@takumi/core";
import type { AppCommandContext } from "./app-command-context.js";
import { KNOWN_PROVIDERS, PROVIDER_MODELS } from "./completion.js";

export function registerCoreCommands(ctx: AppCommandContext): void {
	ctx.commands.register("/quit", "Exit Takumi", () => ctx.quit(), ["/exit"]);
	ctx.commands.register("/clear", "Clear conversation", () => {
		ctx.state.messages.value = [];
		ctx.agentRunner?.clearHistory();
	});
	ctx.commands.register("/model", "Change model (tab for autocomplete)", (args) => {
		if (!args) {
			const prov = ctx.state.provider.value;
			const models = PROVIDER_MODELS[prov] ?? [];
			const lines = [
				`Current model: ${ctx.state.model.value}  (provider: ${prov})`,
				models.length > 0
					? `Available for ${prov}:\n${models.map((m) => `  ${m}`).join("\n")}`
					: "Use /model <name> to set a model (any model ID is accepted).",
			];
			ctx.addInfoMessage(lines.join("\n"));
			return;
		}
		ctx.state.model.value = args.trim();
		ctx.addInfoMessage(`Model set to: ${args.trim()}`);
	});
	ctx.commands.register("/provider", "Switch AI provider (tab for autocomplete)", async (args) => {
		if (!args) {
			const current = ctx.state.provider.value;
			const lines = KNOWN_PROVIDERS.map((p) => {
				const marker = p === current ? "▶ " : "  ";
				const count = PROVIDER_MODELS[p]?.length ?? 0;
				return `${marker}${p.padEnd(12)} (${count} models)`;
			});
			ctx.addInfoMessage(`Available providers:\n${lines.join("\n")}\n\nUse /provider <name> to switch.`);
			return;
		}

		const name = args.trim().toLowerCase();
		if (!KNOWN_PROVIDERS.includes(name) && name !== "custom") {
			ctx.addInfoMessage(`Unknown provider: "${name}"\nAvailable: ${KNOWN_PROVIDERS.join(", ")}`);
			return;
		}
		if (ctx.providerFactory && ctx.agentRunner) {
			ctx.addInfoMessage(`Switching provider to ${name}...`);
			try {
				const newSendFn = await ctx.providerFactory(name);
				if (!newSendFn) {
					ctx.addInfoMessage(
						`Cannot switch to "${name}": missing API key.\nSet the corresponding API key environment variable and restart.`,
					);
					return;
				}
				ctx.agentRunner.setSendMessageFn(newSendFn);
				ctx.state.provider.value = name;
				const defaultModel = PROVIDER_MODELS[name]?.[1] ?? PROVIDER_MODELS[name]?.[0] ?? "";
				ctx.state.model.value = defaultModel || ctx.state.model.value;
				ctx.addInfoMessage(
					defaultModel
						? `Switched to provider: ${name}\nDefault model: ${defaultModel}`
						: `Switched to provider: ${name}`,
				);
			} catch (err) {
				ctx.addInfoMessage(`Failed to switch provider: ${(err as Error).message}`);
			}
			return;
		}
		ctx.state.provider.value = name;
		const defaultModel = PROVIDER_MODELS[name]?.[1] ?? PROVIDER_MODELS[name]?.[0] ?? "";
		if (defaultModel) ctx.state.model.value = defaultModel;
		ctx.addInfoMessage(
			`Provider set to: ${name}${defaultModel ? ` | model: ${defaultModel}` : ""}\n` +
				`Note: restart with --provider ${name} to apply fully if the provider wasn't initialized at startup.`,
		);
	});
	ctx.commands.register("/theme", "Change theme", (args) => {
		if (args) ctx.state.theme.value = args;
	});
	ctx.commands.register("/help", "Show help", () => {
		const helpText = ctx.commands
			.list()
			.map((cmd) => `  ${cmd.name.padEnd(16)} ${cmd.description}`)
			.join("\n");
		ctx.addInfoMessage(`Available commands:\n${helpText}`);
	});
	ctx.commands.register("/status", "Show session statistics", () => {
		ctx.addInfoMessage(
			`Session: ${ctx.state.sessionId.value || "(none)"}\n` +
				`Turns: ${ctx.state.turnCount.value}\n` +
				`Tokens: ${ctx.state.totalTokens.value} (in: ${ctx.state.totalInputTokens.value}, out: ${ctx.state.totalOutputTokens.value})\n` +
				`Cost: ${ctx.state.formattedCost.value}\n` +
				`Messages: ${ctx.state.messageCount.value}\n` +
				`Model: ${ctx.state.model.value}`,
		);
	});
	ctx.commands.register("/compact", "Trigger conversation compaction", () => {
		const messages = ctx.state.messages.value;
		if (messages.length === 0) return ctx.addInfoMessage("Nothing to compact");
		const result = compactHistory(messages, { keepRecent: 10 });
		if (result.compactedTurns === 0) return ctx.addInfoMessage("No compaction needed");
		ctx.state.messages.value = result.messages;
		ctx.agentRunner?.clearHistory();
		ctx.addInfoMessage(`Compacted ${result.compactedTurns} turns`);
	});
	ctx.commands.register("/session", "Session management", async (args) => {
		if (!args || args === "info") {
			ctx.addInfoMessage(
				[
					`Session: ${ctx.state.sessionId.value || "(none)"}`,
					`Model: ${ctx.state.model.value}`,
					`Turns: ${ctx.state.turnCount.value}`,
					`Tokens: ${ctx.state.totalTokens.value}`,
					`Cost: ${ctx.state.formattedCost.value}`,
				].join("\n"),
			);
			return;
		}
		if (args === "list") {
			const { listSessions } = await import("@takumi/core");
			try {
				const sessions = await listSessions(20);
				if (sessions.length === 0) return ctx.addInfoMessage("No saved sessions found.");
				ctx.addInfoMessage(
					`Saved sessions:\n${sessions.map((s) => `  ${s.id}  ${new Date(s.updatedAt).toLocaleString()}  (${s.messageCount} msgs)  ${s.title}`).join("\n")}`,
				);
			} catch (err) {
				ctx.addInfoMessage(`Failed to list sessions: ${(err as Error).message}`);
			}
			return;
		}
		if (args.startsWith("resume ")) {
			const sessionId = args.slice(7).trim();
			if (!sessionId) return;
			const { loadSession } = await import("@takumi/core");
			const loaded = await loadSession(sessionId);
			if (!loaded) return ctx.addInfoMessage(`Session not found: ${sessionId}`);
			ctx.state.sessionId.value = loaded.id;
			ctx.state.model.value = loaded.model;
			ctx.state.messages.value = loaded.messages;
			ctx.state.totalInputTokens.value = loaded.tokenUsage.inputTokens;
			ctx.state.totalOutputTokens.value = loaded.tokenUsage.outputTokens;
			ctx.state.totalCost.value = loaded.tokenUsage.totalCost;
			ctx.agentRunner?.clearHistory();
			ctx.startAutoSaver();
			ctx.addInfoMessage(`Resumed session: ${sessionId} (${loaded.messages.length} messages)`);
			return;
		}
		if (args === "save") {
			const { saveSession } = await import("@takumi/core");
			try {
				const data = ctx.buildSessionData();
				await saveSession(data);
				ctx.addInfoMessage(`Session saved: ${data.id}`);
			} catch (err) {
				ctx.addInfoMessage(`Failed to save session: ${(err as Error).message}`);
			}
			return;
		}
		ctx.addInfoMessage("Usage: /session [info|list|resume <id>|save]");
	});
	ctx.commands.register("/diff", "Show git diff", () => {
		const diff = gitDiff(process.cwd());
		if (!diff) return ctx.addInfoMessage("No changes");
		const diffMessage: Message = {
			id: `diff-${Date.now()}`,
			role: "assistant",
			content: [{ type: "text", text: `\`\`\`diff\n${diff}\n\`\`\`` }],
			timestamp: Date.now(),
		};
		ctx.state.addMessage(diffMessage);
	});
	ctx.commands.register("/cost", "Show token costs breakdown", () => {
		const inCost = (ctx.state.totalInputTokens.value * 3) / 1_000_000;
		const outCost = (ctx.state.totalOutputTokens.value * 15) / 1_000_000;
		ctx.addInfoMessage(
			`Cost breakdown:\n  Input:  ${ctx.state.totalInputTokens.value} tokens  ($${inCost.toFixed(4)})\n` +
				`  Output: ${ctx.state.totalOutputTokens.value} tokens  ($${outCost.toFixed(4)})\n` +
				`  Total:  ${ctx.state.formattedCost.value}`,
		);
	});
	ctx.commands.register("/sidebar", "Toggle sidebar", () => {
		ctx.state.sidebarVisible.value = !ctx.state.sidebarVisible.value;
	});
	ctx.commands.register("/undo", "Undo last file change", async () => {
		ctx.addInfoMessage("Running: git checkout -- .");
		try {
			const { execSync } = await import("node:child_process");
			const result = execSync("git diff --name-only", { encoding: "utf-8", cwd: process.cwd() }).trim();
			if (!result) return ctx.addInfoMessage("No changes to undo");
			execSync("git checkout -- .", { cwd: process.cwd() });
			ctx.addInfoMessage(`Reverted changes in:\n${result}`);
		} catch (err) {
			ctx.addInfoMessage(`Undo failed: ${(err as Error).message}`);
		}
	});
	ctx.commands.register("/permission", "Manage tool permissions", (args) => {
		if (!args) {
			if (!ctx.agentRunner) return ctx.addInfoMessage("No agent runner configured");
			const rules = ctx.agentRunner.permissions.getRules();
			if (rules.length === 0) return ctx.addInfoMessage("No permission rules configured");
			ctx.addInfoMessage(
				`Permission rules:\n${rules.map((r) => `  ${r.allow ? "allow" : "deny"} ${r.tool} ${r.pattern} (${r.scope})`).join("\n")}`,
			);
			return;
		}
		if (args === "reset") {
			ctx.agentRunner?.permissions.reset();
			ctx.addInfoMessage("Session permissions reset");
			return;
		}
		ctx.addInfoMessage("Usage: /permission [reset]");
	});
	ctx.commands.register("/think", "Toggle extended thinking", (args) => {
		if (!args) {
			ctx.state.thinking.value = !ctx.state.thinking.value;
			return ctx.addInfoMessage(
				`Extended thinking ${ctx.state.thinking.value ? "enabled" : "disabled"}${ctx.state.thinking.value ? ` (budget: ${ctx.state.thinkingBudget.value} tokens)` : ""}`,
			);
		}
		if (args === "on") {
			ctx.state.thinking.value = true;
			return ctx.addInfoMessage(`Extended thinking enabled (budget: ${ctx.state.thinkingBudget.value} tokens)`);
		}
		if (args === "off") {
			ctx.state.thinking.value = false;
			return ctx.addInfoMessage("Extended thinking disabled");
		}
		if (args.startsWith("budget ")) {
			const budget = parseInt(args.slice(7).trim(), 10);
			if (Number.isNaN(budget) || budget <= 0)
				return ctx.addInfoMessage(`Invalid budget: "${args.slice(7).trim()}" — must be a positive number`);
			ctx.state.thinkingBudget.value = budget;
			return ctx.addInfoMessage(`Thinking budget set to ${budget} tokens`);
		}
		ctx.addInfoMessage("Usage: /think [on|off|budget <tokens>]");
	});

	ctx.commands.register("/fork", "Fork the current session into a new branch", async (_args) => {
		const currentId = ctx.state.sessionId.value;
		if (!currentId) {
			ctx.addInfoMessage("No active session to fork. Start chatting first or use /session save.");
			return;
		}
		const { forkSession, saveSession } = await import("@takumi/core");
		// Save current state first so the fork captures latest messages
		try {
			await saveSession(ctx.buildSessionData());
		} catch {}
		const forked = await forkSession(currentId);
		if (!forked) {
			ctx.addInfoMessage(`Fork failed: session "${currentId}" not found on disk. Try /session save first.`);
			return;
		}
		ctx.state.sessionId.value = forked.id;
		ctx.startAutoSaver();
		ctx.addInfoMessage(
			`Session forked.\n  Source : ${currentId}\n  New    : ${forked.id}\n\nYou are now on the forked session. The original is unchanged.`,
		);
	});

	ctx.commands.register("/index", "Index codebase for RAG context (/index [--rebuild])", async (args) => {
		const force = args?.trim() === "--rebuild";
		const { buildIndex, indexStats } = await import("@takumi/agent");
		ctx.addInfoMessage(`Indexing codebase${force ? " (forced rebuild)" : ""}...`);
		try {
			const index = await buildIndex(process.cwd(), force);
			const stats = indexStats(index);
			ctx.addInfoMessage(
				`Index built: ${stats.files} files, ${stats.symbols} symbols\nBuilt at: ${stats.builtAt.toLocaleString()}`,
			);
		} catch (err) {
			ctx.addInfoMessage(`Indexing failed: ${(err as Error).message}`);
		}
	});

	ctx.commands.register("/budget", "Show or set spend limit (/budget [amount])", async (args) => {
		const spent = ctx.state.totalCost.value;
		const { loadConfig } = await import("@takumi/core");
		const cfg = loadConfig();
		const limit = cfg.maxCostUsd;

		if (!args) {
			const limitStr = limit != null ? `$${limit.toFixed(4)}` : "unlimited";
			const usedPct = limit != null && limit > 0 ? ` (${((spent / limit) * 100).toFixed(1)}% used)` : "";
			ctx.addInfoMessage(
				`Budget:\n  Spent : $${spent.toFixed(4)}\n  Limit : ${limitStr}${usedPct}\n\nUse /budget <amount> to set a limit (e.g. /budget 1.00).`,
			);
			return;
		}

		const parsed = parseFloat(args.trim());
		if (Number.isNaN(parsed) || parsed <= 0) {
			ctx.addInfoMessage(`Invalid amount: "${args.trim()}" — must be a positive number (e.g. /budget 2.50)`);
			return;
		}
		// Persist to runtime config — effective for the current session
		cfg.maxCostUsd = parsed;
		ctx.addInfoMessage(`Budget limit set to $${parsed.toFixed(4)} for this session.`);
	});

	ctx.commands.register("/tree", "Print directory tree (/tree [path] [depth])", async (args) => {
		const parts = args.trim().split(/\s+/).filter(Boolean);
		const { join, resolve, basename } = await import("node:path");
		const root = process.cwd();
		const target = parts[0] ? resolve(root, parts[0]) : root;
		const maxDepth = Math.min(parts[1] ? parseInt(parts[1], 10) || 3 : 3, 6);

		const { scanDirectory, loadGitignore } = await import("./panels/file-tree-helpers.js");
		let patterns: string[] = [];
		try {
			patterns = await loadGitignore(root);
		} catch {}

		const nodes = await scanDirectory(target, maxDepth, patterns);

		const lines: string[] = [`${basename(target)}/`];
		function render(list: typeof nodes, prefix: string): void {
			for (let i = 0; i < list.length; i++) {
				const node = list[i];
				const isLast = i === list.length - 1;
				const connector = isLast ? "\u2514\u2500 " : "\u251C\u2500 ";
				const icon = node.isDirectory ? "\u25B8 " : "  ";
				lines.push(`${prefix}${connector}${icon}${node.name}${node.isDirectory ? "/" : ""}`);
				if (node.isDirectory && node.children?.length) {
					render(node.children, prefix + (isLast ? "   " : "\u2502  "));
				}
			}
		}
		render(nodes, "");

		const display = lines.join("\n");
		const relPath = parts[0] ? join(parts[0]) : ".";
		ctx.addInfoMessage(`\`\`\`\n${relPath}/ (depth ${maxDepth})\n${display}\n\`\`\``);
	});

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
}
