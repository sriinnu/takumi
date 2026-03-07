import { writeFile } from "node:fs/promises";
import type { AppCommandContext } from "./app-command-context.js";
import { formatMessagesAsMarkdown } from "./app-export.js";

export function registerCodingCommands(ctx: AppCommandContext): void {
	ctx.commands.register("/memory", "Search project memory", async (args) => {
		const bridge = ctx.state.chitraguptaBridge.value;
		if (!bridge || !ctx.state.chitraguptaConnected.value) {
			ctx.addInfoMessage("Memory search requires Chitragupta connection (not connected)");
			return;
		}
		if (!args) {
			ctx.addInfoMessage("Usage: /memory <search query>\n       /memory scopes");
			return;
		}
		if (args.trim() === "scopes") {
			try {
				const scopes = await bridge.memoryScopes();
				if (scopes.length === 0) return ctx.addInfoMessage("No memory scopes found");
				const lines = scopes.map((s, i) => `${i + 1}. **${s.type}**${s.path ? ` — ${s.path}` : ""}`);
				ctx.addInfoMessage(`Memory scopes (${scopes.length}):\n${lines.join("\n")}`);
			} catch (err) {
				ctx.addInfoMessage(`Failed to load memory scopes: ${(err as Error).message}`);
			}
			return;
		}
		ctx.addInfoMessage(`Searching memory for: ${args}...`);
		try {
			const results = await bridge.memorySearch(args, 10);
			if (results.length === 0) return ctx.addInfoMessage("No memory results found.");
			const formatted = results
				.map(
					(r, i) =>
						`  ${i + 1}. [${(r.relevance * 100).toFixed(0)}%]${r.source ? ` (${r.source})` : ""}\n     ${r.content.slice(0, 200)}`,
				)
				.join("\n");
			ctx.addInfoMessage(`Memory results:\n${formatted}`);
		} catch (err) {
			ctx.addInfoMessage(`Memory search failed: ${(err as Error).message}`);
		}
	});
	ctx.commands.register("/sessions", "List Chitragupta sessions", async (args) => {
		const bridge = ctx.state.chitraguptaBridge.value;
		if (!bridge || !ctx.state.chitraguptaConnected.value) {
			ctx.addInfoMessage("Session listing requires Chitragupta connection (not connected)");
			return;
		}
		try {
			const limit = args ? parseInt(args, 10) || 10 : 10;
			const sessions = await bridge.sessionList(limit);
			if (sessions.length === 0) return ctx.addInfoMessage("No Chitragupta sessions found.");
			ctx.addInfoMessage(
				`Chitragupta sessions:\n${sessions.map((s) => `  ${s.id}  ${new Date(s.timestamp).toLocaleDateString()}  (${s.turns} turns)  ${s.title}`).join("\n")}`,
			);
		} catch (err) {
			ctx.addInfoMessage(`Session listing failed: ${(err as Error).message}`);
		}
	});
	ctx.commands.register("/code", "Start coding agent", async (args) => {
		if (!args) return ctx.addInfoMessage("Usage: /code <task description>");
		if (!ctx.agentRunner) return ctx.addInfoMessage("No agent runner configured");
		const current = ctx.getActiveCoder();
		if (current?.isActive) {
			ctx.addInfoMessage("A coding task is already running. Cancel with Ctrl+C or wait for it to finish.");
			return;
		}
		if (current) await current.shutdown();
		const { CodingAgent } = await import("./coding-agent.js");
		const orchCfg = ctx.config.orchestration;
		const coder = new CodingAgent(ctx.state, ctx.agentRunner, {
			enableOrchestration: orchCfg?.enabled ?? false,
			maxValidationRetries: orchCfg?.maxValidationRetries ?? 3,
			autoPr: ctx.autoPr,
			autoShip: ctx.autoShip,
		});
		ctx.setActiveCoder(coder);
		if (orchCfg?.isolationMode) ctx.state.isolationMode.value = orchCfg.isolationMode;
		await coder.start(args);
	});
	ctx.commands.register("/export", "Export conversation to file", async (args) => {
		const messages = ctx.state.messages.value;
		if (messages.length === 0) return ctx.addInfoMessage("No messages to export");
		let format: "md" | "json" = "md";
		let outputPath = "";
		if (args) {
			for (const part of args.trim().split(/\s+/)) {
				if (part === "json") format = "json";
				else if (part === "md" || part === "markdown") format = "md";
				else outputPath = part;
			}
		}
		if (!outputPath) {
			const date = new Date().toISOString().slice(0, 10);
			outputPath = `./takumi-export-${date}.${format === "json" ? "json" : "md"}`;
		}
		try {
			const content =
				format === "json"
					? JSON.stringify(messages, null, 2)
					: formatMessagesAsMarkdown(messages, ctx.state.sessionId.value, ctx.state.model.value);
			await writeFile(outputPath, content, "utf-8");
			ctx.addInfoMessage(`Session exported to ${outputPath}`);
		} catch (err) {
			ctx.addInfoMessage(`Export failed: ${(err as Error).message}`);
		}
	});
	ctx.commands.register("/retry", "Retry last response", async (args) => {
		const messages = ctx.state.messages.value;
		if (messages.length === 0) return ctx.addInfoMessage("No messages to retry");
		if (!ctx.agentRunner) return ctx.addInfoMessage("No agent runner configured");
		if (ctx.agentRunner.isRunning) return ctx.addInfoMessage("Cannot retry while agent is running");
		const turnIndex = args ? parseInt(args.trim(), 10) : undefined;
		if (turnIndex !== undefined && (Number.isNaN(turnIndex) || turnIndex < 0)) {
			ctx.addInfoMessage(`Invalid turn number: "${args?.trim()}"`);
			return;
		}
		let lastUserText = "";
		let cutIndex = messages.length;
		if (turnIndex !== undefined) {
			cutIndex = Math.min(turnIndex, messages.length);
			ctx.addInfoMessage(`Retrying from turn ${turnIndex}...`);
		} else {
			while (cutIndex > 0 && messages[cutIndex - 1].role === "assistant") cutIndex--;
			ctx.addInfoMessage("Retrying last response...");
		}
		for (let i = cutIndex - 1; i >= 0 && !lastUserText; i--) {
			if (messages[i].role !== "user") continue;
			for (const block of messages[i].content) {
				if (block.type === "text") {
					lastUserText = block.text;
					break;
				}
			}
		}
		if (!lastUserText) return ctx.addInfoMessage("No user message found to retry");
		ctx.state.messages.value = messages.slice(0, cutIndex);
		ctx.agentRunner.clearHistory();
		await ctx.agentRunner.submit(lastUserText);
	});
	ctx.commands.register("/cluster", "Show cluster status", () => {
		const phase = ctx.state.clusterPhase.value;
		const id = ctx.state.clusterId.value;
		if (!id || phase === "idle") {
			ctx.addInfoMessage("No active cluster. Run /code <task> with orchestration enabled.");
			return;
		}
		ctx.addInfoMessage(
			`Cluster: ${id}\n  Phase:    ${phase}\n  Agents:   ${ctx.state.clusterAgentCount.value}\n` +
				`  Attempts: ${ctx.state.clusterValidationAttempt.value}\n  Isolation: ${ctx.state.isolationMode.value}`,
		);
	});
	ctx.commands.register("/validate", "Re-run cluster validation phase", () => {
		if (!ctx.state.clusterId.value) return ctx.addInfoMessage("No active cluster. Start one with /code <task>.");
		ctx.state.clusterCommand.value = { type: "validate" };
		ctx.addInfoMessage("Validation requested — cluster will re-run the validation phase.");
	});
	ctx.commands.register("/checkpoint", "List or save cluster checkpoints", async (args) => {
		const { CheckpointManager } = await import("@takumi/agent");
		const mgr = new CheckpointManager({ chitragupta: ctx.state.chitraguptaBridge.value ?? undefined });
		if (!args || args === "list") {
			const checkpoints = await mgr.list();
			if (checkpoints.length === 0) return ctx.addInfoMessage("No saved checkpoints found.");
			ctx.addInfoMessage(
				`Checkpoints (${checkpoints.length}):\n${checkpoints.map((cp) => `  ${cp.clusterId.slice(0, 24)}  ${new Date(cp.savedAt).toLocaleString()}  phase=${cp.phase}  "${cp.taskDescription.slice(0, 60)}"`).join("\n")}`,
			);
			return;
		}
		if (args === "save") {
			const clusterState = ctx.getActiveCoder()?.getOrchestrator()?.getState();
			if (!clusterState) return ctx.addInfoMessage("No active cluster to checkpoint. Start one with /code <task>.");
			await mgr.save(CheckpointManager.fromState(clusterState));
			ctx.addInfoMessage(`Checkpoint saved: ${clusterState.id} @ ${clusterState.phase}`);
			return;
		}
		ctx.addInfoMessage("Usage: /checkpoint [list|save]");
	});
	ctx.commands.register("/resume", "Resume cluster from checkpoint", async (args) => {
		if (!args) return ctx.addInfoMessage("Usage: /resume <clusterId>");
		if (!ctx.agentRunner) return ctx.addInfoMessage("No agent runner configured.");
		let coder = ctx.getActiveCoder();
		if (!coder) {
			const { CodingAgent } = await import("./coding-agent.js");
			const orchCfg = ctx.config.orchestration;
			coder = new CodingAgent(ctx.state, ctx.agentRunner, {
				enableOrchestration: orchCfg?.enabled ?? true,
				maxValidationRetries: orchCfg?.maxValidationRetries ?? 3,
				autoPr: ctx.autoPr,
				autoShip: ctx.autoShip,
			});
			ctx.setActiveCoder(coder);
		}
		await coder.resume(args.trim());
	});
	ctx.commands.register("/isolation", "Get/set cluster isolation mode", (args) => {
		const validModes = ["none", "worktree", "docker"] as const;
		if (!args)
			return ctx.addInfoMessage(
				`Isolation mode: ${ctx.state.isolationMode.value}\nUsage: /isolation [${validModes.join("|")}]`,
			);
		if (!(validModes as readonly string[]).includes(args)) {
			ctx.addInfoMessage(`Unknown mode "${args}". Valid modes: ${validModes.join(", ")}`);
			return;
		}
		ctx.state.isolationMode.value = args as "none" | "worktree" | "docker";
		ctx.addInfoMessage(`Isolation mode set to: ${args}`);
	});
}
