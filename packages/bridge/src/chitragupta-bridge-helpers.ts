import type { HandoverSummary } from "./chitragupta-types.js";

/** I describe the raw MCP tool-call envelope the bridge reads back. */
export interface ToolCallResult {
	content?: Array<{ type: string; text?: string }>;
}

/** I mirror the daemon-native handover payload before Takumi reshapes it. */
export interface DaemonHandoverSummary {
	sessionId: string;
	project: string;
	title: string;
	turnCount: number;
	cursor: number;
	filesModified: string[];
	filesRead: string[];
	decisions: string[];
	errors: string[];
	commands: string[];
	recentContext: Array<{ turn: number; preview: string }>;
}

/** I build one stable empty handover payload across daemon and MCP transports. */
export function buildEmptyHandoverSummary(): HandoverSummary {
	return {
		originalRequest: "",
		filesModified: [],
		filesRead: [],
		decisions: [],
		errors: [],
		recentContext: "",
	};
}

/** I map the daemon-native handover summary onto Takumi's legacy summary shape. */
export function mapDaemonHandoverSummary(summary: DaemonHandoverSummary): HandoverSummary {
	const recentContext = summary.recentContext.map((entry) => `#${entry.turn}: ${entry.preview}`).join("\n");
	return {
		originalRequest: summary.title,
		filesModified: summary.filesModified,
		filesRead: summary.filesRead,
		decisions: summary.decisions,
		errors: summary.errors,
		recentContext,
		sessionId: summary.sessionId,
		project: summary.project,
		title: summary.title,
		turnCount: summary.turnCount,
		cursor: summary.cursor,
		commands: summary.commands,
		recentContextItems: summary.recentContext,
	};
}
