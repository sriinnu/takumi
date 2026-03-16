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
	anomaly?: {
		severity: string;
		details: string;
		suggestion: string | null;
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
	const [connected, setConnected] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const fingerprintRef = useRef(0);
	const abortRef = useRef<AbortController | null>(null);
	const isMountedRef = useRef(true);

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
			if (isMountedRef.current) setState(data);
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
			if (isMountedRef.current) setSessionDetail(data);
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

				if (pids.length > 0) {
					await fetchState(pids[0], controller.signal);
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
						await fetchState(pids[0], controller.signal);
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
	}, [baseUrl, pollTimeoutMs, fetchAlerts, fetchFleet, fetchState, fetchSessions]);

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

	return {
		agents,
		alerts,
		attachSession,
		acknowledgeAlert,
		connected,
		error,
		fleet,
		loadSessionDetail,
		sendMessage,
		sessionDetail,
		sessions,
		state,
	};
}
