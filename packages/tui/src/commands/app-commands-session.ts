import { reconstructFromDaemon } from "@takumi/bridge";
import type { AppCommandContext } from "./app-command-context.js";

/** Register session-lifecycle slash commands: /session, /fork, /replay. */
export function registerSessionCommands(ctx: AppCommandContext): void {
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
			if (ctx.resumeSession) {
				ctx.addInfoMessage(`Attaching daemon session ${sessionId}...`);
				await ctx.resumeSession(sessionId);
				return;
			}
			if (!bridge?.isConnected) {
				ctx.addInfoMessage("/session attach requires Chitragupta connection");
				return;
			}
			ctx.addInfoMessage("Session attach is unavailable in this runtime.");
			return;
		}
		ctx.addInfoMessage("Usage: /session [info|list|resume <id>|attach <id>|save|dates [project]|projects|delete <id>]");
	});

	ctx.commands.register("/fork", "Fork the current session into a new branch", async (_args) => {
		const currentId = ctx.state.sessionId.value;
		if (!currentId) {
			ctx.addInfoMessage("No active session to fork. Start chatting first or use /session save.");
			return;
		}
		const { forkSession, saveSession } = await import("@takumi/core");
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
}
