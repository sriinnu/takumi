import { createLogger } from "@takumi/core";
import type {
	ChitraguptaHealth,
	ChitraguptaSessionInfo,
	MemoryResult,
	SessionDetail,
	UnifiedRecallResult,
} from "./chitragupta-types.js";
import type { DaemonSocketClient } from "./daemon-socket.js";

const _log = createLogger("chitragupta-queries");

type CallTool = (name: string, args: Record<string, unknown>) => Promise<any>;

export async function memorySearch(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	callTool: CallTool,
	parseResults: <T>(raw: any) => T | null,
	query: string,
	limit?: number,
	projectPath?: string,
): Promise<MemoryResult[]> {
	if (socketMode && socket) {
		const resp = await socket.call<{ results: Array<Record<string, unknown>> }>("memory.recall", {
			query,
			limit: limit ?? 5,
			project: projectPath,
		});
		return (resp.results ?? []).map((r, i) => ({
			content: String(r.content ?? ""),
			relevance: +(1 - i / Math.max(resp.results.length, 1)).toFixed(3),
			source: String(r.session_id ?? ""),
		}));
	}

	const params: Record<string, unknown> = { query };
	if (limit !== undefined) params.limit = limit;

	const raw = await callTool("chitragupta_memory_search", params);
	return parseResults<MemoryResult[]>(raw) ?? [];
}

export async function unifiedRecall(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	callTool: CallTool,
	parseResults: <T>(raw: any) => T | null,
	query: string,
	limit?: number,
	project?: string,
	projectPath?: string,
): Promise<UnifiedRecallResult[]> {
	if (socketMode && socket) {
		const resp = await socket.call<{ results: Array<Record<string, unknown>> }>("memory.unified_recall", {
			query,
			limit: limit ?? 5,
			project: project ?? projectPath,
		});
		return (resp.results ?? []).map((r) => ({
			content: String(r.content ?? ""),
			score: Number(r.score ?? 0),
			source: String(r.source ?? ""),
			type: String(r.type ?? "session"),
		}));
	}
	// MCP fallback: use legacy memory search
	const legacy = await memorySearch(socket, socketMode, callTool, parseResults, query, limit, projectPath);
	return legacy.map((r) => ({
		content: r.content,
		score: r.relevance,
		source: r.source ?? "",
		type: "session",
	}));
}

export async function sessionList(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	callTool: CallTool,
	parseResults: <T>(raw: any) => T | null,
	projectPath?: string,
	limit?: number,
): Promise<ChitraguptaSessionInfo[]> {
	if (socketMode && socket) {
		const resp = await socket.call<{ sessions: Array<Record<string, unknown>> }>("session.list", {
			project: projectPath,
		});
		const slice = limit ? (resp.sessions ?? []).slice(0, limit) : (resp.sessions ?? []);
		return slice.map((s) => {
			const m = (s.meta ?? s) as Record<string, unknown>;
			return {
				id: String(m.id ?? ""),
				title: String(m.title ?? "Untitled"),
				timestamp: Number(m.updatedAt ?? m.createdAt ?? 0),
				turns: Number(m.turnCount ?? 0),
			};
		});
	}

	const params: Record<string, unknown> = {};
	if (limit !== undefined) params.limit = limit;

	const raw = await callTool("chitragupta_session_list", params);
	return parseResults<ChitraguptaSessionInfo[]>(raw) ?? [];
}

export async function sessionShow(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	callTool: CallTool,
	parseResults: <T>(raw: any) => T | null,
	sessionId: string,
	projectPath?: string,
): Promise<SessionDetail> {
	if (socketMode && socket) {
		try {
			const resp = await socket.call<Record<string, unknown>>("session.show", {
				id: sessionId,
				project: projectPath ?? "",
			});
			const m = (resp.meta ?? resp) as Record<string, unknown>;
			const rawTurns = (resp.turns ?? []) as Array<Record<string, unknown>>;
			return {
				id: String(m.id ?? sessionId),
				title: String(m.title ?? "Untitled"),
				turns: rawTurns.map((t) => ({
					role: String(t.role ?? "user"),
					content: String(t.content ?? ""),
					timestamp: Number(t.timestamp ?? t.createdAt ?? 0),
				})),
			};
		} catch {
			return { id: sessionId, title: "", turns: [] };
		}
	}

	const raw = await callTool("chitragupta_session_show", { sessionId });
	return parseResults<SessionDetail>(raw) ?? { id: sessionId, title: "", turns: [] };
}

export async function healthStatus(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	callTool: CallTool,
	parseResults: <T>(raw: any) => T | null,
): Promise<ChitraguptaHealth | null> {
	if (socketMode && socket) {
		try {
			const resp = await socket.call<Record<string, unknown>>("daemon.health");
			const conns = Number(resp.connections ?? 0);
			const rajas = Math.min(0.8, conns / 5);
			const sattva = Number(resp.uptime ?? 0) > 3600 ? 0.75 : 0.55;
			const tamas = Math.max(0, 1 - sattva - rajas);
			return {
				state: { sattva, rajas, tamas },
				dominant: rajas > 0.4 ? "rajas" : "sattva",
				trend: { sattva: "stable", rajas: "stable", tamas: "stable" },
				alerts: [],
				history: [],
			};
		} catch {
			return null;
		}
	}
	const raw = await callTool("health_status", {});
	return parseResults<ChitraguptaHealth>(raw);
}
