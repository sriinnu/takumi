import { execFileSync } from "node:child_process";
import { HandoffManager } from "@takumi/agent";
import type { HandoffTarget, HandoffWorkState, SessionData } from "@takumi/core";
import { ArtifactStore, branchSession, loadSession, registerInTree, saveSession } from "@takumi/core";
import type { AppCommandContext } from "./app-command-context.js";

interface ParsedHandoffArgs {
	target: HandoffTarget;
	objective: string;
	notes?: string;
}

function usage(): string {
	return [
		"Usage:",
		"  /handoff-to <new|session:ID|branch:LABEL|side-agent:ID> [objective / notes]",
		"  /reattach <handoff-id> [session-id]",
		"  /handoffs [limit]",
	].join("\n");
}

function getCurrentGitBranch(): string | undefined {
	try {
		const branch = execFileSync("git", ["branch", "--show-current"], {
			cwd: process.cwd(),
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return branch || undefined;
	} catch {
		return undefined;
	}
}

function latestText(session: SessionData, role: "user" | "assistant"): string | undefined {
	for (let i = session.messages.length - 1; i >= 0; i -= 1) {
		const message = session.messages[i];
		if (message.role !== role) continue;
		const block = message.content.find((item) => item.type === "text");
		if (block?.type === "text" && block.text.trim()) {
			return block.text.trim();
		}
	}
	return undefined;
}

export function parseHandoffArgs(rawArgs: string, fallbackObjective: string): ParsedHandoffArgs | null {
	const trimmed = rawArgs.trim();
	if (!trimmed) return null;

	const [targetSpec, ...rest] = trimmed.split(/\s+/);
	const text = rest.join(" ").trim();
	const objective = text || fallbackObjective;

	if (targetSpec === "new" || targetSpec === "new-session") {
		return {
			target: { kind: "new-session", id: null, label: "New session" },
			objective,
			notes: text || undefined,
		};
	}

	if (targetSpec.startsWith("session:")) {
		const id = targetSpec.slice("session:".length).trim();
		if (!id) return null;
		return {
			target: { kind: "session", id, label: id },
			objective,
			notes: text || undefined,
		};
	}

	if (targetSpec.startsWith("branch:")) {
		const label = targetSpec.slice("branch:".length).trim();
		if (!label) return null;
		return {
			target: { kind: "branch", id: null, label },
			objective,
			notes: text || undefined,
		};
	}

	if (targetSpec.startsWith("side-agent:")) {
		const id = targetSpec.slice("side-agent:".length).trim();
		if (!id) return null;
		return {
			target: { kind: "side-agent", id, label: id },
			objective,
			notes: text || undefined,
		};
	}

	return null;
}

export function buildHandoffWorkState(
	session: SessionData,
	objective: string,
	validationStatus: HandoffWorkState["validationStatus"] = "not-run",
): HandoffWorkState {
	const lastAssistant = latestText(session, "assistant");
	const lastUser = latestText(session, "user");

	return {
		objective,
		decisions: lastAssistant ? [lastAssistant.slice(0, 240)] : [],
		filesChanged: [],
		filesRead: [],
		blockers: [],
		validationStatus,
		nextAction: lastUser
			? `Continue from the latest user intent: ${lastUser.slice(0, 160)}`
			: "Review the handoff context, validate current state, and continue execution.",
	};
}

async function resolveBranchTarget(ctx: AppCommandContext, target: HandoffTarget): Promise<HandoffTarget> {
	if (target.kind !== "branch") return target;

	const sessionId = ctx.state.sessionId.value;
	if (!sessionId) {
		throw new Error("No active session to branch from.");
	}

	const sessionData = ctx.buildSessionData();
	await saveSession(sessionData);
	await registerInTree(sessionId, sessionData.title || sessionId);

	const result = await branchSession(sessionId, ctx.state.messages.value.length, target.label);
	if (!result) {
		throw new Error("Failed to create branch target.");
	}

	return {
		kind: "branch",
		id: result.newSessionId,
		label: target.label ?? result.newSessionId,
	};
}

function createManager(ctx: AppCommandContext): HandoffManager {
	return new HandoffManager({
		bridge: ctx.state.chitraguptaBridge.value,
		artifactStore: new ArtifactStore(),
	});
}

export function registerHandoffCommands(ctx: AppCommandContext): void {
	ctx.commands.register(
		"/handoff-to",
		"Create a structured handoff for another session, branch, or side agent",
		async (args) => {
			const sessionId = ctx.state.sessionId.value;
			if (!sessionId) {
				ctx.addInfoMessage(`No active session to hand off.\n${usage()}`);
				return;
			}

			const sessionData = ctx.buildSessionData();
			const parsed = parseHandoffArgs(args, sessionData.title || "Continue current task");
			if (!parsed) {
				ctx.addInfoMessage(usage());
				return;
			}

			try {
				const manager = createManager(ctx);
				const target = await resolveBranchTarget(ctx, parsed.target);
				const payload = await manager.createHandoff({
					sessionId,
					model: ctx.state.model.value,
					provider: ctx.state.provider.value,
					branch: getCurrentGitBranch(),
					daemonSessionId: ctx.state.canonicalSessionId.value || undefined,
					target,
					workState: buildHandoffWorkState(sessionData, parsed.objective),
					notes: parsed.notes,
					checkpointTurn: ctx.state.turnCount.value,
					routeClass: ctx.state.routingDecisions.value.at(-1)?.request.capability ?? "coding.patch-cheap",
				});

				const targetLabel = target.id ? `${target.kind}:${target.id}` : target.kind;
				const branchLine = target.kind === "branch" ? `\nPrepared branch target: ${target.id}` : "";
				ctx.addInfoMessage(
					`Structured handoff created.\nHandoff ID: ${payload.handoffId}\nTarget: ${targetLabel}\nObjective: ${payload.workState.objective}${branchLine}`,
				);
			} catch (error) {
				ctx.addInfoMessage(`Failed to create handoff: ${(error as Error).message}`);
			}
		},
		["/handoff-to-session", "/pass-to"],
	);

	ctx.commands.register("/handoffs", "List recent structured handoffs", async (args) => {
		const limit = Number.parseInt(args.trim(), 10);
		const manager = createManager(ctx);
		const entries = await manager.listHandoffs(Number.isNaN(limit) || limit <= 0 ? 10 : limit);
		if (entries.length === 0) {
			ctx.addInfoMessage("No structured handoffs found yet.");
			return;
		}

		ctx.addInfoMessage(
			[
				"Recent handoffs:",
				...entries.map((entry, index) => `${index + 1}. ${entry.handoffId} — ${entry.summary} (${entry.createdAt})`),
			].join("\n"),
		);
	});

	ctx.commands.register("/reattach", "Reattach a structured handoff into a session", async (args) => {
		const [handoffId, overrideSessionId] = args.trim().split(/\s+/, 2);
		if (!handoffId) {
			ctx.addInfoMessage(usage());
			return;
		}

		try {
			const manager = createManager(ctx);
			const payload = await manager.loadHandoff(handoffId);
			if (!payload) {
				ctx.addInfoMessage(`Handoff not found: ${handoffId}`);
				return;
			}

			const result = await manager.reattach(payload, overrideSessionId || undefined);
			const session = await loadSession(result.sessionId);
			const warningBlock = result.warnings.length > 0 ? `\nWarnings:\n- ${result.warnings.join("\n- ")}` : "";

			if (session && ctx.activateSession) {
				await ctx.activateSession(
					session,
					`Reattached ${handoffId} → ${result.sessionId}\nModel: ${result.model}\nMessages: ${result.messageCount}${warningBlock}`,
					"resume",
				);
				return;
			}

			ctx.addInfoMessage(
				`Reattached ${handoffId} → ${result.sessionId}\nModel: ${result.model}\nMessages: ${result.messageCount}${warningBlock}`,
			);
		} catch (error) {
			ctx.addInfoMessage(`Failed to reattach handoff: ${(error as Error).message}`);
		}
	});
}
