import {
	type AgentStateSnapshot,
	type BridgeArtifactDetail,
	type BridgeArtifactSummary,
	gitBranch,
	gitDiff,
	gitStatus,
	HttpBridgeServer,
	type PendingApprovalSnapshot,
	type RepoDiffSnapshot,
} from "@takumi/bridge";
import { ArtifactStore, createLogger } from "@takumi/core";
import type { AgentRunner } from "../agent/agent-runner.js";
import {
	buildContinuityDetail,
	buildContinuitySummary,
	type ContinuityBridgeSnapshot,
	ContinuityCompanionRegistry,
	detachContinuityPeer,
	heartbeatContinuityPeer,
	redeemContinuityGrant,
	sweepStaleContinuityPeers,
} from "../continuity/continuity-runtime.js";
import { listLocalRuntimes, startLocalRuntime, stopLocalRuntime } from "../desktop-runtime-control.js";
import type { ExtensionUiStore } from "../extension-ui-store.js";
import {
	acknowledgeOperatorAlert,
	buildActiveOperatorAlerts,
	buildFleetSummary,
	summarizeAnomaly,
	summarizeApproval,
	summarizeChitraguptaSync,
	summarizeRouting,
} from "../operator-observability.js";
import type { AppState } from "../state.js";
import { buildExtensionUiSnapshot, resolveExtensionPromptResponse } from "./http-bridge-extension-ui.js";
import {
	type TokmeterProjectSnapshotData,
	TokmeterProjectTracker,
	type TokmeterProjectTrackerOptions,
} from "./tokmeter-project-snapshot.js";

export {
	acknowledgeOperatorAlert,
	buildActiveOperatorAlerts,
	buildFleetSummary,
	buildOperatorAlerts,
	buildRecentDegradedRoutingDecisions,
	buildSessionSummary,
	describeRoutingDecisionTarget,
	summarizeAnomaly,
	summarizeApproval,
	summarizeChitraguptaSync,
	summarizeRouting,
} from "../operator-observability.js";

const log = createLogger("desktop-bridge-runtime");
const artifactStore = new ArtifactStore();

type AgentStateSnapshotWithContinuity = AgentStateSnapshot & {
	continuity?: ContinuityBridgeSnapshot | null;
};

export interface DesktopBridgeRuntimeOptions {
	attachSession?: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
	persistSession?: () => Promise<void>;
	/** Test seam for injecting a lightweight tokmeter tracker. */
	tokmeterOptions?: TokmeterProjectTrackerOptions;
}

function detectRuntimeSource(): string {
	if (process.env.TMUX) return "tmux";
	if (process.env.WSL_DISTRO_NAME) return "wsl";
	if (process.env.TERM_PROGRAM) return process.env.TERM_PROGRAM.toLowerCase();
	return "terminal";
}

function latestAssistantText(state: AppState): string | null {
	if (state.streamingText.value.trim()) return state.streamingText.value;
	const messages = state.messages.value;
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== "assistant") continue;
		for (let blockIndex = message.content.length - 1; blockIndex >= 0; blockIndex--) {
			const block = message.content[blockIndex];
			if (block.type === "text" && block.text.trim()) return block.text;
		}
	}
	return null;
}

function currentContextPressure(state: AppState): string | null {
	return state.contextPressure.value || null;
}

function summarizeUsage(state: AppState): NonNullable<AgentStateSnapshot["usage"]> {
	return {
		turnCount: state.turnCount.value,
		totalTokens: state.totalTokens.value,
		totalCostUsd: state.totalCost.value,
		ratePerMinute: state.costRatePerMinute.value,
		projectedUsd: state.costProjectedUsd.value,
		budgetFraction: state.costBudgetFraction.value,
		alertLevel: state.costAlertLevel.value,
	};
}

function buildPendingApprovals(state: AppState): PendingApprovalSnapshot[] {
	const pendingIds = new Set(
		[state.pendingPermission.value?.approvalId].filter(
			(value): value is string => typeof value === "string" && value.length > 0,
		),
	);
	return state.approvalQueue.snapshot().pending.map((record) => ({
		id: record.id,
		tool: record.tool,
		argsSummary: record.argsSummary,
		createdAt: record.createdAt,
		sessionId: record.sessionId,
		lane: record.lane,
		reason: record.reason,
		active: pendingIds.has(record.id),
	}));
}

async function buildArtifacts(state: AppState, kind?: string, limit = 20): Promise<BridgeArtifactSummary[]> {
	const sessionIds = Array.from(
		new Set(
			[state.sessionId.value, state.canonicalSessionId.value].filter((value) => typeof value === "string" && value),
		),
	);
	const manifests =
		sessionIds.length > 0
			? await Promise.all(sessionIds.map((sessionId) => artifactStore.manifest({ sessionId, kind: kind as never })))
			: [await artifactStore.manifest({ kind: kind as never })];
	const manifest = Array.from(new Map(manifests.flat().map((entry) => [entry.artifactId, entry] as const)).values())
		.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
		.slice(0, limit);
	return manifest.map((entry) => ({
		artifactId: entry.artifactId,
		kind: entry.kind,
		producer: entry.producer,
		summary: entry.summary,
		createdAt: entry.createdAt,
		promoted: entry.promoted,
		taskId: entry.taskId,
		sessionId: entry.sessionId,
	}));
}

async function buildArtifactDetail(artifactId: string): Promise<BridgeArtifactDetail | null> {
	const artifact = await artifactStore.load(artifactId);
	if (!artifact) return null;
	return {
		artifactId: artifact.artifactId,
		kind: artifact.kind,
		producer: artifact.producer,
		summary: artifact.summary,
		createdAt: artifact.createdAt,
		promoted: artifact.promoted,
		taskId: artifact.taskId,
		sessionId: artifact._sessionId,
		body: artifact.body,
		path: artifact.path,
		confidence: artifact.confidence,
		laneId: artifact.laneId,
		metadata: artifact.metadata,
	};
}

function buildRepoDiffSnapshot(): RepoDiffSnapshot {
	const cwd = process.cwd();
	const status = gitStatus(cwd);
	return {
		branch: gitBranch(cwd),
		isClean: status?.isClean ?? true,
		stagedFiles: status?.staged ?? [],
		modifiedFiles: status?.modified ?? [],
		untrackedFiles: status?.untracked ?? [],
		stagedDiff: gitDiff(cwd, true) ?? "",
		workingDiff: gitDiff(cwd, false) ?? "",
	};
}

async function decidePendingApproval(
	state: AppState,
	approvalId: string,
	decision: "approved" | "denied",
): Promise<boolean> {
	const pending = state.pendingPermission.value;
	if (pending?.approvalId !== approvalId) {
		return Boolean(await state.approvalQueue.decide(approvalId, decision, "operator"));
	}
	pending.resolve({ allowed: decision === "approved", reason: `Desktop operator ${decision}` });
	state.pendingPermission.value = null;
	if (state.topDialog === "permission") state.popDialog();
	return true;
}

export function buildAgentStateSnapshot(
	state: AppState,
	extensionUiStore?: ExtensionUiStore | null,
	tokmeterSnapshot?: TokmeterProjectSnapshotData | null,
): AgentStateSnapshotWithContinuity {
	return {
		pid: process.pid,
		activity: state.isStreaming.value ? "working" : state.pendingPermission.value ? "waiting_input" : "idle",
		model: state.model.value || null,
		provider: state.provider.value || null,
		sessionId: state.sessionId.value || null,
		runtimeSource: detectRuntimeSource(),
		lastAssistantText: latestAssistantText(state),
		toolsInFlight: state.activeTool.value ? [state.activeTool.value] : [],
		contextPercent: Number.isFinite(state.contextPercent.value) ? state.contextPercent.value : null,
		contextPressure: currentContextPressure(state),
		bridgeConnected: state.chitraguptaConnected.value,
		sync: summarizeChitraguptaSync(state),
		routing: summarizeRouting(state),
		approval: summarizeApproval(state),
		usage: summarizeUsage(state),
		anomaly: summarizeAnomaly(state),
		continuity: buildContinuitySummary(state),
		extensionUi: buildExtensionUiSnapshot(extensionUiStore),
		tokmeter: tokmeterSnapshot ?? null,
		updatedAt: Date.now(),
	} satisfies AgentStateSnapshotWithContinuity;
}

/**
 * I keep the bridge attach endpoint honest: if the runtime can switch sessions,
 * I delegate to that canonical attach path instead of pretending that "session
 * exists somewhere" means the desktop shell is actually attached.
 */
export async function attachDesktopBridgeSession(
	state: AppState,
	sessionId: string,
	attachSession?: DesktopBridgeRuntimeOptions["attachSession"],
): Promise<{ success: boolean; error?: string }> {
	if (attachSession) {
		try {
			return await attachSession(sessionId);
		} catch (error) {
			return { success: false, error: (error as Error).message };
		}
	}

	try {
		const { loadSession } = await import("@takumi/core");
		const local = await loadSession(sessionId);
		if (local) {
			return { success: true };
		}
		const chitragupta = state.chitraguptaBridge.value;
		if (!chitragupta?.isConnected) {
			return { success: false, error: "Session not found locally and daemon not connected" };
		}
		const { reconstructFromDaemon: recover } = await import("@takumi/bridge");
		const recovered = await recover(chitragupta, sessionId);
		if (!recovered || recovered.messages.length === 0) {
			return { success: false, error: "Session not found on daemon" };
		}
		return { success: true };
	} catch (error) {
		return { success: false, error: (error as Error).message };
	}
}

export async function startDesktopBridge(
	state: AppState,
	agentRunner: AgentRunner | null,
	extensionUiStore?: ExtensionUiStore | null,
	options: DesktopBridgeRuntimeOptions = {},
): Promise<HttpBridgeServer | null> {
	const rawPort = process.env.TAKUMI_BRIDGE_PORT || "3100";
	const port = Number.parseInt(rawPort, 10);
	if (Number.isNaN(port) || port <= 0) return null;
	const tokmeterTracker = new TokmeterProjectTracker(options.tokmeterOptions ?? { projectRoot: process.cwd() });
	const companionRegistry = new ContinuityCompanionRegistry();

	let bridge: HttpBridgeServer;
	const persistContinuityChange = async (notify = true): Promise<void> => {
		await options.persistSession?.();
		if (notify) {
			bridge.notifyStateChange();
		}
	};
	const sweepStalePeers = async (): Promise<boolean> => {
		const changed = sweepStaleContinuityPeers(state, companionRegistry);
		if (changed) {
			await persistContinuityChange();
		}
		return changed;
	};
	const mapRedeemResult = async (result: ReturnType<typeof redeemContinuityGrant>) => {
		if (result.ok) {
			if (result.stateChanged) {
				await persistContinuityChange();
			}
			return {
				success: true as const,
				peer: result.peer!,
				continuity: result.continuity ?? null,
				companionSession: result.companionSession!,
			};
		}
		if (result.stateChanged) {
			await persistContinuityChange();
		}
		return {
			success: false as const,
			statusCode: result.statusCode ?? 500,
			error: result.error ?? "Continuity redemption failed",
		};
	};
	const mapPeerActionResult = async (result: ReturnType<typeof heartbeatContinuityPeer>) => {
		if (result.ok) {
			return {
				success: true as const,
				...(result.peer ? { peer: result.peer } : {}),
				...(result.continuity !== undefined ? { continuity: result.continuity } : {}),
			};
		}
		return {
			success: false as const,
			statusCode: result.statusCode ?? 500,
			error: result.error ?? "Continuity peer action failed",
		};
	};
	bridge = new HttpBridgeServer({
		port,
		host: "127.0.0.1",
		bearerToken: process.env.TAKUMI_BRIDGE_TOKEN,
		onSend: async (text) => {
			await agentRunner?.submit(text);
		},
		getStatus: async () => ({
			status: state.chitraguptaConnected.value ? "connected" : "degraded",
			pid: process.pid,
			sessionId: state.sessionId.value || null,
			provider: state.provider.value || null,
			model: state.model.value || null,
			runtimeSource: detectRuntimeSource(),
			chitraguptaConnected: state.chitraguptaConnected.value,
		}),
		getContinuityState: async () => {
			await sweepStalePeers();
			return buildContinuityDetail(state);
		},
		redeemContinuityGrant: async (input) =>
			mapRedeemResult(
				redeemContinuityGrant(state, companionRegistry, {
					grantId: input.grantId,
					nonce: input.nonce,
					kind: input.kind === "browser" || input.kind === "phone" || input.kind === "runtime" ? input.kind : undefined,
				}),
			),
		heartbeatContinuityPeer: async (input) => {
			await sweepStalePeers();
			return mapPeerActionResult(
				heartbeatContinuityPeer(state, companionRegistry, {
					peerId: input.peerId,
					companionToken: input.companionToken,
				}),
			);
		},
		detachContinuityPeer: async (input) => {
			await sweepStalePeers();
			const result = detachContinuityPeer(state, companionRegistry, {
				peerId: input.peerId,
				companionToken: input.companionToken,
			});
			if (result.ok && result.stateChanged) {
				await persistContinuityChange();
			}
			return mapPeerActionResult(result);
		},
		getAgentState: async () => {
			const tokmeterSnapshot = await tokmeterTracker.getSnapshot();
			return buildAgentStateSnapshot(state, extensionUiStore, tokmeterSnapshot);
		},
		listAgents: async () => [process.pid],
		getSessionList: async (limit) => {
			const chitragupta = state.chitraguptaBridge.value;
			if (!chitragupta?.isConnected) return [];
			return chitragupta.sessionList(limit);
		},
		getSessionDetail: async (sessionId) => {
			const chitragupta = state.chitraguptaBridge.value;
			if (!chitragupta?.isConnected) return null;
			return chitragupta.sessionShow(sessionId);
		},
		onAttachSession: async (sessionId) => attachDesktopBridgeSession(state, sessionId, options.attachSession),
		getFleetSummary: async () => buildFleetSummary(state),
		getAlerts: async () => buildActiveOperatorAlerts(state),
		acknowledgeAlert: async (alertId) => acknowledgeOperatorAlert(state, alertId),
		getPendingApprovals: async () => buildPendingApprovals(state),
		decideApproval: async (approvalId, decision) => decidePendingApproval(state, approvalId, decision),
		getArtifacts: async (_sessionId, kind, limit) => buildArtifacts(state, kind, limit),
		getArtifact: async (artifactId) => buildArtifactDetail(artifactId),
		setArtifactPromoted: async (artifactId, promoted) => artifactStore.setPromoted(artifactId, promoted),
		getRepoDiff: async () => buildRepoDiffSnapshot(),
		onInterrupt: async (pid) => {
			if (pid !== process.pid || !agentRunner) return false;
			agentRunner.cancel();
			return true;
		},
		onRefresh: async (pid) => {
			if (pid !== process.pid) return false;
			bridge.notifyStateChange();
			return true;
		},
		onStartRuntime: async (options) =>
			startLocalRuntime({
				sessionId: options?.sessionId,
				provider: options?.provider ?? (state.provider.value || undefined),
				model: options?.model ?? (state.model.value || undefined),
				workingDirectory: process.cwd(),
			}),
		listRuntimes: async () => listLocalRuntimes(),
		stopRuntime: async (runtimeId) => stopLocalRuntime(runtimeId),
		respondExtensionPrompt: async (response) => {
			const normalizedResponse =
				response.action === "pick" && typeof response.index === "number"
					? { action: "pick" as const, index: response.index }
					: response.action === "confirm"
						? { action: "confirm" as const }
						: { action: "cancel" as const };
			const result = resolveExtensionPromptResponse(extensionUiStore, normalizedResponse);
			if (result.success) {
				bridge.notifyStateChange();
			}
			return result;
		},
	});

	try {
		await bridge.start();
		log.info(`Desktop bridge listening on 127.0.0.1:${port}`);
		return bridge;
	} catch (error) {
		log.warn(`Desktop bridge disabled: ${(error as Error).message}`);
		return null;
	}
}
