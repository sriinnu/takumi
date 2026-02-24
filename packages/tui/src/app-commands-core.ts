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
}
