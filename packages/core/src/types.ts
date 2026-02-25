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

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock | ImageBlock;

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

/**
 * Docker-specific options for cluster isolation.
 * Only used when `OrchestrationConfig.isolationMode` is `"docker"`.
 */
export interface DockerIsolationConfig {
	/** Docker image to run (e.g. `"node:22-alpine"`). */
	image: string;
	/** Short-name bind-mounts: `"git"`, `"ssh"`, `"gh"`, `"npm"`. */
	mounts: string[];
	/** Environment-variable glob patterns forwarded into the container (e.g. `"AWS_*"`). */
	envPassthrough: string[];
}

/**
 * Multi-agent orchestration settings.
 * Stored under the `"orchestration"` key in `takumi.config.json`.
 */
export interface OrchestrationConfig {
	/** Enable multi-agent orchestration (default: `true`). */
	enabled: boolean;
	/** Execution mode applied when complexity classifier has not overridden it. */
	defaultMode: "single" | "multi";
	/**
	 * Minimum complexity level that triggers multi-agent mode.
	 * Tasks below this threshold run with a single agent.
	 */
	complexityThreshold: "TRIVIAL" | "SIMPLE" | "STANDARD" | "CRITICAL";
	/** Maximum validation-retry attempts per cluster run. */
	maxValidationRetries: number;
	/** Sandbox mode applied to cluster worker execution. */
	isolationMode: "none" | "worktree" | "docker";
	/** Docker configuration — only used when `isolationMode = "docker"`. */
	docker?: DockerIsolationConfig;

	/**
	 * Ensemble execution: spawn K workers in parallel, select best via voting.
	 * Based on "Self-Consistency Improves Chain of Thought" (Wang et al., arXiv:2203.11171)
	 */
	ensemble?: {
		enabled: boolean;
		workerCount: number;
		temperature: number;
		parallel: boolean;
	};

	/**
	 * Weighted voting: aggregate validator decisions by confidence scores.
	 */
	weightedVoting?: {
		minConfidenceThreshold: number;
	};

	/**
	 * Reflexion: self-critique and learning from past failures.
	 * Based on "Reflexion: Language Agents with Verbal Reinforcement Learning"
	 * (Shinn et al., arXiv:2303.11366)
	 */
	reflexion?: {
		enabled: boolean;
		maxHistorySize: number;
		useAkasha: boolean;
	};

	/**
	 * Mixture-of-Agents: multi-round collaborative validation with cross-talk.
	 * Based on "Mixture-of-Agents Enhances LLM Capabilities"
	 * (Wang et al., arXiv:2406.04692)
	 */
	moA?: {
		enabled: boolean;
		rounds: number;
		validatorCount: number;
		allowCrossTalk: boolean;
		temperatures: number[];
	};

	/**
	 * Progressive refinement: iterative improvement via critic feedback.
	 * Inspired by AlphaCodium (arXiv:2401.08500) and Reflexion.
	 */
	progressiveRefinement?: {
		enabled: boolean;
		maxIterations: number;
		minImprovement: number;
		useCriticModel: boolean;
		targetScore: number;
	};

	/**
	 * Adaptive temperature sampling: dynamic temperature per task complexity/phase.
	 */
	adaptiveTemperature?: {
		enabled: boolean;
		baseTemperatures?: {
			TRIVIAL?: number;
			SIMPLE?: number;
			STANDARD?: number;
			CRITICAL?: number;
		};
	};
}

export interface StatusBarConfig {
	left?: string[];
	center?: string[];
	right?: string[];
}

export interface PluginConfig<TOptions = Record<string, unknown>> {
	name: string;
	options?: TOptions;
}

export interface ThemeConfig {
	name: string;
	colors: {
		primary: string;
		secondary: string;
		background: string;
		foreground: string;
		success: string;
		warning: string;
		error: string;
		muted: string;
	};
	/** Optional ANSI-256 token map used by the Kagami renderer. */
	ansi?: Record<string, number>;
}

export interface TakumiConfig {
	/** API key (provider-specific or generic) */
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

	/** Provider name: anthropic, openai, gemini, groq, ollama, openrouter, deepseek, mistral, together, custom */
	provider: string;

	/** Custom API endpoint (for openai-compat providers, ollama, etc.) */
	endpoint: string;

	/** Permission rules */
	permissions: PermissionRule[];

	/** Theme name or custom theme config */
	theme: string | ThemeConfig;

	/** Log level */
	logLevel: "debug" | "info" | "warn" | "error" | "silent";

	/** Maximum conversation turns before auto-compact */
	maxTurns: number;

	/** Enable experimental features */
	experimental: Record<string, boolean>;

	/** Multi-agent orchestration settings (optional; uses sensible defaults if absent). */
	orchestration?: OrchestrationConfig;

	/** Status bar configuration */
	statusBar?: StatusBarConfig;

	/** Plugins configuration */
	plugins?: PluginConfig[];
}
