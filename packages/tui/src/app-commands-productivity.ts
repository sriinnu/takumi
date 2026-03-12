import { compactHistory } from "@takumi/agent";
import type { AppCommandContext } from "./app-command-context.js";
import { buildSessionContext, runAnalysisMacro, runCodeMacro, runShellCommand } from "./app-command-macros.js";

function getGitReviewContext(): string {
	const branch = runShellCommand("git rev-parse --abbrev-ref HEAD") ?? "unknown";
	const status = runShellCommand("git status --short") ?? "(clean or unavailable)";
	const staged = runShellCommand("git diff --cached --minimal --no-ext-diff");
	const unstaged = runShellCommand("git diff --minimal --no-ext-diff");
	const commits = runShellCommand("git log --oneline -5") ?? "(no recent commits)";

	return [
		`Branch: ${branch}`,
		"Recent commits:",
		commits,
		"",
		"Status:",
		status,
		"",
		"Staged diff:",
		staged || "(none)",
		"",
		"Unstaged diff:",
		unstaged || "(none)",
	].join("\n");
}

export function registerProductivityCommands(ctx: AppCommandContext): void {
	ctx.commands.register("/commit-msg", "Generate conventional commit message options", async (args) => {
		const staged = runShellCommand("git diff --cached --minimal --no-ext-diff");
		const unstaged = runShellCommand("git diff --minimal --no-ext-diff");
		if (!staged && !unstaged) {
			ctx.addInfoMessage("/commit-msg found no staged or unstaged changes.");
			return;
		}
		await runAnalysisMacro(
			ctx,
			"/commit-msg",
			[
				"Workflow command: /commit-msg",
				"Generate exactly 3 Conventional Commit message options: recommended, short, and detailed.",
				"Keep subject lines under 72 characters and do not add co-author trailers.",
				args.trim() ? `Extra scope hint: ${args.trim()}` : "",
				"",
				getGitReviewContext(),
			].join("\n"),
		);
	});

	ctx.commands.register("/pr-desc", "Draft a pull request description from current changes", async (args) => {
		await runAnalysisMacro(
			ctx,
			"/pr-desc",
			[
				"Workflow command: /pr-desc",
				"Write a concise but useful PR description with summary, key changes, risks, and validation steps.",
				args.trim() ? `Audience or angle: ${args.trim()}` : "",
				"",
				getGitReviewContext(),
			].join("\n"),
		);
	});

	ctx.commands.register("/security-scan", "Perform a read-only security review", async (args) => {
		await runAnalysisMacro(
			ctx,
			"/security-scan",
			[
				"Workflow command: /security-scan",
				"Perform a read-only security audit of the current workspace or the requested scope.",
				"Look for secrets, auth mistakes, injections, unsafe exec flows, insecure defaults, and footguns.",
				"Do not print secret values in full; redact them.",
				"Return findings ranked by severity with recommended fixes.",
				"",
				buildSessionContext(ctx),
				"",
				`Scope: ${args.trim() || "current workspace / recent changes"}`,
			].join("\n"),
		);
	});

	ctx.commands.register("/env-audit", "Audit environment files and config drift", async (args) => {
		await runAnalysisMacro(
			ctx,
			"/env-audit",
			[
				"Workflow command: /env-audit",
				"Inspect environment/config files for drift, missing keys, duplicated settings, and security risks.",
				"Compare .env variants, examples, and likely runtime assumptions. Redact secret values.",
				"Return: missing vars, suspicious vars, stale vars, and recommended cleanup.",
				"",
				buildSessionContext(ctx),
				"",
				`Scope: ${args.trim() || "project environment and config files"}`,
			].join("\n"),
		);
	});

	ctx.commands.register("/context-prune", "Compact the current session more aggressively", async (args) => {
		const keepRecent = args.trim() ? Number.parseInt(args.trim(), 10) : 8;
		if (!Number.isFinite(keepRecent) || keepRecent <= 0) {
			ctx.addInfoMessage("Usage: /context-prune [keepRecentTurns]");
			return;
		}
		const messages = ctx.state.messages.value;
		if (messages.length === 0) {
			ctx.addInfoMessage("Nothing to prune.");
			return;
		}
		const result = compactHistory(messages, { keepRecent, maxTokens: 1 });
		if (result.compactedTurns === 0) {
			ctx.addInfoMessage("No extra context pruning was needed.");
			return;
		}
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
			`Pruned context by compacting ${result.compactedTurns} turn(s); kept the most recent ${keepRecent} turn window${bridge?.isConnected ? ", then refreshed hub context" : ""}.`,
		);
	});

	ctx.commands.register("/doc-refactor", "Refactor documentation structure and content", async (args) => {
		await runCodeMacro(
			ctx,
			"/doc-refactor",
			[
				"Documentation refactor mode.",
				"Analyze the docs structure, then improve clarity, organization, and cross-links.",
				"Respect existing conventions and keep docs concise.",
				`Focus: ${args.trim() || "current documentation set"}`,
			].join("\n"),
		);
	});

	ctx.commands.register("/article", "Draft an article or blog post from the current session/work", async (args) => {
		await runAnalysisMacro(
			ctx,
			"/article",
			[
				"Workflow command: /article",
				"Write a polished technical article or internal write-up based on the current session and project context.",
				"Include title options, outline, and the full draft.",
				args.trim() ? `Angle: ${args.trim()}` : "Angle: explain the problem, solution, tradeoffs, and lessons learned.",
				"",
				buildSessionContext(ctx),
			].join("\n"),
		);
	});

	ctx.commands.register(
		"/handoff",
		"Summarize the current task/session for another agent or future self",
		async (args) => {
			await runAnalysisMacro(
				ctx,
				"/handoff",
				[
					"Workflow command: /handoff",
					"Create a compact handoff memo for another agent or a future human/me.",
					"Include: current objective, what changed, decisions made, blockers, open questions, validation status, and next recommended action.",
					args.trim() ? `Target audience: ${args.trim()}` : "Target audience: another Takumi/AI lane or future self.",
					"",
					buildSessionContext(ctx),
				].join("\n"),
			);
		},
		["/hand-off", "/pass-on"],
	);
}
