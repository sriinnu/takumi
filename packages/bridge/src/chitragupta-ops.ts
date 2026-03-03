/**
 * Phase 15 & 16 operations for ChitraguptaBridge (extracted to meet LOC limit).
 * These methods are dynamically added to ChitraguptaBridge via decorator pattern.
 */

import type {
	ChitraguptaProjectInfo,
	ChitraguptaSessionInfo,
	ConsolidationResult,
	DaemonStatus,
	ExtractedFact,
	MaxTurnResult,
	MemoryScope,
	SessionCreateOptions,
	SessionCreateResult,
	SessionMetaUpdates,
	Turn,
	TurnAddResult,
	VidhiInfo,
	VidhiMatch,
} from "./chitragupta-types.js";
import type { DaemonSocketClient } from "./daemon-socket.js";
import type { McpClient } from "./mcp-client.js";

interface ToolCallResult {
	content?: Array<{ type: string; text?: string }>;
}

type CallToolFn = (name: string, args: Record<string, unknown>) => Promise<ToolCallResult>;

/** List learned procedures (vidhis) for a project. */
export async function vidhiList(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	callTool: CallToolFn,
	project: string,
	limit = 20,
): Promise<VidhiInfo[]> {
	if (socketMode && socket) {
		const result = await socket.call<{ vidhis: VidhiInfo[] }>("vidhi.list", { project, limit });
		return result.vidhis;
	}
	const result = await callTool("vidhi_list", { project, limit });
	const content = result.content?.[0]?.text;
	if (!content) throw new Error("No vidhis returned");
	return JSON.parse(content).vidhis as VidhiInfo[];
}

/** Match a learned procedure (vidhi) against a query. */
export async function vidhiMatch(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	callTool: CallToolFn,
	project: string,
	query: string,
): Promise<VidhiMatch | null> {
	if (socketMode && socket) {
		const result = await socket.call<{ match: VidhiMatch | null }>("vidhi.match", { project, query });
		return result.match;
	}
	const result = await callTool("vidhi_match", { project, query });
	const content = result.content?.[0]?.text;
	return content ? (JSON.parse(content).match as VidhiMatch | null) : null;
}

/** Run memory consolidation for a project. */
export async function consolidationRun(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	callTool: CallToolFn,
	project: string,
	sessionCount = 20,
): Promise<ConsolidationResult> {
	if (socketMode && socket) {
		return await socket.call<ConsolidationResult>("consolidation.run", { project, sessionCount });
	}
	const result = await callTool("consolidation_run", { project, session_count: sessionCount });
	const content = result.content?.[0]?.text;
	if (!content) throw new Error("Consolidation failed");
	return JSON.parse(content) as ConsolidationResult;
}

/** Extract structured facts from text. */
export async function factExtract(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	callTool: CallToolFn,
	text: string,
	projectPath?: string,
): Promise<ExtractedFact[]> {
	if (socketMode && socket) {
		const result = await socket.call<{ facts: ExtractedFact[] }>("fact.extract", { text, projectPath });
		return result.facts;
	}
	const result = await callTool("fact_extract", { text, project_path: projectPath });
	const content = result.content?.[0]?.text;
	if (!content) throw new Error("Fact extraction failed");
	return JSON.parse(content).facts as ExtractedFact[];
}

/** Create a new session. */
export async function sessionCreate(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	mcpClient: McpClient,
	options: SessionCreateOptions,
): Promise<SessionCreateResult> {
	if (socketMode && socket) {
		const result = await socket.call<SessionCreateResult>("session.create", {
			project: options.project,
			title: options.title,
			agent: options.agent,
			model: options.model,
			provider: options.provider,
			branch: options.branch,
		});
		return result;
	}

	// MCP fallback
	const result = await mcpClient.call<ToolCallResult>("tools/call", {
		name: "session_create",
		arguments: {
			project: options.project,
			title: options.title,
			agent: options.agent,
			model: options.model,
			provider: options.provider,
			branch: options.branch,
		},
	});
	const content = result.content?.[0]?.text;
	if (!content) throw new Error("Session creation failed");
	return JSON.parse(content) as SessionCreateResult;
}

/** Update session metadata. */
export async function sessionMetaUpdate(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	mcpClient: McpClient,
	sessionId: string,
	updates: SessionMetaUpdates,
): Promise<{ updated: boolean }> {
	if (socketMode && socket) {
		const result = await socket.call<{ updated: boolean }>("session.meta.update", {
			id: sessionId,
			updates,
		});
		return result;
	}

	// MCP fallback
	const result = await mcpClient.call<ToolCallResult>("tools/call", {
		name: "session_meta_update",
		arguments: { id: sessionId, updates },
	});
	const content = result.content?.[0]?.text;
	if (!content) throw new Error("Session metadata update failed");
	return JSON.parse(content) as { updated: boolean };
}

/** Add a turn to a session. */
export async function turnAdd(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	mcpClient: McpClient,
	sessionId: string,
	project: string,
	turn: Turn,
): Promise<TurnAddResult> {
	if (socketMode && socket) {
		const result = await socket.call<TurnAddResult>("turn.add", {
			sessionId,
			project,
			turn,
		});
		return result;
	}

	// MCP fallback
	const result = await mcpClient.call<ToolCallResult>("tools/call", {
		name: "turn_add",
		arguments: { session_id: sessionId, project, turn },
	});
	const content = result.content?.[0]?.text;
	if (!content) throw new Error("Turn add failed");
	return JSON.parse(content) as TurnAddResult;
}

/** Get the maximum turn number for a session. */
export async function turnMaxNumber(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	mcpClient: McpClient,
	sessionId: string,
): Promise<number> {
	if (socketMode && socket) {
		const result = await socket.call<MaxTurnResult>("turn.max_number", { sessionId });
		return result.maxTurn;
	}

	// MCP fallback
	const result = await mcpClient.call<ToolCallResult>("tools/call", {
		name: "turn_max_number",
		arguments: { session_id: sessionId },
	});
	const content = result.content?.[0]?.text;
	if (!content) throw new Error("Turn max number query failed");
	return JSON.parse(content).maxTurn as number;
}

/** List available day consolidation files. */
export async function dayList(socket: DaemonSocketClient | null, socketMode: boolean): Promise<string[]> {
	if (socketMode && socket) {
		const resp = await socket.call<{ dates: string[] }>("day.list", {});
		return resp.dates ?? [];
	}
	// MCP fallback: no day files available
	return [];
}

/** Display content of a specific day file. */
export async function dayShow(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	date: string,
): Promise<{ date: string; content: string | null }> {
	if (socketMode && socket) {
		const resp = await socket.call<{ date: string; content: string | null }>("day.show", { date });
		return { date: resp.date ?? date, content: resp.content ?? null };
	}
	// MCP fallback: no day files available
	return { date, content: null };
}

/** Search across day consolidation files. */
export async function daySearch(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	query: string,
	limit?: number,
): Promise<Array<{ date: string; content: string; score: number }>> {
	if (socketMode && socket) {
		const resp = await socket.call<{ results: Array<Record<string, unknown>> }>("day.search", {
			query,
			limit: limit ?? 10,
		});
		return (resp.results ?? []).map((r) => ({
			date: String(r.date ?? ""),
			content: String(r.content ?? ""),
			score: Number(r.score ?? 0),
		}));
	}
	// MCP fallback: no day files available
	return [];
}

/** Load and assemble provider context for a project. */
export async function contextLoad(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	project: string,
): Promise<{ assembled: string; itemCount: number }> {
	if (socketMode && socket) {
		const resp = await socket.call<{ assembled: string; itemCount: number }>("context.load", { project });
		return { assembled: resp.assembled ?? "", itemCount: resp.itemCount ?? 0 };
	}
	// MCP fallback: no context loading available
	return { assembled: "", itemCount: 0 };
}

/** List all dates that have sessions. */
export async function sessionDates(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	callTool: CallToolFn,
	project?: string,
): Promise<string[]> {
	if (socketMode && socket) {
		const result = await socket.call<{ dates: string[] }>("session.dates", { project });
		return result.dates;
	}
	const result = await callTool("session_dates", project ? { project } : {});
	const content = result.content?.[0]?.text;
	if (!content) return [];
	return JSON.parse(content).dates as string[];
}

/** List all projects that have sessions. */
export async function sessionProjects(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	callTool: CallToolFn,
): Promise<ChitraguptaProjectInfo[]> {
	if (socketMode && socket) {
		const result = await socket.call<{ projects: ChitraguptaProjectInfo[] }>("session.projects", {});
		return result.projects;
	}
	const result = await callTool("session_projects", {});
	const content = result.content?.[0]?.text;
	if (!content) return [];
	return JSON.parse(content).projects as ChitraguptaProjectInfo[];
}

/** Query sessions modified since a timestamp. */
export async function sessionModifiedSince(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	callTool: CallToolFn,
	timestamp: number,
	project?: string,
): Promise<ChitraguptaSessionInfo[]> {
	if (socketMode && socket) {
		const result = await socket.call<{ sessions: ChitraguptaSessionInfo[] }>("session.modified_since", {
			timestamp,
			project,
		});
		return result.sessions;
	}
	const result = await callTool("session_modified_since", { timestamp, project });
	const content = result.content?.[0]?.text;
	if (!content) return [];
	return JSON.parse(content).sessions as ChitraguptaSessionInfo[];
}

/** Delete a session by ID. */
export async function sessionDelete(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	callTool: CallToolFn,
	sessionId: string,
): Promise<{ deleted: boolean }> {
	if (socketMode && socket) {
		const result = await socket.call<{ deleted: boolean }>("session.delete", { id: sessionId });
		return result;
	}
	const result = await callTool("session_delete", { id: sessionId });
	const content = result.content?.[0]?.text;
	if (!content) return { deleted: false };
	return JSON.parse(content) as { deleted: boolean };
}

/** List all turns in a session. */
export async function turnList(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	callTool: CallToolFn,
	sessionId: string,
): Promise<Turn[]> {
	if (socketMode && socket) {
		const result = await socket.call<{ turns: Turn[] }>("turn.list", { session_id: sessionId });
		return result.turns;
	}
	const result = await callTool("turn_list", { session_id: sessionId });
	const content = result.content?.[0]?.text;
	if (!content) return [];
	return JSON.parse(content).turns as Turn[];
}

/** Query turns created since a timestamp. */
export async function turnSince(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	callTool: CallToolFn,
	timestamp: number,
	sessionId?: string,
): Promise<Turn[]> {
	if (socketMode && socket) {
		const result = await socket.call<{ turns: Turn[] }>("turn.since", { timestamp, sessionId });
		return result.turns;
	}
	const result = await callTool("turn_since", { timestamp, session_id: sessionId });
	const content = result.content?.[0]?.text;
	if (!content) return [];
	return JSON.parse(content).turns as Turn[];
}

/** List available memory scopes (Phase 18). */
export async function memoryScopes(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	callTool: CallToolFn,
): Promise<MemoryScope[]> {
	if (socketMode && socket) {
		const result = await socket.call<{ scopes: MemoryScope[] }>("memory.scopes", {});
		return result.scopes;
	}
	const result = await callTool("memory_scopes", {});
	const content = result.content?.[0]?.text;
	if (!content) return [];
	return JSON.parse(content).scopes as MemoryScope[];
}

/** Get detailed daemon status and health metrics (Phase 18). */
export async function daemonStatus(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	callTool: CallToolFn,
): Promise<DaemonStatus | null> {
	if (socketMode && socket) {
		const result = await socket.call<DaemonStatus>("daemon.status", {});
		return result;
	}
	const result = await callTool("daemon_status", {});
	const content = result.content?.[0]?.text;
	if (!content) return null;
	return JSON.parse(content) as DaemonStatus;
}
