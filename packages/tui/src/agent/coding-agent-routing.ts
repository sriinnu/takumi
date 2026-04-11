import {
	AgentRole,
	type ExtensionEvent,
	inferProvider,
	type ModelRouter,
	type RoutingOverridePlan,
	resolveTaskRoutingOverrides,
	type TaskClassification,
} from "@takumi/agent";
import type { ChitraguptaObserver, RoutingDecision, RoutingRequest } from "@takumi/bridge";

interface ResolveRoutingOverridesOptions {
	observer: ChitraguptaObserver | null;
	sessionId: string | null;
	currentModel: string;
	router?: ModelRouter;
	classification?: TaskClassification;
	emitRouteEvent?: (event: ExtensionEvent) => Promise<void> | void;
}

const DEFAULT_CODING_CLI_PREFERENCES = ["cli.codex"];

export async function resolveRoutingOverrides({
	observer,
	sessionId,
	currentModel,
	router,
	classification,
	emitRouteEvent,
}: ResolveRoutingOverridesOptions): Promise<RoutingOverridePlan> {
	if (!observer) {
		return { overrides: {}, laneEnvelopes: {}, decisions: [], notes: [] };
	}

	if (!router || !classification) {
		return resolveLegacyRoutingOverrides(observer, sessionId, currentModel, emitRouteEvent);
	}

	return resolveTaskRoutingOverrides({
		observer,
		sessionId,
		currentModel,
		router,
		classification,
		emitRouteEvent,
	});
}

async function resolveLegacyRoutingOverrides(
	observer: ChitraguptaObserver,
	sessionId: string | null,
	currentModel: string,
	emitRouteEvent?: ResolveRoutingOverridesOptions["emitRouteEvent"],
): Promise<RoutingOverridePlan> {
	const plans = await Promise.all([
		resolveLegacyPlan(
			observer,
			currentModel,
			[AgentRole.WORKER],
			{
				consumer: "takumi",
				sessionId: sessionId ?? "transient",
				capability: "coding.patch-cheap",
				constraints: {
					preferLocal: true,
					requireStreaming: true,
					preferredCapabilityIds: DEFAULT_CODING_CLI_PREFERENCES,
				},
				context: { mode: "multi-agent", role: "worker" },
			},
			emitRouteEvent,
		),
		resolveLegacyPlan(
			observer,
			currentModel,
			[
				AgentRole.PLANNER,
				AgentRole.VALIDATOR_REQUIREMENTS,
				AgentRole.VALIDATOR_CODE,
				AgentRole.VALIDATOR_SECURITY,
				AgentRole.VALIDATOR_TESTS,
				AgentRole.VALIDATOR_ADVERSARIAL,
			],
			{
				consumer: "takumi",
				sessionId: sessionId ?? "transient",
				capability: "coding.review.strict",
				constraints: {
					requireStreaming: true,
					preferredCapabilityIds: DEFAULT_CODING_CLI_PREFERENCES,
				},
				context: { mode: "multi-agent", role: "coordination" },
			},
			emitRouteEvent,
		),
	]);

	return plans.reduce<RoutingOverridePlan>(
		(acc, plan) => ({
			overrides: { ...acc.overrides, ...plan.overrides },
			laneEnvelopes: { ...acc.laneEnvelopes, ...plan.laneEnvelopes },
			decisions: [...acc.decisions, ...plan.decisions],
			notes: [...acc.notes, ...plan.notes],
		}),
		{ overrides: {}, laneEnvelopes: {}, decisions: [], notes: [] },
	);
}

async function resolveLegacyPlan(
	observer: ChitraguptaObserver,
	currentModel: string,
	roles: AgentRole[],
	request: RoutingRequest,
	emitRouteEvent?: ResolveRoutingOverridesOptions["emitRouteEvent"],
): Promise<RoutingOverridePlan> {
	await safelyEmitRouteEvent(emitRouteEvent, {
		type: "before_route_request",
		flow: "multi-agent",
		request,
		currentProvider: currentModel ? inferProvider(currentModel) : undefined,
		currentModel: currentModel || undefined,
	});

	let decision: RoutingDecision | null = null;
	try {
		decision = await observer.routeResolve(request);
	} catch (error) {
		const message = formatRouteResolutionError(error);
		await safelyEmitRouteEvent(emitRouteEvent, {
			type: "after_route_resolution",
			flow: "multi-agent",
			request,
			decision: null,
			authority: "takumi-fallback",
			applied: false,
			degraded: false,
			provider: currentModel ? inferProvider(currentModel) : undefined,
			model: currentModel || undefined,
			reason: `Engine route ${request.capability} failed: ${message}`,
			resolutionError: message,
		});
		throw error;
	}

	const model = decision?.selected ? extractLegacyOverrideModel(decision, currentModel) : null;
	const authority = model ? "engine" : "takumi-fallback";
	const afterRouteEvent: ExtensionEvent = {
		type: "after_route_resolution",
		flow: "multi-agent",
		request,
		decision,
		authority,
		applied: authority === "engine",
		degraded: Boolean(decision?.degraded || authority !== "engine"),
		provider: model ? inferProvider(model) : currentModel ? inferProvider(currentModel) : undefined,
		model: model ?? (authority !== "engine" ? currentModel || undefined : undefined),
		reason: resolveLegacyRouteReason(request, decision, model),
	};
	await safelyEmitRouteEvent(emitRouteEvent, afterRouteEvent);
	if (afterRouteEvent.degraded) {
		await safelyEmitRouteEvent(emitRouteEvent, {
			...afterRouteEvent,
			type: "route_degraded",
		});
	}

	if (!decision?.selected) {
		return { overrides: {}, laneEnvelopes: {}, decisions: decision ? [decision] : [], notes: [] };
	}

	const notes = [`Engine route ${request.capability} → ${decision.selected.id}`];
	if (!model) {
		return { overrides: {}, laneEnvelopes: {}, decisions: [decision], notes };
	}
	const selected = decision.selected;

	return {
		overrides: Object.fromEntries(roles.map((role) => [role, model])) as Partial<Record<AgentRole, string>>,
		laneEnvelopes: Object.fromEntries(
			roles.map((role) => [
				role,
				{
					consumer: request.consumer,
					sessionId: request.sessionId,
					role,
					capability: request.capability,
					authority: "engine",
					enforcement: "same-provider",
					selectedCapabilityId: selected.id,
					selectedProviderFamily: selected.providerFamily,
					selectedModel: model,
					fallbackModel: model,
					appliedModel: model,
					degraded: decision.degraded,
					reason: decision.reason,
					fallbackChain: decision.fallbackChain,
					policyTrace: decision.policyTrace,
				},
			]),
		) as RoutingOverridePlan["laneEnvelopes"],
		decisions: [decision],
		notes,
	};
}

async function safelyEmitRouteEvent(
	emitRouteEvent: ResolveRoutingOverridesOptions["emitRouteEvent"],
	event: ExtensionEvent,
): Promise<void> {
	if (!emitRouteEvent) return;
	try {
		await emitRouteEvent(event);
	} catch {
		// Ignore hook failures until Track 2 defines explicit policy semantics.
	}
}

function resolveLegacyRouteReason(
	request: RoutingRequest,
	decision: RoutingDecision | null,
	model: string | null,
): string {
	if (!decision?.selected) {
		return `No engine route resolved for ${request.capability}; keeping the current session model.`;
	}
	if (!model) {
		return `Engine route ${decision.selected.id} was not executable in the current session; keeping the current session model.`;
	}
	return decision.reason ?? `Resolved ${request.capability} via ${decision.selected.id}`;
}

function formatRouteResolutionError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function extractLegacyOverrideModel(decision: RoutingDecision, currentModel: string): string | null {
	const selected = decision.selected;
	if (!selected) return null;

	const metadata = selected.metadata;
	const candidate =
		typeof metadata?.model === "string"
			? metadata.model
			: typeof metadata?.modelId === "string"
				? metadata.modelId
				: null;
	if (!candidate) return null;

	const selectedProvider = normalizeProviderFamily(selected.providerFamily);
	const candidateProvider = inferProvider(candidate);
	const currentProvider = currentModel ? inferProvider(currentModel) : null;
	if (selectedProvider && selectedProvider !== candidateProvider) return null;
	if (currentProvider && candidateProvider !== currentProvider) return null;
	return candidate;
}

function normalizeProviderFamily(value?: string): ReturnType<typeof inferProvider> | null {
	if (!value) return null;

	switch (value.toLowerCase()) {
		case "anthropic":
			return "anthropic";
		case "openai":
			return "openai";
		case "google":
		case "gemini":
			return "google";
		case "openai-compat":
		case "openrouter":
		case "ollama":
		case "github":
		case "groq":
		case "deepseek":
		case "mistral":
		case "together":
			return "openai-compat";
		case "darpana":
			return null;
		default:
			return null;
	}
}
