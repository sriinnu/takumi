import { compactHistory } from "@takumi/agent";
import { gitDiff } from "@takumi/bridge";
import {
	type EnsuredTakumiConfigFile,
	ensureTakumiConfigFile,
	formatTakumiConfigInspection,
	getTakumiConfigPath,
	inspectTakumiUserConfig,
	type Message,
	type TakumiConfigFileTarget,
} from "@takumi/core";
import { buildBudgetReport, buildCostReport } from "../cost-report.js";
import { formatGroupedCommandHelp } from "../dialogs/command-palette-groups.js";
import { formatKeybindingReloadSummary } from "../input/keybinding-config.js";
import {
	applyThinkingLevel,
	cycleProviderModel,
	cycleThinkingLevel,
	describeThinkingLevel,
	getThinkingLevel,
	normalizeThinkingLevel,
} from "../runtime-ux.js";
import { formatSlashCommandOrigin } from "../slash-commands/pack.js";
import type { AppCommandContext } from "./app-command-context.js";
import { buildModelOverrideWarning, buildProviderOverrideWarning } from "./app-command-route-warnings.js";
import { registerChitraguptaCommands } from "./app-commands-chitragupta.js";

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

		const overrideWarning = buildModelOverrideWarning(ctx.state, trimmed);
		ctx.state.model.value = trimmed;
		ctx.addInfoMessage([`Model set to: ${trimmed}`, overrideWarning].filter(Boolean).join("\n"));
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
			const overrideWarning = buildProviderOverrideWarning(ctx.state, name);
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
				const defaultModel = providerModels[name]?.[0] ?? "";
				ctx.state.model.value = defaultModel || ctx.state.model.value;
				ctx.addInfoMessage(
					[
						defaultModel
							? `Switched to provider: ${name}\nDefault model: ${defaultModel}`
							: `Switched to provider: ${name}`,
						overrideWarning,
					]
						.filter(Boolean)
						.join("\n"),
				);
			} catch (err) {
				ctx.addInfoMessage(`Failed to switch provider: ${(err as Error).message}`);
			}
			return;
		}
		const overrideWarning = buildProviderOverrideWarning(ctx.state, name);
		ctx.state.provider.value = name;
		const defaultModel = providerModels[name]?.[0] ?? "";
		if (defaultModel) ctx.state.model.value = defaultModel;
		ctx.addInfoMessage(
			[
				`Provider set to: ${name}${defaultModel ? ` | model: ${defaultModel}` : ""}\n` +
					`Note: restart with --provider ${name} to apply fully if the provider wasn't initialized at startup.`,
				overrideWarning,
			]
				.filter(Boolean)
				.join("\n"),
		);
	});
	ctx.commands.register("/theme", "Change theme", (args) => {
		if (args) ctx.state.theme.value = args;
	});
	ctx.commands.register("/help", "Show help", () => {
		ctx.addInfoMessage(
			formatGroupedCommandHelp(
				ctx.commands.list().map((cmd) => ({
					name: cmd.name,
					description: cmd.description,
					type: "command" as const,
					aliases: cmd.aliases,
					source: cmd.source,
					originLabel: formatSlashCommandOrigin(cmd) ?? undefined,
				})),
			),
		);
	});
	ctx.commands.register(
		"/config",
		"Create or inspect Takumi config files",
		async (args) => {
			const trimmed = args.trim().toLowerCase();

			if (trimmed === "path") {
				const inspection = inspectTakumiUserConfig(process.cwd());
				ctx.addInfoMessage(inspection.activePath ?? getTakumiConfigPath("global"));
				return;
			}
			if (trimmed === "show") {
				ctx.addInfoMessage(formatTakumiConfigInspection(inspectTakumiUserConfig(process.cwd())));
				return;
			}
			if (trimmed && trimmed !== "global" && trimmed !== "project") {
				ctx.addInfoMessage("Usage: /config [show|path|global|project]");
				return;
			}

			const target = (trimmed || "active") as TakumiConfigFileTarget;
			const ensured = await ensureTakumiConfigFile(target, process.cwd());
			const inspection = inspectTakumiUserConfig(process.cwd());
			ctx.addInfoMessage(formatConfigCommandMessage(ensured, inspection));
		},
		{ getArgumentCompletions: getConfigCommandCompletions },
	);
	ctx.commands.register("/keybindings", "Create or reload the user keybindings config", async (args) => {
		const trimmed = args.trim().toLowerCase();
		if (!trimmed || trimmed === "path" || trimmed === "show") {
			if (!ctx.ensureKeybindingsFile) {
				ctx.addInfoMessage("Keybindings config management is unavailable in this runtime.");
				return;
			}
			const ensured = await ctx.ensureKeybindingsFile();
			ctx.addInfoMessage(
				`${ensured.created ? "Created keybindings config" : "Keybindings config"}: ${ensured.filePath}\n` +
					"Edit the file, then run /keybindings reload or restart Takumi to apply changes.",
			);
			return;
		}
		if (trimmed === "reload") {
			if (!ctx.reloadKeybindings) {
				ctx.addInfoMessage("Keybinding reload is unavailable in this runtime.");
				return;
			}
			const result = await ctx.reloadKeybindings();
			ctx.addInfoMessage(formatKeybindingReloadSummary(result));
			return;
		}

		ctx.addInfoMessage("Usage: /keybindings [path|reload]");
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
		ctx.addInfoMessage(buildCostReport(ctx.state, ctx.config.maxCostUsd));
	});
	ctx.commands.register("/sidebar", "Toggle sidebar", () => {
		ctx.state.sidebarVisible.value = !ctx.state.sidebarVisible.value;
	});
	ctx.commands.register("/undo", "Undo last file change", async () => {
		ctx.addInfoMessage("Running: git checkout -- .");
		try {
			const { execFileSync } = await import("node:child_process");
			const opts = { encoding: "utf-8" as const, cwd: process.cwd(), timeout: 10_000 };
			const result = (execFileSync("git", ["diff", "--name-only"], opts) as string).trim();
			if (!result) return ctx.addInfoMessage("No changes to undo");
			execFileSync("git", ["checkout", "--", "."], opts);
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
		const trimmed = args.trim();
		const normalized = trimmed.toLowerCase();
		const limit = ctx.config.maxCostUsd;

		if (!args) {
			ctx.addInfoMessage(buildBudgetReport(ctx.state, limit));
			return;
		}

		if (["off", "clear", "none", "unlimited"].includes(normalized)) {
			ctx.config.maxCostUsd = undefined;
			ctx.agentRunner?.setBudgetLimit?.(undefined);
			ctx.addInfoMessage(`Budget limit cleared for this session.\n\n${buildBudgetReport(ctx.state, undefined)}`);
			return;
		}

		const parsed = parseFloat(trimmed);
		if (Number.isNaN(parsed) || parsed <= 0) {
			ctx.addInfoMessage(
				`Invalid amount: "${trimmed}" — must be a positive number (e.g. /budget 2.50) or one of: off, clear, unlimited`,
			);
			return;
		}
		ctx.config.maxCostUsd = parsed;
		ctx.agentRunner?.setBudgetLimit?.(parsed);
		ctx.addInfoMessage(
			`Budget limit set to $${parsed.toFixed(4)} for this session.\n\n${buildBudgetReport(ctx.state, parsed)}`,
		);
	});

	ctx.commands.register("/tree", "Print directory tree (/tree [path] [depth])", async (args) => {
		const parts = args.trim().split(/\s+/).filter(Boolean);
		const { join, resolve, basename } = await import("node:path");
		const root = process.cwd();
		const target = parts[0] ? resolve(root, parts[0]) : root;
		const maxDepth = Math.min(parts[1] ? parseInt(parts[1], 10) || 3 : 3, 6);

		const { scanDirectory, loadGitignore } = await import("../panels/file-tree-helpers.js");
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

	// Register chitragupta-related commands (Phase 15 & 16)
	registerChitraguptaCommands(ctx);
}

function getConfigCommandCompletions(partial: string): string[] {
	const options = ["show", "path", "global", "project"];
	const trimmed = partial.trim().toLowerCase();
	if (!trimmed) return options;
	return options.filter((option) => option.startsWith(trimmed));
}

function formatConfigCommandMessage(
	ensured: EnsuredTakumiConfigFile,
	inspection: ReturnType<typeof inspectTakumiUserConfig>,
): string {
	return [
		ensured.created ? `Created Takumi config: ${ensured.filePath}` : `Takumi config: ${ensured.filePath}`,
		"",
		formatTakumiConfigInspection(inspection),
		"",
		"Project-local configs override global ones. Restart Takumi after edits to apply changes.",
		"Credentials usually come from environment variables or CLI auth helpers; the config file is best for defaults like model, theme, and thinking.",
	].join("\n");
}
