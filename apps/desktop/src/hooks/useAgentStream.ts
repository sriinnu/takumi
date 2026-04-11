import { useCallback, useEffect, useRef, useState } from "react";

export interface AgentState {
	pid: number;
	activity: "working" | "waiting_input" | "idle" | "error";
	model: string | null;
	provider: string | null;
	sessionId: string | null;
	runtimeSource: string | null;
	lastAssistantText: string | null;
	toolsInFlight: string[];
	contextPercent: number | null;
	contextPressure?: string | null;
	bridgeConnected?: boolean;
	sync?: {
		canonicalSessionId: string | null;
		status: "idle" | "pending" | "syncing" | "ready" | "failed";
		pendingLocalTurns: number;
		lastSyncError: string | null;
		lastSyncedMessageId: string | null;
		lastSyncedMessageTimestamp: number | null;
		lastAttemptedMessageId: string | null;
		lastAttemptedMessageTimestamp: number | null;
		lastFailedMessageId: string | null;
		lastFailedMessageTimestamp: number | null;
		lastSyncedAt: number | null;
	} | null;
	routing?: {
		capability: string | null;
		authority: "engine" | "takumi-fallback";
		enforcement: "same-provider" | "capability-only";
		laneCount: number;
		degraded: boolean;
		fallbackChain: string[];
		reason: string | null;
		selectedId: string | null;
	} | null;
	approval?: {
		pendingCount: number;
		tool: string | null;
		argsSummary: string | null;
	} | null;
	usage?: {
		turnCount: number;
		totalTokens: number;
		totalCostUsd: number;
		ratePerMinute: number;
		projectedUsd: number;
		budgetFraction: number;
		alertLevel: "none" | "info" | "warning" | "critical";
	} | null;
	anomaly?: {
		severity: string;
		details: string;
		suggestion: string | null;
	} | null;
	extensionUi?: {
		prompt:
			| {
					kind: "confirm";
					title?: string;
					message: string;
			  }
				| {
						kind: "pick";
						title?: string;
						message: string;
						optionCount: number;
						options: Array<{ index: number; label: string; description?: string }>;
				  }
			| null;
		widgets: Array<{
			key: string;
			previewLines: string[];
			truncated: boolean;
		}>;
	} | null;
	tokmeter?: {
		source: "tokmeter-core";
		projectQuery: string;
		refreshedAt: number;
		matchedProjects: string[];
		totalTokens: number;
		totalCostUsd: number;
		todayTokens: number;
		todayCostUsd: number;
		activeDays: number;
		totalRecords: number;
		topModels: Array<{
			model: string;
			provider: string;
			totalTokens: number;
			costUsd: number;
			percentageOfTotal: number;
		}>;
		topProviders: Array<{
			provider: string;
			totalTokens: number;
			costUsd: number;
			percentageOfTotal: number;
		}>;
		recentDaily: Array<{
			date: string;
			totalTokens: number;
			costUsd: number;
		}>;
		note: string | null;
	} | null;
	updatedAt: number;
}

export interface SessionSummary {
	id: string;
	title: string;
	timestamp: number;
	turns: number;
}

export interface SessionDetail {
	id: string;
	title: string;
	turns: Array<{ role: string; content: string; timestamp: number }>;
}

export interface OperatorAlert {
	id: string;
	kind: string;
	severity: "info" | "warning" | "critical";
	message: string;
	source: string;
	createdAt: number;
	acknowledged: boolean;
}

export interface PendingApproval {
	id: string;
	tool: string;
	argsSummary: string;
	createdAt: number;
	sessionId?: string;
	lane?: "session" | "project" | "global";
	reason?: string;
	active: boolean;
}

export interface ArtifactSummary {
	artifactId: string;
	kind: string;
	producer: string;
	summary: string;
	createdAt: string;
	promoted: boolean;
	taskId?: string;
	sessionId?: string;
}

export interface ArtifactDetail extends ArtifactSummary {
	body?: string;
	path?: string;
	confidence?: number;
	laneId?: string;
	metadata?: Record<string, unknown>;
}

export interface RepoDiffSnapshot {
	branch: string | null;
	isClean: boolean;
	stagedFiles: string[];
	modifiedFiles: string[];
	untrackedFiles: string[];
	stagedDiff: string;
	workingDiff: string;
}

export interface RuntimeSummary {
	runtimeId: string;
	pid: number;
	state: string;
	startedAt: number;
	cwd: string;
	logFile: string;
	command?: string;
	args?: string[];
	sessionId?: string;
	runtimeSource?: string;
}

export interface FleetSummary {
	totalAgents: number;
	workingAgents: number;
	idleAgents: number;
	errorAgents: number;
	totalCostUsd: number;
	alertCounts: Record<"info" | "warning" | "critical", number>;
	snapshotAt: number;
}

interface UseAgentStreamOptions {
	baseUrl?: string;
	pollTimeoutMs?: number;
}

const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 200;

function isLocalhostUrl(url: string): boolean {
	return url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:");
}

/**
 * Long-polls the HTTP bridge `/watch` endpoint for agent state changes.
 * Includes retry with exponential backoff on network failures.
 */
export function useAgentStream(opts: UseAgentStreamOptions = {}) {
	const { baseUrl = "http://localhost:3100", pollTimeoutMs = 30_000 } = opts;

	if (!isLocalhostUrl(baseUrl)) {
		throw new Error("baseUrl must be localhost");
	}

	const [agents, setAgents] = useState<number[]>([]);
	const [state, setState] = useState<AgentState | null>(null);
	const [sessions, setSessions] = useState<SessionSummary[]>([]);
	const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
	const [fleet, setFleet] = useState<FleetSummary | null>(null);
	const [alerts, setAlerts] = useState<OperatorAlert[]>([]);
	const [approvals, setApprovals] = useState<PendingApproval[]>([]);
	const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
	const [repoDiff, setRepoDiff] = useState<RepoDiffSnapshot | null>(null);
	const [runtimes, setRuntimes] = useState<RuntimeSummary[]>([]);
	const [connected, setConnected] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const fingerprintRef = useRef(0);
	const abortRef = useRef<AbortController | null>(null);
	const isMountedRef = useRef(true);
	const sessionIdRef = useRef<string | null>(null);
	const sessionDetailIdRef = useRef<string | null>(null);

	useEffect(() => {
		return () => {
			isMountedRef.current = false;
		};
	}, []);

	const fetchState = useCallback(
		async (pid: number, signal: AbortSignal) => {
			const res = await fetch(`${baseUrl}/latest/${pid}`, { signal });
			if (!res.ok || !isMountedRef.current) return;
			const data = (await res.json()) as AgentState;
			if (isMountedRef.current) {
				sessionIdRef.current = data.sessionId;
				setState(data);
			}
		},
		[baseUrl],
	);

	const fetchSessions = useCallback(
		async (signal: AbortSignal) => {
			const res = await fetch(`${baseUrl}/sessions?limit=24`, { signal });
			if (!res.ok || !isMountedRef.current) return;
			const data = (await res.json()) as { sessions: SessionSummary[] };
			if (isMountedRef.current) setSessions(data.sessions);
		},
		[baseUrl],
	);

	const loadSessionDetail = useCallback(
		async (sessionId: string, signal?: AbortSignal) => {
			const res = await fetch(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}`, { signal });
			if (!res.ok || !isMountedRef.current) return null;
			const data = (await res.json()) as SessionDetail;
			if (isMountedRef.current) {
				sessionDetailIdRef.current = data.id;
				setSessionDetail(data);
			}
			return data;
		},
		[baseUrl],
	);

	const fetchFleet = useCallback(
		async (signal: AbortSignal) => {
			const res = await fetch(`${baseUrl}/fleet`, { signal });
			if (!res.ok || !isMountedRef.current) return;
			const data = (await res.json()) as FleetSummary;
			if (isMountedRef.current) setFleet(data);
		},
		[baseUrl],
	);

	const fetchAlerts = useCallback(
		async (signal: AbortSignal) => {
			const res = await fetch(`${baseUrl}/alerts`, { signal });
			if (!res.ok || !isMountedRef.current) return;
			const data = (await res.json()) as { alerts: OperatorAlert[] };
			if (isMountedRef.current) setAlerts(data.alerts);
		},
		[baseUrl],
	);

	const fetchApprovals = useCallback(
		async (signal: AbortSignal) => {
			const res = await fetch(`${baseUrl}/approvals`, { signal });
			if (!res.ok || !isMountedRef.current) return;
			const data = (await res.json()) as { approvals: PendingApproval[] };
			if (isMountedRef.current) setApprovals(data.approvals);
		},
		[baseUrl],
	);

	const fetchArtifacts = useCallback(
		async (signal: AbortSignal, sessionId?: string | null) => {
			const params = new URLSearchParams({ limit: "12" });
			if (sessionId) params.set("sessionId", sessionId);
			const res = await fetch(`${baseUrl}/artifacts?${params.toString()}`, { signal });
			if (!res.ok || !isMountedRef.current) return;
			const data = (await res.json()) as { artifacts: ArtifactSummary[] };
			if (isMountedRef.current) setArtifacts(data.artifacts);
		},
		[baseUrl],
	);

	const fetchArtifactDetail = useCallback(
		async (artifactId: string, signal?: AbortSignal) => {
			const res = await fetch(`${baseUrl}/artifacts/${encodeURIComponent(artifactId)}`, { signal });
			if (!res.ok || !isMountedRef.current) return null;
			return (await res.json()) as ArtifactDetail;
		},
		[baseUrl],
	);

	const promoteArtifact = useCallback(
		async (artifactId: string, promoted = true) => {
			const res = await fetch(`${baseUrl}/artifacts/${encodeURIComponent(artifactId)}/promote`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ promoted }),
			});
			if (!res.ok) return false;
			setArtifacts((current) =>
				current.map((artifact) => (artifact.artifactId === artifactId ? { ...artifact, promoted } : artifact)),
			);
			return true;
		},
		[baseUrl],
	);

	const fetchRepoDiff = useCallback(
		async (signal: AbortSignal) => {
			const res = await fetch(`${baseUrl}/repo/diff`, { signal });
			if (!res.ok || !isMountedRef.current) return;
			const data = (await res.json()) as RepoDiffSnapshot;
			if (isMountedRef.current) setRepoDiff(data);
		},
		[baseUrl],
	);

	const fetchRuntimes = useCallback(
		async (signal: AbortSignal) => {
			const res = await fetch(`${baseUrl}/runtime/list`, { signal });
			if (!res.ok || !isMountedRef.current) return;
			const data = (await res.json()) as { runtimes: RuntimeSummary[] };
			if (isMountedRef.current) setRuntimes(data.runtimes);
		},
		[baseUrl],
	);

	const pollLoop = useCallback(async () => {
		const controller = new AbortController();
		abortRef.current = controller;
		let retries = 0;

		while (!controller.signal.aborted) {
			try {
				const agentsRes = await fetch(`${baseUrl}/agents`, { signal: controller.signal });
				if (!agentsRes.ok) throw new Error(`Agents endpoint: ${agentsRes.status}`);
				const { agents: pids } = (await agentsRes.json()) as { agents: number[] };
				if (!isMountedRef.current) return;
				setAgents(pids);
				setConnected(true);
				setError(null);
				retries = 0;
				await fetchSessions(controller.signal);
				await fetchFleet(controller.signal);
				await fetchAlerts(controller.signal);
				await fetchApprovals(controller.signal);
				await fetchRuntimes(controller.signal);
				await fetchRepoDiff(controller.signal);

				if (pids.length > 0) {
					await fetchState(pids[0], controller.signal);
					await fetchArtifacts(controller.signal, sessionIdRef.current);
				}

				// Inner long-poll loop
				let watchRetries = 0;
				while (!controller.signal.aborted) {
					const watchUrl = `${baseUrl}/watch?timeout_ms=${pollTimeoutMs}&fingerprint=${fingerprintRef.current}`;
					const watchRes = await fetch(watchUrl, { signal: controller.signal });
					if (!watchRes.ok) {
						if (watchRetries < MAX_RETRIES) {
							await new Promise((r) => setTimeout(r, INITIAL_BACKOFF_MS * 2 ** watchRetries));
							watchRetries++;
							continue;
						}
						break; // exit inner loop, retry from outer
					}
					watchRetries = 0;

					const { changes, fingerprint } = (await watchRes.json()) as {
						changes: boolean;
						fingerprint: number;
					};
					fingerprintRef.current = fingerprint;

					if (changes && pids.length > 0 && isMountedRef.current) {
						await fetchSessions(controller.signal);
						await fetchFleet(controller.signal);
						await fetchAlerts(controller.signal);
						await fetchApprovals(controller.signal);
						await fetchRuntimes(controller.signal);
						await fetchRepoDiff(controller.signal);
						await fetchState(pids[0], controller.signal);
						await fetchArtifacts(controller.signal, sessionIdRef.current);
						if (sessionDetailIdRef.current) {
							await loadSessionDetail(sessionDetailIdRef.current, controller.signal);
						}
					}
				}
			} catch (err) {
				if (err instanceof DOMException && err.name === "AbortError") return;
				if (!isMountedRef.current) return;

				if (retries < MAX_RETRIES) {
					const backoff = INITIAL_BACKOFF_MS * 2 ** retries;
					retries++;
					setConnected(false);
					setError(`Reconnecting (${retries}/${MAX_RETRIES})…`);
					await new Promise((r) => setTimeout(r, backoff));
					continue;
				}

				setConnected(false);
				setError(err instanceof Error ? err.message : String(err));
				return;
			}
		}
	}, [
		baseUrl,
		pollTimeoutMs,
		fetchAlerts,
		fetchApprovals,
		fetchArtifacts,
		fetchFleet,
		fetchRepoDiff,
		fetchRuntimes,
		fetchState,
		fetchSessions,
		loadSessionDetail,
	]);

	useEffect(() => {
		pollLoop();
		return () => {
			abortRef.current?.abort();
		};
	}, [pollLoop]);

	const sendMessage = useCallback(
		async (text: string) => {
			await fetch(`${baseUrl}/send`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text }),
			});
		},
		[baseUrl],
	);

	const attachSession = useCallback(
		async (sessionId: string) => {
			const res = await fetch(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/attach`, {
				method: "POST",
			});
			if (!res.ok) return false;
			await loadSessionDetail(sessionId);
			return true;
		},
		[baseUrl, loadSessionDetail],
	);

	const acknowledgeAlert = useCallback(
		async (alertId: string) => {
			const res = await fetch(`${baseUrl}/alerts/${encodeURIComponent(alertId)}/ack`, {
				method: "POST",
			});
			if (!res.ok) return false;
			setAlerts((current) => current.filter((alert) => alert.id !== alertId));
			return true;
		},
		[baseUrl],
	);

	const decideApproval = useCallback(
		async (approvalId: string, decision: "approve" | "deny") => {
			const res = await fetch(`${baseUrl}/approvals/${encodeURIComponent(approvalId)}/${decision}`, {
				method: "POST",
			});
			if (!res.ok) return false;
			setApprovals((current) => current.filter((approval) => approval.id !== approvalId));
			return true;
		},
		[baseUrl],
	);

	const interruptAgent = useCallback(
		async (pid: number) => {
			const res = await fetch(`${baseUrl}/agent/${pid}/interrupt`, { method: "POST" });
			return res.ok;
		},
		[baseUrl],
	);

	const refreshAgent = useCallback(
		async (pid: number) => {
			const res = await fetch(`${baseUrl}/agent/${pid}/refresh`, { method: "POST" });
			return res.ok;
		},
		[baseUrl],
	);

	const startRuntime = useCallback(
		async (options?: { sessionId?: string; provider?: string; model?: string }) => {
			const res = await fetch(`${baseUrl}/runtime/start`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(options ?? {}),
			});
			if (!res.ok) return null;
			const runtime = (await res.json()) as RuntimeSummary;
			setRuntimes((current) => [runtime, ...current.filter((item) => item.runtimeId !== runtime.runtimeId)]);
			return runtime;
		},
		[baseUrl],
	);

	const stopRuntime = useCallback(
		async (runtimeId: string) => {
			const res = await fetch(`${baseUrl}/runtime/${encodeURIComponent(runtimeId)}/stop`, { method: "POST" });
			if (!res.ok) return false;
			setRuntimes((current) => current.map((runtime) => (runtime.runtimeId === runtimeId ? { ...runtime, state: "stopped" } : runtime)));
			return true;
		},
		[baseUrl],
	);

	const respondExtensionPrompt = useCallback(
		async (response: { action: "confirm" | "cancel" } | { action: "pick"; index: number }) => {
			const res = await fetch(`${baseUrl}/extension-ui/respond`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(response),
			});
			if (!res.ok) return false;
			setState((current) => {
				if (!current?.extensionUi) return current;
				return {
					...current,
					extensionUi: {
						...current.extensionUi,
						prompt: null,
					},
				};
			});
			return true;
		},
		[baseUrl],
	);

	return {
		agents,
		alerts,
		approvals,
		artifacts,
		fetchArtifactDetail,
		attachSession,
		acknowledgeAlert,
		connected,
		decideApproval,
		error,
		fleet,
		interruptAgent,
		loadSessionDetail,
		promoteArtifact,
		repoDiff,
		refreshAgent,
		runtimes,
		sendMessage,
		sessionDetail,
		sessions,
		startRuntime,
		state,
		stopRuntime,
		respondExtensionPrompt,
	};
}
