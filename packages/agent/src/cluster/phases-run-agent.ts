import type { AgentEvent } from "@takumi/core";
import { agentLoop, type MessagePayload, type SendMessageOptions } from "../loop.js";
import { getTemperatureForTask } from "../model-router.js";
import type { PhaseContext } from "./phases.js";
import { type AgentInstance, AgentStatus, ClusterPhase } from "./types.js";

const PHASE_TO_TEMPERATURE_STRING: Partial<Record<ClusterPhase, "PLANNING" | "EXECUTING" | "VALIDATING" | "FIXING">> = {
	[ClusterPhase.PLANNING]: "PLANNING",
	[ClusterPhase.EXECUTING]: "EXECUTING",
	[ClusterPhase.VALIDATING]: "VALIDATING",
	[ClusterPhase.FIXING]: "FIXING",
};

export async function runAgent(
	ctx: PhaseContext,
	updateAgentStatus: (id: string, s: AgentStatus, msg?: string) => void,
	agent: AgentInstance,
	systemPrompt: string,
	userMessage: string,
	phase: ClusterPhase,
	attemptNumber = 1,
): Promise<string> {
	updateAgentStatus(agent.id, AgentStatus.THINKING);
	const enrichedSystem = ctx.chitraguptaMemory
		? `${systemPrompt}\n\n## Project Memory (from Chitragupta)\n${ctx.chitraguptaMemory}`.trim()
		: systemPrompt;
	const modelOverride = ctx.getModelForRole?.(agent.role);
	const adaptiveTempConfig = ctx.orchestrationConfig?.adaptiveTemperature;
	const shouldUseAdaptiveTemp = adaptiveTempConfig?.enabled !== false;
	const temperaturePhase = PHASE_TO_TEMPERATURE_STRING[phase] ?? "EXECUTING";
	const temperature = shouldUseAdaptiveTemp
		? getTemperatureForTask("STANDARD", temperaturePhase, attemptNumber)
		: undefined;
	const callOptions: SendMessageOptions = {
		...(modelOverride ? { model: modelOverride } : {}),
		...(temperature !== undefined ? { temperature } : {}),
	};
	let text = "";
	try {
		if (ctx.tools) {
			const loop = agentLoop(userMessage, agent.messages, {
				sendMessage: (msgs, sys, tools, signal, opts) =>
					ctx.sendMessage(msgs, sys, tools, signal, { ...opts, ...callOptions }),
				tools: ctx.tools,
				systemPrompt: enrichedSystem,
			});
			for await (const ev of loop) {
				handleEvent(ctx, agent.id, ev, (delta) => {
					text += delta;
				});
			}
		} else {
			const messages: MessagePayload[] = [
				...agent.messages,
				{ role: "user", content: [{ type: "text", text: userMessage }] },
			];
			for await (const ev of ctx.sendMessage(messages, enrichedSystem, undefined, undefined, callOptions)) {
				handleEvent(ctx, agent.id, ev, (delta) => {
					text += delta;
				});
			}
		}
		agent.messages.push(
			{ role: "user", content: [{ type: "text", text: userMessage }] },
			{ role: "assistant", content: [{ type: "text", text }] },
		);
		updateAgentStatus(agent.id, AgentStatus.DONE);
		agent.completedAt = Date.now();
		return text;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		agent.error = msg;
		updateAgentStatus(agent.id, AgentStatus.ERROR, msg);
		throw err;
	}
}

function handleEvent(ctx: PhaseContext, agentId: string, ev: AgentEvent, onDelta: (delta: string) => void): void {
	if (ev.type === "text_delta") {
		onDelta(ev.text);
		ctx.onAgentText?.(agentId, ev.text);
	} else if (ev.type === "usage_update") {
		ctx.onTokenUsage?.(ev.usage.inputTokens ?? 0, ev.usage.outputTokens ?? 0);
	} else if (ev.type === "error") {
		throw ev.error;
	}
}
