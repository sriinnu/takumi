/**
 * ExtensionAPI interface — Phase 45
 *
 * The API surface passed to extension factory functions.
 * Split from extension-types.ts to stay under the 450-LOC guardrail.
 *
 * Phase 45 additions over Phase 42–44:
 * - message_start / message_end          — LLM message boundary events
 * - tool_execution_start/update/end      — streaming tool lifecycle
 * - before_provider_request              — intercept raw LLM HTTP payload
 * - user_bash                            — intercept !cmd shell prefix
 * - tool_call:bash, :read, :edit ...     — filtered, auto-narrowed subscriptions
 * - sho.bridge                            — typed inter-extension event bus
 * - sho.getSessionName() / setSessionName() — session label access
 */

import type {
	AgentBusMessageEvent,
	AgentCompleteEvent,
	AgentProfileUpdatedEvent,
	AgentSpawnEvent,
	ClusterBudgetEvent,
	ClusterEndEvent,
	ClusterPhaseChangeEvent,
	ClusterStartEvent,
	ClusterTopologyAdaptEvent,
	ClusterValidationAttemptEvent,
	SabhaEscalationEvent,
} from "./cluster-events.js";
import type { ExtensionBridge } from "./extension-bridge.js";
import type {
	BashToolCallEvent,
	BeforeProviderRequestEvent,
	BeforeProviderRequestResult,
	EditToolCallEvent,
	GlobToolCallEvent,
	GrepToolCallEvent,
	MessageEndEvent,
	MessageStartEvent,
	ReadToolCallEvent,
	ToolExecutionEndEvent,
	ToolExecutionStartEvent,
	ToolExecutionUpdateEvent,
	UserBashEvent,
	UserBashResult,
	WriteToolCallEvent,
} from "./extension-tool-events.js";
import type {
	AgentEndEvent,
	AgentStartEvent,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ContextEvent,
	ContextEventResult,
	ExtensionContext,
	ExtensionHandler,
	ExtensionToolDefinition,
	InputEvent,
	InputEventResult,
	MessageUpdateEvent,
	ModelSelectEvent,
	RegisteredCommand,
	SessionBeforeCompactEvent,
	SessionBeforeCompactResult,
	SessionBeforeSwitchEvent,
	SessionBeforeSwitchResult,
	SessionCompactEvent,
	SessionShutdownEvent,
	SessionStartEvent,
	SessionSwitchEvent,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
	TurnEndEvent,
	TurnStartEvent,
} from "./extension-types.js";

/**
 * API passed to extension factory functions.
 * Provides event subscription, tool/command/shortcut registration, and actions.
 */
export interface ExtensionAPI {
	// ── Session Events ─────────────────────────────────────────────────────────

	on(event: "session_start", handler: ExtensionHandler<SessionStartEvent>): void;
	on(
		event: "session_before_switch",
		handler: ExtensionHandler<SessionBeforeSwitchEvent, SessionBeforeSwitchResult>,
	): void;
	on(event: "session_switch", handler: ExtensionHandler<SessionSwitchEvent>): void;
	on(
		event: "session_before_compact",
		handler: ExtensionHandler<SessionBeforeCompactEvent, SessionBeforeCompactResult>,
	): void;
	on(event: "session_compact", handler: ExtensionHandler<SessionCompactEvent>): void;
	on(event: "session_shutdown", handler: ExtensionHandler<SessionShutdownEvent>): void;

	// ── Agent Loop Events ──────────────────────────────────────────────────────

	on(event: "context", handler: ExtensionHandler<ContextEvent, ContextEventResult>): void;
	on(event: "before_agent_start", handler: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>): void;
	on(event: "agent_start", handler: ExtensionHandler<AgentStartEvent>): void;
	on(event: "agent_end", handler: ExtensionHandler<AgentEndEvent>): void;
	on(event: "turn_start", handler: ExtensionHandler<TurnStartEvent>): void;
	on(event: "turn_end", handler: ExtensionHandler<TurnEndEvent>): void;
	on(event: "message_update", handler: ExtensionHandler<MessageUpdateEvent>): void;

	/** Fired when the LLM assistant begins streaming a new message. */
	on(event: "message_start", handler: ExtensionHandler<MessageStartEvent>): void;
	/** Fired when the LLM assistant finishes streaming a message. */
	on(event: "message_end", handler: ExtensionHandler<MessageEndEvent>): void;

	// ── Tool Events ────────────────────────────────────────────────────────────

	on(event: "tool_call", handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult>): void;
	on(event: "tool_result", handler: ExtensionHandler<ToolResultEvent, ToolResultEventResult>): void;

	/**
	 * Filtered tool subscriptions — event type is auto-narrowed to the
	 * per-tool shape, no type guard needed.
	 *
	 * @example
	 *   sho.on("tool_call:bash", (event, ctx) => {
	 *     if (event.args.command.includes("rm -rf")) {
	 *       return { block: true, reason: "Destructive command" };
	 *     }
	 *   });
	 */
	on(event: "tool_call:bash", handler: ExtensionHandler<BashToolCallEvent, ToolCallEventResult>): void;
	on(event: "tool_call:read", handler: ExtensionHandler<ReadToolCallEvent, ToolCallEventResult>): void;
	on(event: "tool_call:edit", handler: ExtensionHandler<EditToolCallEvent, ToolCallEventResult>): void;
	on(event: "tool_call:write", handler: ExtensionHandler<WriteToolCallEvent, ToolCallEventResult>): void;
	on(event: "tool_call:glob", handler: ExtensionHandler<GlobToolCallEvent, ToolCallEventResult>): void;
	on(event: "tool_call:grep", handler: ExtensionHandler<GrepToolCallEvent, ToolCallEventResult>): void;
	/**
	 * Catch-all filtered subscription for any custom tool:
	 *   `sho.on("tool_call:my-custom-tool", handler)`
	 */
	on(event: `tool_call:${string}`, handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult>): void;

	/** Fired when a tool begins executing (after tool_call approval). */
	on(event: "tool_execution_start", handler: ExtensionHandler<ToolExecutionStartEvent>): void;
	/** Fired for each streaming chunk from a running tool. */
	on(event: "tool_execution_update", handler: ExtensionHandler<ToolExecutionUpdateEvent>): void;
	/** Fired when a tool completes, immediately before tool_result. */
	on(event: "tool_execution_end", handler: ExtensionHandler<ToolExecutionEndEvent>): void;

	// ── Provider / Input Events ────────────────────────────────────────────────

	/**
	 * Fired before the raw HTTP request is sent to the LLM provider.
	 * Handlers may replace the payload to inject params or modify messages.
	 */
	on(
		event: "before_provider_request",
		handler: ExtensionHandler<BeforeProviderRequestEvent, BeforeProviderRequestResult>,
	): void;

	/**
	 * Fired when the user types `!command` (shell prefix) in the prompt.
	 * Return `{ handled: true, output: "..." }` to override the real execution.
	 */
	on(event: "user_bash", handler: ExtensionHandler<UserBashEvent, UserBashResult>): void;

	on(event: "model_select", handler: ExtensionHandler<ModelSelectEvent>): void;
	on(event: "input", handler: ExtensionHandler<InputEvent, InputEventResult>): void;

	// ── Cluster Events ─────────────────────────────────────────────────────────

	on(event: "cluster_start", handler: ExtensionHandler<ClusterStartEvent>): void;
	on(event: "cluster_end", handler: ExtensionHandler<ClusterEndEvent>): void;
	on(event: "cluster_phase_change", handler: ExtensionHandler<ClusterPhaseChangeEvent>): void;
	on(event: "cluster_topology_adapt", handler: ExtensionHandler<ClusterTopologyAdaptEvent>): void;
	on(event: "cluster_validation_attempt", handler: ExtensionHandler<ClusterValidationAttemptEvent>): void;
	on(event: "cluster_budget", handler: ExtensionHandler<ClusterBudgetEvent>): void;
	on(event: "agent_spawn", handler: ExtensionHandler<AgentSpawnEvent>): void;
	on(event: "agent_message", handler: ExtensionHandler<AgentBusMessageEvent>): void;
	on(event: "agent_complete", handler: ExtensionHandler<AgentCompleteEvent>): void;
	on(event: "agent_profile_updated", handler: ExtensionHandler<AgentProfileUpdatedEvent>): void;
	on(event: "sabha_escalation", handler: ExtensionHandler<SabhaEscalationEvent>): void;

	// ── Registration ───────────────────────────────────────────────────────────

	/** Register a tool the LLM can call. */
	registerTool(tool: ExtensionToolDefinition): void;

	/** Register a slash command (e.g., `/my-command`). */
	registerCommand(name: string, options: Omit<RegisteredCommand, "name">): void;

	/** Register a keyboard shortcut. */
	registerShortcut(
		key: string,
		options: { description?: string; handler: (ctx: ExtensionContext) => Promise<void> | void },
	): void;

	// ── Actions ────────────────────────────────────────────────────────────────

	/** Send a user message to the agent, triggering a new turn. */
	sendUserMessage(content: string): void;

	/** Get the list of currently active tool names. */
	getActiveTools(): string[];

	/** Set the active tool set by name. */
	setActiveTools(toolNames: string[]): void;

	/** Execute a shell command and await its output. */
	exec(command: string, args?: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;

	/** Get the current human-readable session label (or undefined if unset). */
	getSessionName(): string | undefined;

	/**
	 * Set the human-readable session label.
	 * Convention: only set when unset or when overriding a prior auto-generated value.
	 */
	setSessionName(name: string): void;

	// ── Bridge ─────────────────────────────────────────────────────────────────

	/**
	 * Typed inter-extension event bus. Shared across all loaded extensions.
	 * Declare your events by augmenting `ExtensionBridgeEvents`.
	 *
	 * @example
	 *   // Announce a metric update:
	 *   sho.bridge.publish("tps-meter:update", { tps: 15.3, elapsed: 2.0 });
	 *
	 *   // Listen for updates from another extension:
	 *   sho.bridge.subscribe("tps-meter:update", ({ tps }) => { ... });
	 */
	bridge: ExtensionBridge;
}
