import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
	BridgeBootstrapLaneRequest,
	BridgeBootstrapMode,
	ChitraguptaBridgeOptions,
	ChitraguptaHealth,
	DaemonBridgeBootstrapLane,
	DaemonBridgeBootstrapResult,
	UnifiedRecallResult,
	VasanaTendency,
	VerticalRuntimeContractSurface,
} from "@takumi/bridge";
import { ChitraguptaBridge } from "@takumi/bridge";
import { type ExecBootstrapSnapshot, type ExecBootstrapTransport, normalizeProviderName } from "@takumi/core";

type ExecBridgeLike = Pick<
	ChitraguptaBridge,
	| "connect"
	| "disconnect"
	| "artifactImportBatch"
	| "artifactListImported"
	| "bootstrap"
	| "routeLanesGet"
	| "routeLanesRefresh"
	| "requestProviderCredential"
	| "unifiedRecall"
	| "vasanaTendencies"
	| "healthStatus"
	| "sessionCreate"
	| "sessionMetaUpdate"
	| "turnAdd"
	| "turnMaxNumber"
	| "verticalRuntimeContract"
> & {
	isConnected: boolean;
	isSocketMode: boolean;
};

export interface ExecBootstrapResult extends ExecBootstrapSnapshot {
	bridge: ExecBridgeLike | null;
	memoryContext?: string;
	health?: ChitraguptaHealth | null;
	tendencies?: VasanaTendency[];
	recall?: UnifiedRecallResult[];
	bootstrapResult?: DaemonBridgeBootstrapResult | null;
	canonicalSessionId?: string;
	preferredProvider?: string;
	preferredModel?: string;
	startupLanes?: DaemonBridgeBootstrapLane[];
	verticalContract?: VerticalRuntimeContractSurface | null;
	warnings?: string[];
}

export interface ExecBootstrapOptions {
	cwd?: string;
	createBridge?: (options: ChitraguptaBridgeOptions) => ExecBridgeLike;
	mode?: BridgeBootstrapMode;
	consumer?: string;
	capability?: string;
	configuredProvider?: string;
	configuredModel?: string;
	agentLabel?: string;
}

function loadMcpConfig(cwd: string): { command: string; args: string[] } | null {
	try {
		const mcpPath = path.join(cwd, ".vscode", "mcp.json");
		if (!existsSync(mcpPath)) return null;
		const parsed = JSON.parse(readFileSync(mcpPath, "utf-8"));
		const chitraguptaConfig = parsed?.mcpServers?.chitragupta;
		if (!chitraguptaConfig?.command) return null;
		return { command: chitraguptaConfig.command, args: chitraguptaConfig.args || [] };
	} catch {
		return null;
	}
}

function formatMemoryContext(
	projectName: string,
	recall: UnifiedRecallResult[],
	tendencies: VasanaTendency[],
	health: ChitraguptaHealth | null,
): string | undefined {
	const sections: string[] = [];

	if (recall.length > 0) {
		sections.push(
			[
				`Chitragupta recall for project ${projectName}:`,
				...recall.map(
					(entry, index) =>
						`${index + 1}. [score ${entry.score.toFixed(2)} | ${entry.type}${entry.source ? ` | ${entry.source}` : ""}] ${entry.content}`,
				),
			].join("\n"),
		);
	}

	if (tendencies.length > 0) {
		sections.push(
			[
				"Chitragupta developer tendencies:",
				...tendencies
					.slice(0, 5)
					.map(
						(tendency) =>
							`- ${tendency.tendency} (strength ${tendency.strength.toFixed(2)}, stability ${tendency.stability.toFixed(2)}): ${tendency.description}`,
					),
			].join("\n"),
		);
	}

	if (health) {
		sections.push(
			[
				"Chitragupta health snapshot:",
				`- dominant: ${health.dominant}`,
				`- alerts: ${health.alerts.length > 0 ? health.alerts.join(", ") : "none"}`,
			].join("\n"),
		);
	}

	if (sections.length === 0) return undefined;

	return [
		"Use the following Chitragupta context as guidance when planning and validating work. Prefer it when it improves consistency, but override it if the repository proves otherwise.",
		...sections,
	].join("\n\n");
}

/** Normalize daemon provider ids into Takumi runtime adapter ids. */
function mapDaemonProviderToTakumiProvider(providerId?: string | null): string | undefined {
	const normalized = normalizeProviderName(providerId ?? undefined);
	return normalized || undefined;
}

function buildBootstrapLanes(options: ExecBootstrapOptions): BridgeBootstrapLaneRequest[] {
	const configuredProvider = normalizeProviderName(options.configuredProvider);
	const preferredProviderFamilies = configuredProvider ? [configuredProvider] : [];
	const primaryCapability = options.capability?.trim();
	if (!primaryCapability) return [];
	return [
		{
			key: "primary",
			role: "primary",
			capability: primaryCapability,
			policy: {
				role: "primary",
				requireStreaming: true,
				preferredProviderFamilies,
				fallbackStrategy: "same-provider",
			},
			context: {
				startupLane: "primary",
			},
		},
		{
			key: "planner",
			role: "planner",
			routeClass: "coding.deep-reasoning",
			policy: {
				role: "planner",
				preferredProviderFamilies,
				fallbackStrategy: "capability-only",
			},
			context: {
				startupLane: "planner",
			},
		},
		{
			key: "reviewer",
			role: "reviewer",
			routeClass: "coding.review.strict",
			policy: {
				role: "reviewer",
				maxCostClass: "medium",
				fallbackStrategy: "capability-only",
			},
			context: {
				startupLane: "reviewer",
			},
		},
	];
}

function readPrimaryBootstrapLane(
	result: DaemonBridgeBootstrapResult | null | undefined,
): DaemonBridgeBootstrapLane | null {
	const lanes = result?.lanes ?? [];
	return lanes.find((lane) => lane.key === "primary") ?? lanes[0] ?? null;
}

/** I convert the machine-readable vertical contract into startup warnings when it contradicts Takumi's runtime path. */
function buildVerticalContractWarnings(
	verticalContract: VerticalRuntimeContractSurface | null,
	consumer: string,
): string[] {
	if (!verticalContract) return [];
	const warnings: string[] = [];
	if (!verticalContract.runtime.daemonRuntimeStartupAllowed) {
		warnings.push(`Vertical profile ${consumer} does not allow daemon runtime startup.`);
	}
	if (!verticalContract.runtime.usesDaemonBridgeToken) {
		warnings.push(`Vertical profile ${consumer} does not advertise daemon bridge-token auth.`);
	}
	return warnings;
}

/** I fail closed when the daemon-published vertical profile forbids daemon startup for this runtime. */
function buildBlockedVerticalBootstrapResult(
	consumer: string,
	verticalContract: VerticalRuntimeContractSurface,
	warnings: string[],
): ExecBootstrapResult {
	return {
		bridge: null,
		connected: false,
		degraded: true,
		transport: "unavailable",
		memoryEntries: 0,
		vasanaCount: 0,
		hasHealth: false,
		summary: `Chitragupta unavailable: vertical profile ${consumer} requires serve pairing instead of daemon startup`,
		verticalContract,
		warnings,
	};
}

/**
 * Build one daemon-first bootstrap request that binds the vertical identity,
 * opens a canonical startup session, and records the initial route truth on
 * the same authenticated socket.
 */
function buildBootstrapRequest(cwd: string, projectName: string, options: ExecBootstrapOptions) {
	const mode = options.mode ?? "exec";
	const consumer = options.consumer ?? "takumi";
	const configuredProvider = options.configuredProvider;
	const configuredModel = options.configuredModel;
	const capability = options.capability?.trim();
	const lanes = buildBootstrapLanes(options);
	return {
		mode,
		project: cwd,
		consumer,
		session: {
			project: cwd,
			title: `${consumer} startup — ${projectName}`,
			agent: options.agentLabel ?? (mode === "interactive" ? "takumi" : "takumi.exec"),
			model: configuredModel,
			provider: configuredProvider,
			consumer,
		},
		route: capability
			? {
					consumer,
					capability,
					context: {
						mode: `${mode}-startup`,
						projectPath: cwd,
						configuredProvider,
						configuredModel,
					},
				}
			: undefined,
		...(lanes.length > 0 ? { lanes } : {}),
	};
}

export async function bootstrapChitraguptaForExec(options: ExecBootstrapOptions = {}): Promise<ExecBootstrapResult> {
	const cwd = options.cwd ?? process.cwd();
	const projectName = path.basename(cwd) || cwd;
	const mcpConfig = loadMcpConfig(cwd);
	const bridgeOptions: ChitraguptaBridgeOptions = {
		command: mcpConfig?.command,
		args: mcpConfig?.args,
		projectPath: cwd,
		startupTimeoutMs: 8_000,
	};
	const bridge = options.createBridge?.(bridgeOptions) ?? new ChitraguptaBridge(bridgeOptions);

	try {
		await bridge.connect();
		const consumer = options.consumer ?? "takumi";
		const verticalContract = bridge.isSocketMode
			? await bridge.verticalRuntimeContract(consumer).catch(() => null)
			: null;
		const warnings = buildVerticalContractWarnings(verticalContract, consumer);
		if (bridge.isSocketMode && verticalContract && !verticalContract.runtime.daemonRuntimeStartupAllowed) {
			await bridge.disconnect().catch(() => {
				// best effort
			});
			return buildBlockedVerticalBootstrapResult(consumer, verticalContract, warnings);
		}
		const bootstrapResult = bridge.isSocketMode
			? await bridge.bootstrap(buildBootstrapRequest(cwd, projectName, options)).catch(() => null)
			: null;
		const [recall, tendencies, health] = await Promise.all([
			bridge.unifiedRecall(projectName, 5, projectName).catch(() => []),
			bridge.vasanaTendencies(10).catch(() => []),
			bridge.healthStatus().catch(() => null),
		]);
		const transport: ExecBootstrapTransport = bridge.isSocketMode ? "daemon-socket" : "mcp-stdio";
		const primaryLane = readPrimaryBootstrapLane(bootstrapResult);
		const preferredProvider = mapDaemonProviderToTakumiProvider(
			primaryLane?.routingDecision?.provider ?? bootstrapResult?.routingDecision?.provider,
		);
		const preferredModel = primaryLane?.routingDecision?.model ?? bootstrapResult?.routingDecision?.model ?? undefined;
		const canonicalSessionId = bootstrapResult?.session?.id ?? undefined;
		const bootstrapSummary = primaryLane?.routingDecision?.provider
			? `bound route ${primaryLane.routingDecision.provider}${preferredModel ? ` / ${preferredModel}` : ""}`
			: "bound without a startup route";
		return {
			bridge,
			connected: bridge.isConnected,
			degraded: bootstrapResult?.degraded === true,
			transport,
			memoryEntries: recall.length,
			vasanaCount: tendencies.length,
			hasHealth: Boolean(health),
			summary:
				bootstrapResult && bridge.isSocketMode
					? `Chitragupta connected via ${transport} (${bootstrapSummary})`
					: `Chitragupta connected via ${transport}`,
			memoryContext: formatMemoryContext(projectName, recall, tendencies, health),
			health,
			tendencies,
			recall,
			bootstrapResult,
			canonicalSessionId,
			preferredProvider,
			preferredModel,
			startupLanes: bootstrapResult?.lanes ?? [],
			verticalContract,
			warnings,
		};
	} catch (error) {
		try {
			if (bridge.isConnected) await bridge.disconnect();
		} catch {
			// best effort
		}

		return {
			bridge: null,
			connected: false,
			degraded: true,
			transport: "unavailable",
			memoryEntries: 0,
			vasanaCount: 0,
			hasHealth: false,
			summary: `Chitragupta unavailable: ${(error as Error).message}`,
			error: error as Error,
		};
	}
}
