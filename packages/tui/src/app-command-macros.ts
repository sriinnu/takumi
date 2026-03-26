import { execSync } from "node:child_process";
import type { Message, ToolResult } from "@takumi/core";
import type { AppCommandContext } from "./app-command-context.js";
import { ensureExclusiveCommandLease } from "./app-command-lease.js";
import { formatSideLaneDigest } from "./side-lane-store.js";

function canRunAgentMacro(ctx: AppCommandContext, commandName: string): boolean {
	if (!ctx.agentRunner) {
		ctx.addInfoMessage(`${commandName} requires an active agent runner.`);
		return false;
	}
	return ensureExclusiveCommandLease(ctx, commandName);
}

export async function runAnalysisMacro(ctx: AppCommandContext, commandName: string, prompt: string): Promise<void> {
	if (!canRunAgentMacro(ctx, commandName)) {
		return;
	}
	await ctx.agentRunner!.submit(prompt.trim());
}

export async function runCodeMacro(ctx: AppCommandContext, commandName: string, prompt: string): Promise<void> {
	await dispatchCodeCommand(ctx, commandName, prompt);
}

export async function dispatchCodeCommand(
	ctx: AppCommandContext,
	commandName: string,
	prompt: string,
): Promise<boolean> {
	if (!canRunAgentMacro(ctx, commandName)) {
		return false;
	}
	const dispatched = await ctx.commands.execute(`/code ${prompt.trim()}`);
	if (!dispatched) {
		ctx.addInfoMessage(`${commandName} could not dispatch to /code. The coding command is not registered.`);
	}
	return dispatched;
}

export function hasNativeTool(ctx: AppCommandContext, toolName: string): boolean {
	return Boolean(ctx.agentRunner?.getTools().getDefinition(toolName));
}

export async function executeNativeTool(
	ctx: AppCommandContext,
	commandName: string,
	toolName: string,
	input: Record<string, unknown>,
): Promise<ToolResult | null> {
	if (!ctx.agentRunner) {
		ctx.addInfoMessage(`${commandName} requires an active agent runner.`);
		return null;
	}
	if (!ensureExclusiveCommandLease(ctx, commandName)) {
		return null;
	}

	const tools = ctx.agentRunner.getTools();
	const definition = tools.getDefinition(toolName);
	if (!definition) {
		return null;
	}

	const result = await ctx.agentRunner.executeCommandTool(toolName, input);
	if (result.isError) {
		ctx.addInfoMessage(`${commandName}: ${toolName} failed — ${result.output.slice(0, 240)}`);
	}
	return result;
}

export function parseJsonToolOutput<T>(result: ToolResult | null): T | null {
	if (!result || result.isError) {
		return null;
	}
	try {
		return JSON.parse(result.output) as T;
	} catch {
		return null;
	}
}

export function runShellCommand(command: string): string | null {
	try {
		return execSync(command, {
			cwd: process.cwd(),
			encoding: "utf-8",
			maxBuffer: 512 * 1024,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch {
		return null;
	}
}

export function getRecentConversationDigest(messages: Message[], maxMessages = 6): string {
	const recent = messages.slice(-maxMessages);
	if (recent.length === 0) {
		return "(no prior conversation in this session)";
	}

	return recent
		.map((message) => {
			const text = message.content
				.filter((block): block is Extract<(typeof message.content)[number], { type: "text" }> => block.type === "text")
				.map((block) => block.text)
				.join(" ")
				.trim();
			const preview = text.length > 220 ? `${text.slice(0, 217)}...` : text || "(non-text content)";
			return `- ${message.role}: ${preview}`;
		})
		.join("\n");
}

export function buildSessionContext(ctx: AppCommandContext): string {
	const routing = ctx.state.routingDecisions.value
		.slice(-3)
		.map((decision) => decision.selected?.id ?? `${decision.request.capability}:fallback`)
		.join(", ");
	const liveSideLanes = ctx.state.sideLanes.list(3).map(formatSideLaneDigest).join(", ");
	return [
		`Session ID: ${ctx.state.sessionId.value || "(none)"}`,
		`Canonical session: ${ctx.state.canonicalSessionId.value || "(unbound)"}`,
		`Hub connected: ${ctx.state.chitraguptaConnected.value ? "yes" : "no"}`,
		`Model: ${ctx.state.model.value}`,
		`Provider: ${ctx.state.provider.value}`,
		`Turns: ${ctx.state.turnCount.value}`,
		`Context pressure: ${ctx.state.contextPressure.value} (${ctx.state.contextPercent.value.toFixed(1)}%)`,
		`Recent lanes: ${routing || "(none)"}`,
		`Live side lanes: ${liveSideLanes || "(none)"}`,
		"Recent conversation:",
		getRecentConversationDigest(ctx.state.messages.value),
	].join("\n");
}
