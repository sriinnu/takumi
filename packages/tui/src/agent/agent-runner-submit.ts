/**
 * Submission orchestration for {@link AgentRunner}.
 *
 * I keep the heavyweight per-turn pipeline here so the runner class can stay
 * focused on lifecycle wiring, permission plumbing, and state ownership.
 */

import {
	agentLoop,
	type BudgetGuard,
	buildSkillsPrompt,
	buildStrategyPrompt,
	type ConventionFiles,
	type CostTracker,
	calculateContextPressureFromTokens,
	type ExperienceMemory,
	type ExtensionEvent,
	type ExtensionRunner,
	type MemoryHooks,
	type MessagePayload,
	ObservationCollector,
	optimizePromptWindow,
	type PrincipleMemory,
	type SteeringQueue,
	type ToolRegistry,
} from "@takumi/agent";
import type { AgentEvent, Message, PermissionDecision, TakumiConfig } from "@takumi/core";
import { createLogger } from "@takumi/core";
import { getBoundSessionId } from "../chitragupta/chitragupta-executor-runtime.js";
import { syncPendingChitraguptaSessionTurns } from "../chitragupta/chitragupta-session-sync.js";
import {
	inferPendingTrackedFileTools,
	inferTrackedChangeStatus,
	type PendingTrackedFileTool,
} from "../file-tracking.js";
import type { AppState } from "../state.js";
import { hydrateRunnerCognition, materializeWorkspaceDirectives } from "./agent-runner-cognition.js";
import {
	estimatePromptHistoryTokens,
	renderToolRoutingHints,
	summarizeToolArgs,
} from "./agent-runner-submit-support.js";
import { type InteractiveSubmitSendMessage, resolveInteractiveSubmitRoute } from "./interactive-submit-route.js";

const log = createLogger("agent-runner-submit");

type UsageUpdate = Extract<AgentEvent, { type: "usage_update" }>["usage"];

export interface RunAgentRunnerSubmitOptions {
	state: AppState;
	config: TakumiConfig;
	tools: ToolRegistry;
	history: MessagePayload[];
	text: string;
	images?: Array<{ mediaType: string; data: string }>;
	signal: AbortSignal;
	defaultSendMessage: InteractiveSubmitSendMessage;
	resolveProviderSendMessage?: (providerName: string) => Promise<InteractiveSubmitSendMessage | null>;
	extensionRunner: ExtensionRunner | null;
	conventionFiles: ConventionFiles | null;
	steeringQueue: SteeringQueue | null;
	experienceMemory: ExperienceMemory;
	memoryHooks: MemoryHooks;
	principleMemory: PrincipleMemory;
	costTracker: CostTracker;
	buildBudgetGuard: (modelOverride?: string) => BudgetGuard;
	setBudgetGuard: (guard: BudgetGuard) => void;
	emitExtensionEvent?: (event: ExtensionEvent) => Promise<void> | void;
	toolStartTimes: Map<string, number>;
	pendingTrackedFileTools: Map<string, PendingTrackedFileTool[]>;
	isConsolidationTriggered: () => boolean;
	markConsolidationTriggered: () => void;
	getToolPermissionDecision: (tool: string, args: Record<string, unknown>) => Promise<PermissionDecision>;
	onEvent: (event: AgentEvent) => void;
	onRuntimeError: (error: unknown) => void;
}

interface SubmissionAccumulator {
	fullText: string;
	fullThinking: string;
	latestUsage: UsageUpdate | null;
}

/**
 * Run a single interactive submit from route resolution through transcript flush.
 */
export async function runAgentRunnerSubmit(options: RunAgentRunnerSubmitOptions): Promise<void> {
	const routeBinding = await resolveInteractiveSubmitRoute({
		state: options.state,
		text: options.text,
		defaultSendMessage: options.defaultSendMessage,
		resolveProviderSendMessage: options.resolveProviderSendMessage,
	});
	const systemPrompt = await buildRunnerSystemPrompt(options);
	const collector = options.state.sessionId.value
		? new ObservationCollector({ sessionId: getBoundSessionId(options.state) })
		: undefined;
	const selectedModel = routeBinding.model.trim() || options.state.model.value.trim() || undefined;
	const budgetGuard = options.buildBudgetGuard(selectedModel);
	options.setBudgetGuard(budgetGuard);

	const loop = agentLoop({ text: options.text, images: options.images }, options.history, {
		sendMessage: routeBinding.sendMessage,
		budget: budgetGuard,
		model: selectedModel,
		maxContextTokens: options.state.contextWindow.value || 200_000,
		tools: options.tools,
		checkToolPermission: (tool, args) => options.getToolPermissionDecision(tool, args),
		systemPrompt,
		maxTurns: options.config.maxTurns,
		signal: options.signal,
		extensionRunner: options.extensionRunner ?? undefined,
		steeringQueue: options.steeringQueue ?? undefined,
		observationCollector: collector,
		experienceMemory: options.experienceMemory,
		memoryHooks: options.memoryHooks,
		principleMemory: options.principleMemory,
	});

	const stream: SubmissionAccumulator = { fullText: "", fullThinking: "", latestUsage: null };
	for await (const event of loop) {
		options.onEvent(event);
		const shouldStop = handleSubmissionEvent(event, selectedModel, options, stream);
		if (shouldStop) break;
	}

	finalizeAssistantMessage(options.state, stream, options.emitExtensionEvent);
	flushCollectedObservations(options.state, collector);
}

async function buildRunnerSystemPrompt(options: RunAgentRunnerSubmitOptions): Promise<string | undefined> {
	const toolDefinitions = options.tools.getDefinitions();
	const memoryContext = options.state.chitraguptaMemory.value;
	let basePrompt = options.config.systemPrompt || undefined;

	if (options.conventionFiles?.systemPromptAddon) {
		basePrompt = `${basePrompt ?? ""}\n\n## Project Conventions\n${options.conventionFiles.systemPromptAddon}`.trim();
	}

	let predictiveContext = "";
	if (options.state.chitraguptaObserver.value && options.state.sessionId.value) {
		try {
			predictiveContext = await hydrateRunnerCognition(options.state);
		} catch (err) {
			log.debug(`Chitragupta pre-turn prediction failed: ${(err as Error).message}`);
		}
	}

	// Keep workspace directives in sync before every turn so follow-up runs do not
	// lag one submit behind the latest cognitive state.
	materializeWorkspaceDirectives(options.state);

	const promptSections = [
		{
			id: "project-memory",
			content: memoryContext ? `## Project Memory (from Chitragupta)\n${memoryContext}` : "",
			kind: "summary" as const,
			referenceCount: 4,
			pinned: false,
		},
		{
			id: "skills",
			content:
				buildSkillsPrompt(options.conventionFiles?.skills ?? [], options.text) ??
				options.conventionFiles?.skillsPromptAddon ??
				"",
			kind: "summary" as const,
			referenceCount: 3,
			pinned: false,
		},
		{
			id: "experience-runtime",
			content: options.experienceMemory.buildRuntimePromptSection() ?? "",
			kind: "summary" as const,
			referenceCount: 5,
			pinned: true,
		},
		{
			id: "experience-recall",
			content: options.experienceMemory.buildRehydrationPromptSection(options.text) ?? "",
			kind: "summary" as const,
			referenceCount: 6,
			pinned: true,
			rippleDepth: 0,
		},
		{
			id: "strategy-guide",
			content: buildStrategyPrompt(options.text, toolDefinitions, options.experienceMemory) ?? "",
			kind: "pinned" as const,
			referenceCount: 6,
			pinned: true,
			rippleDepth: 0,
		},
		{
			id: "tool-routing",
			content: renderToolRoutingHints(options.text, toolDefinitions, options.experienceMemory),
			kind: "summary" as const,
			referenceCount: 4,
			pinned: true,
			rippleDepth: 1,
		},
		{
			id: "predictive-context",
			content: predictiveContext,
			kind: "pinned" as const,
			referenceCount: 6,
			pinned: true,
			rippleDepth: 0,
		},
	];

	const optimizedPrompt = optimizePromptWindow({
		totalContextTokens: options.state.contextWindow.value || 200_000,
		historyTokens: estimatePromptHistoryTokens(options),
		basePrompt,
		sections: promptSections,
	});

	return optimizedPrompt.prompt;
}
function handleSubmissionEvent(
	event: AgentEvent,
	selectedModel: string | undefined,
	options: RunAgentRunnerSubmitOptions,
	stream: SubmissionAccumulator,
): boolean {
	switch (event.type) {
		case "text_delta": {
			stream.fullText += event.text;
			options.state.streamingText.value = stream.fullText;
			options.state.agentPhase.value = "Thinking...";
			return false;
		}
		case "thinking_delta": {
			stream.fullThinking += event.text;
			options.state.thinkingText.value = stream.fullThinking;
			options.state.agentPhase.value = "Thinking...";
			return false;
		}
		case "usage_update": {
			stream.latestUsage = event.usage;
			handleUsageUpdate(options, selectedModel, event.usage);
			return false;
		}
		case "tool_use": {
			handleToolUse(options, event);
			return false;
		}
		case "tool_result": {
			handleToolResult(options, event);
			return false;
		}
		case "stop":
			return true;
		case "done":
			return false;
		case "error": {
			log.error("Agent error", event.error);
			options.onRuntimeError(event.error);
			return true;
		}
		default:
			return false;
	}
}

function handleUsageUpdate(
	options: RunAgentRunnerSubmitOptions,
	selectedModel: string | undefined,
	usage: UsageUpdate,
): void {
	const snapshot = options.costTracker.record(
		usage.inputTokens,
		usage.outputTokens,
		selectedModel,
		usage.cacheReadTokens,
		usage.cacheWriteTokens,
	);
	options.state.setCostSnapshot(snapshot);

	const pressure =
		usage.inputTokens > 0
			? calculateContextPressureFromTokens(usage.inputTokens, options.state.contextWindow.value)
			: calculateContextPressureFromTokens(estimatePromptHistoryTokens(options), options.state.contextWindow.value);
	options.state.contextPercent.value = pressure.percent;
	options.state.contextPressure.value = pressure.pressure;
	options.state.contextTokens.value = pressure.tokens;
	options.state.contextWindow.value = pressure.contextWindow;

	if (pressure.pressure !== "near_limit" || options.isConsolidationTriggered()) {
		return;
	}

	options.markConsolidationTriggered();
	const bridge = options.state.chitraguptaBridge.value;
	if (!bridge?.isConnected) {
		return;
	}

	const project = process.cwd().split("/").pop() ?? "unknown";
	log.info(`Auto-consolidation triggered (pressure: ${pressure.percent.toFixed(1)}%)`);
	options.state.consolidationInProgress.value = true;
	void bridge
		.consolidationRun(project)
		.catch((err) => {
			log.debug(`Auto-consolidation failed: ${(err as Error).message}`);
		})
		.finally(() => {
			options.state.consolidationInProgress.value = false;
		});
}

function handleToolUse(options: RunAgentRunnerSubmitOptions, event: Extract<AgentEvent, { type: "tool_use" }>): void {
	options.state.activeTool.value = event.name;
	options.state.agentPhase.value = `Running ${event.name}...`;
	const argSummary = summarizeToolArgs(event.name, event.input);
	options.state.toolSpinner.start(event.id, event.name, argSummary);
	options.toolStartTimes.set(event.id, Date.now());

	const trackedTools = inferPendingTrackedFileTools(
		event.name,
		event.input,
		options.tools.getDefinition(event.name),
		options.config.workingDirectory || process.cwd(),
	);
	if (trackedTools.length > 0) {
		options.pendingTrackedFileTools.set(event.id, trackedTools);
	}
}

function handleToolResult(
	options: RunAgentRunnerSubmitOptions,
	event: Extract<AgentEvent, { type: "tool_result" }>,
): void {
	options.state.activeTool.value = null;
	options.state.toolOutput.value = event.output;
	options.state.agentPhase.value = "Waiting for response...";

	const startTime = options.toolStartTimes.get(event.id) ?? Date.now();
	const durationMs = Date.now() - startTime;
	options.state.toolSpinner.complete(event.id, !event.isError, durationMs);
	options.toolStartTimes.delete(event.id);
	recordTrackedFiles(options.state, options.pendingTrackedFileTools, event.id, event.output, event.isError);
}

function recordTrackedFiles(
	state: AppState,
	pendingTrackedFileTools: Map<string, PendingTrackedFileTool[]>,
	toolUseId: string,
	toolOutput: string,
	isError: boolean,
): void {
	const trackedTools = pendingTrackedFileTools.get(toolUseId) ?? [];
	pendingTrackedFileTools.delete(toolUseId);
	if (isError || trackedTools.length === 0) return;

	for (const tracked of trackedTools) {
		if (tracked.kind === "read") {
			state.recordFileRead(tracked.path);
			continue;
		}

		state.recordFileChange(tracked.path, inferTrackedChangeStatus(tracked, toolOutput));
	}
}

function finalizeAssistantMessage(
	state: AppState,
	stream: SubmissionAccumulator,
	emitExtensionEvent?: RunAgentRunnerSubmitOptions["emitExtensionEvent"],
): void {
	if (!stream.fullText) {
		return;
	}

	const assistantMessage: Message = {
		id: `msg-${Date.now()}`,
		role: "assistant",
		content: [],
		timestamp: Date.now(),
		sessionTurn: true,
		usage: stream.latestUsage ?? undefined,
	};
	if (stream.fullThinking) {
		assistantMessage.content.push({ type: "thinking", thinking: stream.fullThinking });
	}
	assistantMessage.content.push({ type: "text", text: stream.fullText });
	state.addMessage(assistantMessage);
	void syncPendingChitraguptaSessionTurns(state, emitExtensionEvent);

	const bridge = state.chitraguptaBridge.value;
	if (bridge?.isConnected && stream.fullText.length > 100) {
		void bridge
			.akashaDeposit(stream.fullText.slice(0, 2000), "agent_response", [process.cwd().split("/").pop() ?? "unknown"])
			.catch(() => {
				/* best-effort */
			});
	}
}

function flushCollectedObservations(state: AppState, collector: ObservationCollector | undefined): void {
	if (!collector || collector.pending === 0) {
		return;
	}

	const observer = state.chitraguptaObserver.value;
	if (!observer) {
		return;
	}

	const events = collector.flush();
	void observer
		.observeBatch(events)
		.then((response) => {
			if (response.accepted > 0) {
				state.observationFlushCount.value++;
			}
		})
		.catch(() => {
			/* best-effort */
		});
}
