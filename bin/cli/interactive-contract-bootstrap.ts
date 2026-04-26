import path from "node:path";
import { inferProvider, type ExecBootstrapResult } from "@takumi/agent";
import { ChitraguptaObserver, type DaemonBridgeBootstrapLane, type RoutingDecision, type RoutingRequest } from "@takumi/bridge";
import { normalizeProviderName, type TakumiConfig } from "@takumi/core";
import { detectGitBranch, extractSelectedModel } from "./one-shot-helpers.js";

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
	"moonshot",
	"minimax",
]);

const DEFAULT_STARTUP_CAPABILITY = "coding.patch-cheap";

type InteractiveBootstrapBridge = NonNullable<ExecBootstrapResult["bridge"]>;

interface RouteObserver {
	routeResolve(request: RoutingRequest): Promise<RoutingDecision | null>;
}

type LaneAuthoritySource = "bootstrap" | "route.lanes.get" | "route.lanes.refresh" | "route.resolve";

interface AuthoritativeLaneResult {
	lanes: DaemonBridgeBootstrapLane[];
	primaryLane?: DaemonBridgeBootstrapLane;
	source?: LaneAuthoritySource;
}

export interface InteractiveContractBootstrapOptions {
	cwd?: string;
	consumer?: string;
	capability?: string;
	title?: string;
	createObserver?: (bridge: InteractiveBootstrapBridge) => RouteObserver;
	detectBranch?: (cwd: string) => Promise<string | undefined>;
}

export interface InteractiveContractBootstrapResult {
	canonicalSessionId?: string;
	routingDecision?: RoutingDecision;
	primaryLane?: DaemonBridgeBootstrapLane;
	preferredProvider?: string;
	preferredModel?: string;
	startupLanes?: DaemonBridgeBootstrapLane[];
	laneAuthority?: LaneAuthoritySource;
	strictPreferredRoute: boolean;
	warnings: string[];
}

/**
 * Resolve the interactive startup contract with Chitragupta before the TUI
 * creates a live provider, so canonical session binding and engine-selected
 * provider/model preferences are available up front instead of arriving later.
 */
export async function bootstrapInteractiveContract(
	config: TakumiConfig,
	chitragupta: ExecBootstrapResult | null,
	options: InteractiveContractBootstrapOptions = {},
): Promise<InteractiveContractBootstrapResult> {
	const bridge = chitragupta?.bridge;
	if (!bridge?.isConnected) {
		return { strictPreferredRoute: false, warnings: [] };
	}

	const cwd = options.cwd ?? process.cwd();
	const consumer = options.consumer ?? "takumi";
	const capability = options.capability ?? DEFAULT_STARTUP_CAPABILITY;
	const warnings: string[] = [];
	const branchResolver = options.detectBranch ?? detectGitBranch;
	const canonicalSessionId =
		chitragupta?.canonicalSessionId ??
		(await ensureInteractiveCanonicalSession(bridge, config, cwd, options.title, branchResolver).catch((error: unknown) => {
			warnings.push(`Interactive canonical session bootstrap failed: ${(error as Error).message}`);
			return undefined;
		}));

	if (!bridge.isSocketMode) {
		warnings.push("Interactive startup routing requires daemon-socket mode; mcp-stdio stayed on the configured provider.");
		return {
			canonicalSessionId,
			startupLanes: chitragupta?.startupLanes,
			strictPreferredRoute: false,
			warnings,
		};
	}

	const authoritative = await resolveAuthoritativeStartupLanes(bridge, {
		canonicalSessionId,
		consumer,
		project: cwd,
		startupLanes: chitragupta?.startupLanes ?? [],
		refreshReason: "takumi.interactive-startup",
		warnings,
	});
	if (authoritative.primaryLane?.routingDecision) {
		const preferredModel = authoritative.primaryLane.routingDecision.model ?? undefined;
		const preferredProvider = resolvePreferredProviderFromBootstrap(
			authoritative.primaryLane,
			preferredModel,
			config.provider,
		);
		return {
			canonicalSessionId,
			primaryLane: authoritative.primaryLane,
			preferredProvider,
			preferredModel,
			startupLanes: authoritative.lanes,
			laneAuthority: authoritative.source,
			strictPreferredRoute: Boolean(
				authoritative.primaryLane.routingDecision.selectedCapabilityId || preferredProvider || preferredModel,
			),
			warnings,
		};
	}

	try {
		const observer = (options.createObserver ?? createRouteObserver)(bridge);
		const primaryPolicy =
			authoritative.primaryLane?.requestedPolicy ?? authoritative.primaryLane?.policy ?? buildDefaultPrimaryPolicy();
		const routingDecision = await observer.routeResolve({
			consumer,
			sessionId: canonicalSessionId ?? "transient",
			capability,
			constraints: buildRouteResolveConstraints(primaryPolicy),
			context: {
				mode: "interactive-startup",
				projectPath: cwd,
				configuredProvider: config.provider,
				configuredModel: config.model,
				laneKey: authoritative.primaryLane?.key ?? "primary",
				lanePolicy: primaryPolicy,
			},
		});
		if (!routingDecision?.selected) {
			return {
				canonicalSessionId,
				routingDecision: routingDecision ?? undefined,
				primaryLane: authoritative.primaryLane,
				startupLanes: authoritative.lanes,
				laneAuthority: authoritative.source,
				strictPreferredRoute: false,
				warnings,
			};
		}

		const preferredModel = extractSelectedModel(routingDecision.selected.metadata);
		const preferredProvider = resolvePreferredProvider(routingDecision, preferredModel, config.provider);
		return {
			canonicalSessionId,
			routingDecision,
			primaryLane: authoritative.primaryLane,
			preferredProvider,
			preferredModel,
			startupLanes: authoritative.lanes,
			laneAuthority: authoritative.source ?? "route.resolve",
			strictPreferredRoute: Boolean(preferredProvider || preferredModel),
			warnings,
		};
	} catch (error) {
		warnings.push(`Interactive startup route resolution failed: ${(error as Error).message}`);
		return {
			canonicalSessionId,
			primaryLane: authoritative.primaryLane,
			startupLanes: authoritative.lanes,
			laneAuthority: authoritative.source,
			strictPreferredRoute: false,
			warnings,
		};
	}
}

async function ensureInteractiveCanonicalSession(
	bridge: InteractiveBootstrapBridge,
	config: TakumiConfig,
	cwd: string,
	titleOverride: string | undefined,
	detectBranchFn: (cwd: string) => Promise<string | undefined>,
): Promise<string> {
	const branch = await detectBranchFn(cwd).catch(() => undefined);
	const result = await bridge.sessionCreate({
		project: cwd,
		title: titleOverride ?? `Takumi interactive — ${path.basename(cwd) || "workspace"}`,
		agent: "takumi",
		model: config.model,
		provider: config.provider,
		branch,
	});
	return result.id;
}

async function resolveAuthoritativeStartupLanes(
	bridge: InteractiveBootstrapBridge,
	input: {
		canonicalSessionId?: string;
		consumer: string;
		project: string;
		startupLanes: DaemonBridgeBootstrapLane[];
		refreshReason: string;
		warnings: string[];
	},
): Promise<AuthoritativeLaneResult> {
	if (!input.canonicalSessionId) {
		return buildLaneResult(input.startupLanes, input.startupLanes.length > 0 ? "bootstrap" : undefined);
	}

	try {
		const refreshed = await bridge.routeLanesRefresh({
			sessionId: input.canonicalSessionId,
			project: input.project,
			consumer: input.consumer,
			refreshReason: input.refreshReason,
		});
		if (refreshed?.lanes.length) {
			return buildLaneResult(refreshed.lanes, "route.lanes.refresh");
		}
	} catch (error) {
		input.warnings.push(`Interactive startup lane refresh failed: ${(error as Error).message}`);
	}

	try {
		const stored = await bridge.routeLanesGet({
			sessionId: input.canonicalSessionId,
			project: input.project,
		});
		if (stored?.lanes.length) {
			return buildLaneResult(stored.lanes, "route.lanes.get");
		}
	} catch (error) {
		input.warnings.push(`Interactive startup lane reload failed: ${(error as Error).message}`);
	}

	return buildLaneResult(input.startupLanes, input.startupLanes.length > 0 ? "bootstrap" : undefined);
}

function buildLaneResult(lanes: DaemonBridgeBootstrapLane[], source?: LaneAuthoritySource): AuthoritativeLaneResult {
	const primaryLane = lanes.find((lane) => lane.key === "primary") ?? lanes[0];
	return { lanes, primaryLane, source };
}

function buildDefaultPrimaryPolicy() {
	return {
		preferLocal: null,
		allowCloud: null,
		maxCostClass: null,
		requireStreaming: true,
		hardProviderFamily: null,
	};
}

function buildRouteResolveConstraints(policy: {
	preferLocal?: boolean | null;
	allowCloud?: boolean | null;
	maxCostClass?: "free" | "low" | "medium" | "high" | null;
	requireStreaming?: boolean | null;
	hardProviderFamily?: string | null;
}): RoutingRequest["constraints"] {
	const constraints: RoutingRequest["constraints"] = {};
	if (typeof policy.preferLocal === "boolean") constraints.preferLocal = policy.preferLocal;
	if (typeof policy.allowCloud === "boolean") constraints.allowCloud = policy.allowCloud;
	if (policy.maxCostClass) constraints.maxCostClass = policy.maxCostClass;
	if (typeof policy.requireStreaming === "boolean") constraints.requireStreaming = policy.requireStreaming;
	if (policy.hardProviderFamily) constraints.hardProviderFamily = policy.hardProviderFamily;
	return constraints;
}

function createRouteObserver(bridge: InteractiveBootstrapBridge): RouteObserver {
	return new ChitraguptaObserver(bridge as never);
}

function resolvePreferredProviderFromBootstrap(
	lane: DaemonBridgeBootstrapLane,
	preferredModel: string | undefined,
	configuredProvider: string,
): string | undefined {
	const providerFromModel = preferredModel ? mapProviderFamilyToProvider(inferProvider(preferredModel), configuredProvider) : undefined;
	if (providerFromModel) return providerFromModel;
	return mapProviderFamilyToProvider(lane.routingDecision?.provider ?? undefined, configuredProvider);
}

function resolvePreferredProvider(
	routingDecision: RoutingDecision,
	preferredModel: string | undefined,
	configuredProvider: string,
): string | undefined {
	const providerFromModel = preferredModel ? mapProviderFamilyToProvider(inferProvider(preferredModel), configuredProvider) : undefined;
	if (providerFromModel) {
		return providerFromModel;
	}

	return mapProviderFamilyToProvider(routingDecision.selected?.providerFamily, configuredProvider);
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
