import { compactHistory } from "@takumi/agent";
import { gitDiff, reconstructFromDaemon } from "@takumi/bridge";
import type { Message } from "@takumi/core";
import type { AppCommandContext } from "./app-command-context.js";
import { registerChitraguptaCommands } from "./app-commands-chitragupta.js";
import {
	applyThinkingLevel,
	cycleProviderModel,
	cycleThinkingLevel,
	describeThinkingLevel,
	getThinkingLevel,
	normalizeThinkingLevel,
} from "./runtime-ux.js";

export function registerCoreCommands(ctx: AppCommandContext): void {
	ctx.commands.register("/quit", "Exit Takumi", () => ctx.quit(), ["/exit"]);
	ctx.commands.register("/clear", "Clear conversation", () => {
		ctx.state.messages.value = [];
		ctx.agentRunner?.clearHistory();
	});
	ctx.commands.register("/model", "Change model (tab for autocomplete)", (args) => {
		const trimmed = args.trim();
		const provider = ctx.state.provider.value;
		const models = ctx.state.availableProviderModels.value[provider] ?? [];
		if (!args) {
			const lines = [
				`Current model: ${ctx.state.model.value}  (provider: ${provider})`,
				models.length > 0
					? `Available for ${provider}:\n${models.map((m) => `  ${m}`).join("\n")}`
					: "Use /model <name> to set a model (any model ID is accepted).",
				"",
				"Shortcuts: /model next | /model prev",
			];
			ctx.addInfoMessage(lines.join("\n"));
			return;
		}

		if (trimmed === "next" || trimmed === "cycle") {
			const selected = cycleProviderModel(ctx.state, 1);
			ctx.addInfoMessage(
				selected
					? `Model cycled to: ${selected} (${provider})`
					: `No provider-scoped model catalog is available for ${provider}`,
			);
			return;
		}

		if (trimmed === "prev" || trimmed === "previous") {
			const selected = cycleProviderModel(ctx.state, -1);
			ctx.addInfoMessage(
				selected
					? `Model cycled to: ${selected} (${provider})`
					: `No provider-scoped model catalog is available for ${provider}`,
			);
			return;
		}

		ctx.state.model.value = trimmed;
		ctx.addInfoMessage(`Model set to: ${trimmed}`);
	});
	ctx.commands.register("/provider", "Switch AI provider (tab for autocomplete)", async (args) => {
		const providerModels = ctx.state.availableProviderModels.value;
		const knownProviders = ctx.state.availableProviders.value;
		if (!args) {
			const current = ctx.state.provider.value;
			const lines = knownProviders.map((p) => {
				const marker = p === current ? "▶ " : "  ";
				const count = providerModels[p]?.length ?? 0;
				return `${marker}${p.padEnd(12)} (${count} models)`;
			});
			ctx.addInfoMessage(`Available providers:\n${lines.join("\n")}\n\nUse /provider <name> to switch.`);
			return;
		}

		const name = args.trim().toLowerCase();
		if (!knownProviders.includes(name) && name !== "custom") {
			ctx.addInfoMessage(`Unknown provider: "${name}"\nAvailable: ${knownProviders.join(", ")}`);
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
				const defaultModel = providerModels[name]?.[1] ?? providerModels[name]?.[0] ?? "";
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
		const defaultModel = providerModels[name]?.[1] ?? providerModels[name]?.[0] ?? "";
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
		const bridge = ctx.state.chitraguptaBridge.value;
		if (bridge?.isConnected) {
			void bridge
				.contextLoad(process.cwd())
				.then((loaded) => {
					if (loaded.assembled) {
						ctx.state.chitraguptaMemory.value = loaded.assembled;
					}
				})
				.catch(() => {
					/* best effort */
				});
		}
		ctx.addInfoMessage(
			`Compacted ${result.compactedTurns} turns${bridge?.isConnected ? " and refreshed hub context" : ""}`,
		);
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
		const bridge = ctx.state.chitraguptaBridge.value;
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
		if (args.startsWith("dates")) {
			if (!bridge?.isConnected) {
				ctx.addInfoMessage("/session dates requires Chitragupta connection");
				return;
			}
			const project = args.split(/\s+/).slice(1).join(" ").trim() || process.cwd();
			try {
				const dates = await bridge.sessionDates(project);
				if (dates.length === 0) return ctx.addInfoMessage("No session dates found");
				ctx.addInfoMessage(`Session dates (${dates.length}):\n${dates.map((d, i) => `${i + 1}. ${d}`).join("\n")}`);
			} catch (err) {
				ctx.addInfoMessage(`Failed to list session dates: ${(err as Error).message}`);
			}
			return;
		}
		if (args === "projects") {
			if (!bridge?.isConnected) {
				ctx.addInfoMessage("/session projects requires Chitragupta connection");
				return;
			}
			try {
				const projects = await bridge.sessionProjects();
				if (projects.length === 0) return ctx.addInfoMessage("No projects tracked");
				const lines = projects.map(
					(p, i) => `${i + 1}. **${p.project}** — ${p.sessionCount} sessions (last: ${p.lastActive})`,
				);
				ctx.addInfoMessage(`Projects (${projects.length}):\n${lines.join("\n")}`);
			} catch (err) {
				ctx.addInfoMessage(`Failed to list projects: ${(err as Error).message}`);
			}
			return;
		}
		if (args.startsWith("delete ")) {
			if (!bridge?.isConnected) {
				ctx.addInfoMessage("/session delete requires Chitragupta connection");
				return;
			}
			const id = args.slice(7).trim();
			if (!id) {
				ctx.addInfoMessage("Usage: /session delete <session-id>");
				return;
			}
			try {
				const result = await bridge.sessionDelete(id);
				ctx.addInfoMessage(result.deleted ? `✓ Session ${id} deleted` : `Session ${id} not found`);
			} catch (err) {
				ctx.addInfoMessage(`Failed to delete session: ${(err as Error).message}`);
			}
			return;
		}
		if (args.startsWith("resume ")) {
			const sessionId = args.slice(7).trim();
			if (!sessionId) return;
			if (ctx.resumeSession) {
				await ctx.resumeSession(sessionId);
				return;
			}
			ctx.addInfoMessage("Session resume is unavailable in this runtime.");
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
		if (args.startsWith("attach ")) {
			const sessionId = args.slice(7).trim();
			if (!sessionId) {
				ctx.addInfoMessage("Usage: /session attach <daemon-session-id>");
				return;
			}
			if (!bridge?.isConnected) {
				ctx.addInfoMessage("/session attach requires Chitragupta connection");
				return;
			}
			ctx.addInfoMessage(`Attaching daemon session ${sessionId}...`);
			try {
				const recovered = await reconstructFromDaemon(bridge, sessionId);
				if (!recovered || recovered.messages.length === 0) {
					ctx.addInfoMessage(`Session "${sessionId}" not found on daemon or has no messages.`);
					return;
				}
				const session: import("@takumi/core").SessionData = {
					id: recovered.sessionId,
					title:
						recovered.messages[0]?.content[0]?.type === "text"
							? recovered.messages[0].content[0].text.slice(0, 80).replace(/\n/g, " ")
							: "Recovered session",
					messages: recovered.messages,
					model: ctx.state.model.value,
					createdAt: recovered.createdAt,
					updatedAt: recovered.updatedAt,
					tokenUsage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
				};
				if (ctx.activateSession) {
					await ctx.activateSession(
						session,
						`Attached daemon session ${recovered.sessionId} (${recovered.turnCount} turns).`,
						"resume",
					);
				} else {
					ctx.addInfoMessage("Session activation is unavailable in this runtime.");
				}
			} catch (err) {
				ctx.addInfoMessage(`Failed to attach session: ${(err as Error).message}`);
			}
			return;
		}
		ctx.addInfoMessage("Usage: /session [info|list|resume <id>|attach <id>|save|dates [project]|projects|delete <id>]");
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
		const trimmed = args.trim();
		const currentLevel = getThinkingLevel(ctx.state.thinking.value, ctx.state.thinkingBudget.value);
		if (!args) {
			const nextLevel = cycleThinkingLevel(ctx.state, 1);
			return ctx.addInfoMessage(`Thinking level: ${describeThinkingLevel(nextLevel)}`);
		}
		if (trimmed === "on") {
			const level = applyThinkingLevel(ctx.state, currentLevel === "off" ? "normal" : currentLevel);
			return ctx.addInfoMessage(`Thinking level: ${describeThinkingLevel(level)}`);
		}
		if (trimmed === "off") {
			applyThinkingLevel(ctx.state, "off");
			return ctx.addInfoMessage("Thinking level: Off");
		}
		if (trimmed === "next") {
			const level = cycleThinkingLevel(ctx.state, 1);
			return ctx.addInfoMessage(`Thinking level: ${describeThinkingLevel(level)}`);
		}
		if (trimmed === "prev" || trimmed === "previous") {
			const level = cycleThinkingLevel(ctx.state, -1);
			return ctx.addInfoMessage(`Thinking level: ${describeThinkingLevel(level)}`);
		}
		if (trimmed === "level") {
			return ctx.addInfoMessage(
				`Current thinking level: ${describeThinkingLevel(currentLevel)}\nAvailable: off, brief, normal, deep, max`,
			);
		}
		if (trimmed.startsWith("level ")) {
			const level = normalizeThinkingLevel(trimmed.slice(6));
			if (!level) {
				ctx.addInfoMessage("Invalid thinking level — use one of: off, brief, normal, deep, max");
				return;
			}
			applyThinkingLevel(ctx.state, level);
			return ctx.addInfoMessage(`Thinking level: ${describeThinkingLevel(level)}`);
		}
		const directLevel = normalizeThinkingLevel(trimmed);
		if (directLevel) {
			applyThinkingLevel(ctx.state, directLevel);
			return ctx.addInfoMessage(`Thinking level: ${describeThinkingLevel(directLevel)}`);
		}
		if (trimmed.startsWith("budget ")) {
			const budget = parseInt(trimmed.slice(7).trim(), 10);
			if (Number.isNaN(budget) || budget <= 0)
				return ctx.addInfoMessage(`Invalid budget: "${trimmed.slice(7).trim()}" — must be a positive number`);
			ctx.state.thinkingBudget.value = budget;
			ctx.state.thinking.value = true;
			return ctx.addInfoMessage(
				`Thinking budget set to ${budget} tokens (current level: ${describeThinkingLevel(getThinkingLevel(true, budget))})`,
			);
		}
		ctx.addInfoMessage("Usage: /think [on|off|next|prev|level [off|brief|normal|deep|max]|budget <tokens>]");
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
		if (ctx.activateSession) {
			await ctx.activateSession(
				forked,
				`Session forked.\n  Source : ${currentId}\n  New    : ${forked.id}\n\nYou are now on the forked session. The original is unchanged.`,
				"new",
			);
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

	ctx.commands.register("/replay", "Replay a past session (/replay <session-id> | /replay exit)", async (args) => {
		if (!args) {
			ctx.addInfoMessage(
				"Usage: /replay <session-id>  — load session for step-through replay\n       /replay exit          — leave replay mode",
			);
			return;
		}

		if (args.trim() === "exit") {
			if (!ctx.state.replayMode.value) {
				ctx.addInfoMessage("Not currently in replay mode.");
				return;
			}
			ctx.state.replayMode.value = false;
			ctx.state.replayIndex.value = 0;
			ctx.state.replayTurns.value = [];
			ctx.state.replaySessionId.value = "";
			ctx.addInfoMessage("Exited replay mode.");
			return;
		}

		const sessionId = args.trim();
		const bridge = ctx.state.chitraguptaBridge.value;
		if (!bridge) {
			ctx.addInfoMessage("Chitragupta bridge is not connected. Cannot replay from daemon.");
			return;
		}

		ctx.addInfoMessage(`Loading session ${sessionId} from daemon...`);
		try {
			const recovered = await reconstructFromDaemon(bridge, sessionId);
			if (!recovered) {
				ctx.addInfoMessage(`Session "${sessionId}" not found on daemon.`);
				return;
			}
			if (recovered.messages.length === 0) {
				ctx.addInfoMessage(`Session "${sessionId}" has no messages to replay.`);
				return;
			}
			ctx.state.replayMode.value = true;
			ctx.state.replayTurns.value = recovered.messages;
			ctx.state.replayIndex.value = 0;
			ctx.state.replaySessionId.value = sessionId;
			const total = recovered.messages.length;
			ctx.addInfoMessage(
				`Replay mode: turn 1 of ${total} \u2014 use \u2190/\u2192 to navigate\n` +
					`Session: ${sessionId}  (${recovered.turnCount} turns, created ${new Date(recovered.createdAt).toLocaleString()})`,
			);
		} catch (err) {
			ctx.addInfoMessage(`Replay failed: ${(err as Error).message}`);
		}
	});

	// Register chitragupta-related commands (Phase 15 & 16)
	registerChitraguptaCommands(ctx);
}
