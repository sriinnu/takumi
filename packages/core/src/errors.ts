/**
 * Base error class for all Takumi errors.
 * Provides structured error codes and optional cause chaining.
 */
export class TakumiError extends Error {
	readonly code: string;

	constructor(message: string, code = "TAKUMI_ERROR", cause?: Error) {
		super(message);
		this.name = "TakumiError";
		this.code = code;
		if (cause) this.cause = cause;
		// Fix prototype chain for instanceof checks
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

/** Configuration-related errors (missing keys, invalid values, parse failures). */
export class ConfigError extends TakumiError {
	constructor(message: string, cause?: Error) {
		super(message, "CONFIG_ERROR", cause);
		this.name = "ConfigError";
	}
}

/** Rendering and display errors (buffer overflow, invalid sequences, Yoga failures). */
export class RenderError extends TakumiError {
	constructor(message: string, cause?: Error) {
		super(message, "RENDER_ERROR", cause);
		this.name = "RenderError";
	}
}

/** Agent loop errors (stream failures, malformed responses, turn budget exceeded). */
export class AgentError extends TakumiError {
	readonly retryable: boolean;

	constructor(message: string, retryable = false, cause?: Error) {
		super(message, "AGENT_ERROR", cause);
		this.name = "AgentError";
		this.retryable = retryable;
	}
}

/** Tool execution errors (file not found, command failed, timeout). */
export class ToolError extends TakumiError {
	readonly toolName: string;

	constructor(toolName: string, message: string, cause?: Error) {
		super(`[${toolName}] ${message}`, "TOOL_ERROR", cause);
		this.name = "ToolError";
		this.toolName = toolName;
	}
}

/** Permission errors (denied tool use, sandbox violation). */
export class PermissionError extends TakumiError {
	readonly tool: string;
	readonly action: string;

	constructor(tool: string, action: string, message?: string) {
		super(message ?? `Permission denied: ${tool} cannot ${action}`, "PERMISSION_ERROR");
		this.name = "PermissionError";
		this.tool = tool;
		this.action = action;
	}
}
