import { type ExtensionEvent, inferProvider, type MessagePayload } from "@takumi/agent";
import type { RoutingDecision, RoutingRequest } from "@takumi/bridge";
import { type AgentEvent, normalizeProviderName, type ToolDefinition } from "@takumi/core";
import { ensureCanonicalSessionBinding } from "../chitragupta/chitragupta-executor-runtime.js";
import {
	appendRoutingDecisions,
	summarizeTakumiCapabilityHealth,
	upsertCapabilityHealthSnapshot,
} from "../control-plane-state.js";
import { recordRouteDegradedExecution } from "../degraded-execution-context.js";
import type { AppState } from "../state.js";

const OPENAI_COMPAT_PROVIDERS = new Set([
	"openai",
	"openrouter",
	"ollama",
	"github",
	"groq",
	"deepseek",
	"mistral",
	"together",
	"xai",
	"alibaba",
	"bedrock",
	"zai",
]);

export type InteractiveSubmitSendMessage = (
	messages: MessagePayload[],
	system: string,
	tools?: ToolDefinition[],
	signal?: AbortSignal,
	options?: { model?: string },
) => AsyncIterable<AgentEvent>;

export interface InteractiveSubmitRouteOptions {
	state: AppState;
	text: string;
	defaultSendMessage: InteractiveSubmitSendMessage;
	resolveProviderSendMessage?: (providerName: string) => Promise<InteractiveSubmitSendMessage | null>;
	emitRouteEvent?: (event: ExtensionEvent) => Promise<void> | void;
}

export interface InteractiveSubmitRouteResult {
	sendMessage: InteractiveSubmitSendMessage;
	provider: string;
	model: string;
	routingDecision?: RoutingDecision;
	authority: "engine" | "takumi-fallback";
	applied: boolean;
}

/**
 * Resolve the Chitragupta route for a regular interactive chat submit.
 *
 * The startup path already consults the engine before the TUI boots; this
 * helper brings the same contract to ordinary chat turns without mutating the
 * operator's configured provider/model defaults.
 */
export async function resolveInteractiveSubmitRoute(
	options: InteractiveSubmitRouteOptions,
): Promise<InteractiveSubmitRouteResult> {
	const currentProvider = normalizeProviderName(options.state.provider.value) ?? options.state.provider.value;
	const currentModel = options.state.model.value.trim() || "";
	const capability = inferInteractiveSubmitCapability(options.text, options.state);
	const fallback = (decision?: RoutingDecision): InteractiveSubmitRouteResult => {
		if (decision) {
			recordRoutingDecision(options.state, decision);
		}
		return {
			sendMessage: options.defaultSendMessage,
			provider: currentProvider,
			model: currentModel,
			routingDecision: decision,
			authority: "takumi-fallback",
			applied: false,
		};
	};

	const bridge = options.state.chitraguptaBridge.value;
	const observer = options.state.chitraguptaObserver.value;
	if (!bridge?.isConnected || !bridge.isSocketMode || !observer) {
		return fallback();
	}

	await ensureCanonicalSessionBinding(options.state);
	const request = buildInteractiveRoutingRequest(
		capability,
		options.text,
		options.state,
		currentProvider,
		currentModel,
	);
	await safelyEmitRouteEvent(options.emitRouteEvent, {
		type: "before_route_request",
		flow: "interactive-submit",
		request,
		currentProvider,
		currentModel: currentModel || undefined,
	});

	let decision: RoutingDecision | null = null;
	try {
		decision = await observer.routeResolve(request);
	} catch (error) {
		const result = fallback();
		const message = formatRouteResolutionError(error);
		await emitInteractiveRouteResolution(options.emitRouteEvent, {
			request,
			decision: null,
			authority: result.authority,
			applied: result.applied,
			degraded: true,
			provider: currentProvider,
			model: currentModel || undefined,
			reason: `Engine route ${capability} failed: ${message}; using Takumi fallback.`,
			resolutionError: message,
		});
		return result;
	}

	if (!decision) {
		const result = fallback();
		await emitInteractiveRouteResolution(options.emitRouteEvent, {
			request,
			decision: null,
			authority: result.authority,
			applied: result.applied,
			degraded: true,
			provider: currentProvider,
			model: currentModel || undefined,
			reason: `No engine route resolved for ${capability}; using Takumi fallback.`,
		});
		return result;
	}

	recordRoutingDecision(options.state, decision);

	const preferredModel = extractSelectedModel(decision);
	const preferredProvider = resolvePreferredProvider(decision, preferredModel, currentProvider);
	if (!decision.selected || !preferredProvider || !preferredModel) {
		const result = fallback(decision);
		await emitInteractiveRouteResolution(options.emitRouteEvent, {
			request,
			decision,
			authority: result.authority,
			applied: result.applied,
			degraded: true,
			provider: currentProvider,
			model: currentModel || undefined,
			reason: `Engine route ${decision.selected?.id ?? capability} was not executable; using Takumi fallback.`,
		});
		return result;
	}

	if (preferredProvider === currentProvider) {
		const result: InteractiveSubmitRouteResult = {
			sendMessage: options.defaultSendMessage,
			provider: preferredProvider,
			model: preferredModel,
			routingDecision: decision,
			authority: "engine",
			applied: true,
		};
		await emitInteractiveRouteResolution(options.emitRouteEvent, {
			request,
			decision,
			authority: result.authority,
			applied: result.applied,
			degraded: Boolean(decision.degraded),
			provider: result.provider,
			model: result.model,
			reason: decision.reason ?? `Resolved ${capability} via ${preferredProvider}`,
		});
		return result;
	}

	const routedSendMessage = await options.resolveProviderSendMessage?.(preferredProvider);
	if (!routedSendMessage) {
		const message = `Chitragupta assigned ${preferredProvider} / ${preferredModel} for ${capability}, but Takumi cannot initialize that provider for this turn. Failing closed instead of silently rerouting.`;
		await emitInteractiveRouteResolution(options.emitRouteEvent, {
			request,
			decision,
			authority: "engine",
			applied: false,
			degraded: false,
			provider: preferredProvider,
			model: preferredModel,
			reason: message,
			resolutionError: message,
		});
		throw new Error(message);
	}

	const result: InteractiveSubmitRouteResult = {
		sendMessage: routedSendMessage,
		provider: preferredProvider,
		model: preferredModel,
		routingDecision: decision,
		authority: "engine",
		applied: true,
	};
	await emitInteractiveRouteResolution(options.emitRouteEvent, {
		request,
		decision,
		authority: result.authority,
		applied: result.applied,
		degraded: Boolean(decision.degraded),
		provider: result.provider,
		model: result.model,
		reason: decision.reason ?? `Resolved ${capability} via ${preferredProvider}`,
	});
	return result;
}

function inferInteractiveSubmitCapability(text: string, state: AppState): string {
	const normalized = text.toLowerCase();
	if (/(review|audit|security|validate|validation|test plan|test strategy|verify)/i.test(normalized)) {
		return "coding.review.strict";
	}
	if (
		state.thinkingBudget.value >= 24_000 ||
		/(plan|design|architecture|trade-?off|analy[sz]e|reason|why|approach|strategy)/i.test(normalized)
	) {
		return "coding.deep-reasoning";
	}
	return "coding.patch-cheap";
}

function buildInteractiveRoutingRequest(
	capability: string,
	text: string,
	state: AppState,
	currentProvider: string,
	currentModel: string,
): RoutingRequest {
	return {
		consumer: "takumi",
		sessionId: state.canonicalSessionId.value || state.sessionId.value || "transient",
		capability,
		constraints: {
			requireStreaming: true,
		},
		context: {
			mode: "interactive-submit",
			projectPath: process.cwd(),
			promptLength: text.length,
			configuredProvider: currentProvider,
			configuredModel: currentModel,
			thinking: state.thinking.value,
			thinkingBudget: state.thinkingBudget.value,
		},
	};
}

async function emitInteractiveRouteResolution(
	emitRouteEvent: InteractiveSubmitRouteOptions["emitRouteEvent"],
	event: Omit<Extract<ExtensionEvent, { type: "after_route_resolution" }>, "type" | "flow">,
): Promise<void> {
	await safelyEmitRouteEvent(emitRouteEvent, {
		type: "after_route_resolution",
		flow: "interactive-submit",
		...event,
	});
	if (event.degraded) {
		await safelyEmitRouteEvent(emitRouteEvent, {
			type: "route_degraded",
			flow: "interactive-submit",
			...event,
		});
	}
}

async function safelyEmitRouteEvent(
	emitRouteEvent: InteractiveSubmitRouteOptions["emitRouteEvent"],
	event: ExtensionEvent,
): Promise<void> {
	if (!emitRouteEvent) return;
	try {
		await emitRouteEvent(event);
	} catch {
		// Ignore hook failures until Track 2 defines explicit policy semantics.
	}
}

function formatRouteResolutionError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function recordRoutingDecision(state: AppState, decision: RoutingDecision): void {
	state.routingDecisions.value = appendRoutingDecisions(state.routingDecisions.value, [decision]);
	if (decision.degraded) {
		recordRouteDegradedExecution(state, decision);
	}
	state.capabilityHealthSnapshots.value = upsertCapabilityHealthSnapshot(
		state.capabilityHealthSnapshots.value,
		summarizeTakumiCapabilityHealth({
			connected: state.chitraguptaConnected.value,
			anomalySeverity: state.chitraguptaAnomaly.value?.severity,
			routingDecisions: state.routingDecisions.value,
		}),
	);
}

function extractSelectedModel(decision: RoutingDecision): string | undefined {
	const metadata = decision.selected?.metadata;
	if (typeof metadata?.model === "string") return metadata.model;
	if (typeof metadata?.modelId === "string") return metadata.modelId;
	return undefined;
}

function resolvePreferredProvider(
	decision: RoutingDecision,
	model: string | undefined,
	configuredProvider: string,
): string | undefined {
	const providerFromModel = model ? mapProviderFamilyToProvider(inferProvider(model), configuredProvider) : undefined;
	if (providerFromModel) {
		return providerFromModel;
	}
	return mapProviderFamilyToProvider(decision.selected?.providerFamily, configuredProvider);
}

function mapProviderFamilyToProvider(family: string | undefined, configuredProvider: string): string | undefined {
	const normalizedFamily = normalizeProviderName(family);
	if (!normalizedFamily) return undefined;
	if (normalizedFamily === "openai-compat") {
		const normalizedConfiguredProvider = normalizeProviderName(configuredProvider);
		return normalizedConfiguredProvider && OPENAI_COMPAT_PROVIDERS.has(normalizedConfiguredProvider)
			? normalizedConfiguredProvider
			: undefined;
	}
	return normalizedFamily;
}
