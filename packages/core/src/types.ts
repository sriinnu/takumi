// ── Terminal cell ──────────────────────────────────────────────────────────────

export interface Cell {
	char: string;
	fg: number;
	bg: number;
	bold: boolean;
	dim: boolean;
	italic: boolean;
	underline: boolean;
	strikethrough: boolean;
}

// ── Geometry ──────────────────────────────────────────────────────────────────

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Size {
	width: number;
	height: number;
}

export interface Position {
	x: number;
	y: number;
}

// ── Input events ──────────────────────────────────────────────────────────────

export interface KeyEvent {
	key: string;
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
	meta: boolean;
	raw: string;
}

export interface MouseEvent {
	type: "mousedown" | "mouseup" | "mousemove" | "wheel";
	x: number;
	y: number;
	button: number; // 0=left, 1=middle, 2=right
	shift: boolean;
	alt: boolean;
	ctrl: boolean;
	/** Wheel direction: 1=up, -1=down (only for wheel events) */
	wheelDelta: number;
}

// ── Agent events ──────────────────────────────────────────────────────────────

export type AgentEvent =
	| AgentTextDelta
	| AgentTextDone
	| AgentThinkingDelta
	| AgentThinkingDone
	| AgentToolUse
	| AgentToolResult
	| AgentError
	| AgentDone
	| AgentUsageUpdate
	| AgentStop;

export interface AgentTextDelta {
	type: "text_delta";
	text: string;
}

export interface AgentTextDone {
	type: "text_done";
	text: string;
}

export interface AgentThinkingDelta {
	type: "thinking_delta";
	text: string;
}

export interface AgentThinkingDone {
	type: "thinking_done";
	text: string;
}

export interface AgentToolUse {
	type: "tool_use";
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface AgentToolResult {
	type: "tool_result";
	id: string;
	name: string;
	output: string;
	isError: boolean;
}

export interface AgentError {
	type: "error";
	error: Error;
}

export interface AgentDone {
	type: "done";
	stopReason: "end_turn" | "max_tokens" | "tool_use" | "stop_sequence";
}

export interface AgentUsageUpdate {
	type: "usage_update";
	usage: Usage;
}

export interface AgentStop {
	type: "stop";
	reason: "user_cancel" | "error" | "max_turns";
}

// ── Tools ─────────────────────────────────────────────────────────────────────

export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	requiresPermission: boolean;
	category: "read" | "write" | "execute" | "search" | "interact";
}

export interface ToolResult {
	output: string;
	isError: boolean;
	metadata?: Record<string, unknown>;
}

export interface ToolContext {
	workingDirectory: string;
	projectRoot: string;
	abortSignal: AbortSignal;
	permissions: PermissionEngine;
}

// ── Permissions ───────────────────────────────────────────────────────────────

export interface PermissionRule {
	tool: string;
	pattern: string;
	allow: boolean;
	scope: "session" | "project" | "global";
}

export interface PermissionEngine {
	check(tool: string, args: Record<string, unknown>): Promise<PermissionDecision>;
	grant(rule: PermissionRule): void;
	deny(rule: PermissionRule): void;
	reset(): void;
}

export interface PermissionDecision {
	allowed: boolean;
	reason?: string;
	rule?: PermissionRule;
}

// ── Messages ──────────────────────────────────────────────────────────────────

export interface Message {
	id: string;
	role: "user" | "assistant";
	content: ContentBlock[];
	timestamp: number;
	usage?: Usage;
}

export type ContentBlock =
	| TextBlock
	| ThinkingBlock
	| ToolUseBlock
	| ToolResultBlock
	| ImageBlock;

export interface TextBlock {
	type: "text";
	text: string;
}

export interface ThinkingBlock {
	type: "thinking";
	thinking: string;
}

export interface ToolUseBlock {
	type: "tool_use";
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface ToolResultBlock {
	type: "tool_result";
	toolUseId: string;
	content: string;
	isError: boolean;
}

export interface ImageBlock {
	type: "image";
	mediaType: string;
	data: string;
}

// ── Usage ─────────────────────────────────────────────────────────────────────

export interface Usage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

// ── Session ───────────────────────────────────────────────────────────────────

export interface SessionInfo {
	id: string;
	projectPath: string;
	model: string;
	startedAt: number;
	lastActiveAt: number;
	turnCount: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCost: number;
}

// ── Configuration ─────────────────────────────────────────────────────────────

export interface TakumiConfig {
	/** Anthropic API key */
	apiKey: string;

	/** Model to use */
	model: string;

	/** Maximum tokens per response */
	maxTokens: number;

	/** Enable extended thinking */
	thinking: boolean;

	/** Thinking budget tokens */
	thinkingBudget: number;

	/** Custom system prompt prepended to default */
	systemPrompt: string;

	/** Working directory (defaults to cwd) */
	workingDirectory: string;

	/** Darpana proxy URL (if using proxy) */
	proxyUrl: string;

	/** Permission rules */
	permissions: PermissionRule[];

	/** Theme name */
	theme: string;

	/** Log level */
	logLevel: "debug" | "info" | "warn" | "error" | "silent";

	/** Maximum conversation turns before auto-compact */
	maxTurns: number;

	/** Enable experimental features */
	experimental: Record<string, boolean>;
}
