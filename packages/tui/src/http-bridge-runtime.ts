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
import {
	ArtifactStore,
	createLogger,
	type FleetSummary,
	type ObservabilitySessionSummary,
	type OperatorAlert,
} from "@takumi/core";
import type { AgentRunner } from "./agent-runner.js";
import { listLocalRuntimes, startLocalRuntime, stopLocalRuntime } from "./desktop-runtime-control.js";
import type { ExtensionUiStore } from "./extension-ui-store.js";
import { buildExtensionUiSnapshot, resolveExtensionPromptResponse } from "./http-bridge-extension-ui.js";
import type { AppState } from "./state.js";

const log = createLogger("desktop-bridge-runtime");
const artifactStore = new ArtifactStore();

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

function summarizeRouting(state: AppState): NonNullable<AgentStateSnapshot["routing"]> | null {
	const decisions = state.routingDecisions.value;
	const latest = decisions.at(-1);
	if (!latest) return null;
	return {
		capability: latest.request?.capability ?? null,
		authority: latest.selected ? "engine" : "takumi-fallback",
		enforcement: latest.selected ? "same-provider" : "capability-only",
		laneCount: decisions.length,
		degraded: latest.degraded === true,
		fallbackChain: latest.fallbackChain ?? [],
		reason: latest.reason ?? null,
		selectedId: latest.selected?.id ?? null,
	};
}

function summarizeApproval(state: AppState): NonNullable<AgentStateSnapshot["approval"]> | null {
	const pending = state.pendingPermission.value;
	if (!pending) return { pendingCount: 0, tool: null, argsSummary: null };
	const argsSummary = JSON.stringify(pending.args).slice(0, 240);
	return {
		pendingCount: 1,
		tool: pending.tool,
		argsSummary,
	};
}

function summarizeAnomaly(state: AppState): NonNullable<AgentStateSnapshot["anomaly"]> | null {
	const anomaly = state.chitraguptaAnomaly.value;
	if (!anomaly) return null;
	return {
		severity: anomaly.severity,
		details: anomaly.details,
		suggestion: anomaly.suggestion,
	};
}

function isAlertAcknowledged(state: AppState, alertId: string): boolean {
	return state.acknowledgedAlerts.value.has(alertId);
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
	const sessionId = state.canonicalSessionId.value || state.sessionId.value || undefined;
	const manifest = await artifactStore.manifest({ sessionId, kind: kind as never, limit });
	return manifest.map((entry) => ({
		artifactId: entry.artifactId,
		kind: entry.kind,
		producer: entry.producer,
		summary: entry.summary,
		createdAt: entry.createdAt,
		promoted: false,
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

export function buildSessionSummary(state: AppState): ObservabilitySessionSummary {
	const contextPercent = Number.isFinite(state.contextPercent.value) ? state.contextPercent.value : 0;
	const routing = summarizeRouting(state);
	return {
		sessionId: state.sessionId.value || "unknown",
		activity: state.isStreaming.value ? "working" : state.pendingPermission.value ? "waiting_input" : "idle",
		model: state.model.value,
		provider: state.provider.value,
		costUsd: state.totalCost.value,
		contextPercent,
		pressure:
			contextPercent >= 95
				? "at_limit"
				: contextPercent >= 85
					? "near_limit"
					: contextPercent >= 70
						? "approaching_limit"
						: "normal",
		turnCount: state.turnCount.value,
		toolFailures: summarizeAnomaly(state) ? 1 : 0,
		degraded: routing?.degraded ?? false,
		fallbackChain: routing?.fallbackChain,
		lastHeartbeatAt: Date.now(),
	};
}

export function buildOperatorAlerts(state: AppState): OperatorAlert[] {
	const alerts: OperatorAlert[] = [];
	const now = Date.now();
	const approval = summarizeApproval(state);
	const anomaly = summarizeAnomaly(state);
	const routing = summarizeRouting(state);
	const contextPercent = Number.isFinite(state.contextPercent.value) ? state.contextPercent.value : 0;

	if (approval && approval.pendingCount > 0) {
		alerts.push({
			id: "approval-pending",
			kind: "approval_pressure",
			severity: "warning",
			message: `Approval pending for ${approval.tool ?? "tool"}`,
			source: state.sessionId.value || "unknown",
			createdAt: now,
			acknowledged: isAlertAcknowledged(state, "approval-pending"),
		});
	}

	if (contextPercent >= 95) {
		alerts.push({
			id: "context-critical",
			kind: "context_pressure",
			severity: "critical",
			message: `Context at ${Math.round(contextPercent)}%`,
			source: state.sessionId.value || "unknown",
			createdAt: now,
			acknowledged: isAlertAcknowledged(state, "context-critical"),
		});
	} else if (contextPercent >= 85) {
		alerts.push({
			id: "context-warning",
			kind: "context_pressure",
			severity: "warning",
			message: `Context approaching limit (${Math.round(contextPercent)}%)`,
			source: state.sessionId.value || "unknown",
			createdAt: now,
			acknowledged: isAlertAcknowledged(state, "context-warning"),
		});
	}

	if (routing?.degraded) {
		alerts.push({
			id: "routing-degraded",
			kind: "degraded_routing",
			severity: "warning",
			message: routing.reason ? `Degraded routing: ${routing.reason}` : "Degraded routing active",
			source: state.sessionId.value || "unknown",
			createdAt: now,
			acknowledged: isAlertAcknowledged(state, "routing-degraded"),
		});
	}

	if (anomaly) {
		alerts.push({
			id: "daemon-anomaly",
			kind: "repeated_failure",
			severity: anomaly.severity === "critical" ? "critical" : "warning",
			message: anomaly.details,
			source: state.sessionId.value || "unknown",
			createdAt: now,
			acknowledged: isAlertAcknowledged(state, "daemon-anomaly"),
		});
	}

	return alerts;
}

export function buildFleetSummary(state: AppState): FleetSummary {
	const sessions = [buildSessionSummary(state)];
	const activeAlerts = buildOperatorAlerts(state).filter((alert) => !alert.acknowledged);
	const alertCounts = {
		info: activeAlerts.filter((alert) => alert.severity === "info").length,
		warning: activeAlerts.filter((alert) => alert.severity === "warning").length,
		critical: activeAlerts.filter((alert) => alert.severity === "critical").length,
	};
	return {
		totalAgents: 1,
		workingAgents: sessions.filter((session) => session.activity === "working").length,
		idleAgents: sessions.filter((session) => session.activity === "idle" || session.activity === "waiting_input")
			.length,
		errorAgents: sessions.filter((session) => session.activity === "error").length,
		totalCostUsd: sessions.reduce((sum, session) => sum + session.costUsd, 0),
		alertCounts,
		sessions,
		activeAlerts,
		snapshotAt: Date.now(),
	};
}

export function buildAgentStateSnapshot(
	state: AppState,
	extensionUiStore?: ExtensionUiStore | null,
): AgentStateSnapshot {
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
		routing: summarizeRouting(state),
		approval: summarizeApproval(state),
		anomaly: summarizeAnomaly(state),
		extensionUi: buildExtensionUiSnapshot(extensionUiStore),
		updatedAt: Date.now(),
	};
}

export async function startDesktopBridge(
	state: AppState,
	agentRunner: AgentRunner | null,
	extensionUiStore?: ExtensionUiStore | null,
): Promise<HttpBridgeServer | null> {
	const rawPort = process.env.TAKUMI_BRIDGE_PORT || "3100";
	const port = Number.parseInt(rawPort, 10);
	if (Number.isNaN(port) || port <= 0) return null;

	let bridge: HttpBridgeServer;
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
		getAgentState: async () => buildAgentStateSnapshot(state, extensionUiStore),
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
		onAttachSession: async (sessionId) => {
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
			} catch (err) {
				return { success: false, error: (err as Error).message };
			}
		},
		getFleetSummary: async () => buildFleetSummary(state),
		getAlerts: async () => buildOperatorAlerts(state).filter((alert) => !alert.acknowledged),
		acknowledgeAlert: async (alertId) => {
			const known = buildOperatorAlerts(state).some((alert) => alert.id === alertId);
			if (!known) return false;
			const next = new Set(state.acknowledgedAlerts.value);
			next.add(alertId);
			state.acknowledgedAlerts.value = next;
			return true;
		},
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
