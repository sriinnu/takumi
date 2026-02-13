import { describe, it, expect } from "vitest";
import {
	TakumiError,
	ConfigError,
	RenderError,
	AgentErrorClass as AgentError,
	ToolError,
	PermissionError,
} from "@takumi/core";

// ── TakumiError ──────────────────────────────────────────────────────────────

describe("TakumiError", () => {
	it("stores message and default code", () => {
		const err = new TakumiError("something broke");
		expect(err.message).toBe("something broke");
		expect(err.code).toBe("TAKUMI_ERROR");
	});

	it("sets name to TakumiError", () => {
		const err = new TakumiError("test");
		expect(err.name).toBe("TakumiError");
	});

	it("accepts a custom error code", () => {
		const err = new TakumiError("custom", "CUSTOM_CODE");
		expect(err.code).toBe("CUSTOM_CODE");
	});

	it("supports cause chaining", () => {
		const cause = new Error("root cause");
		const err = new TakumiError("wrapper", "TAKUMI_ERROR", cause);
		expect(err.cause).toBe(cause);
	});

	it("has no cause when none is provided", () => {
		const err = new TakumiError("no cause");
		expect(err.cause).toBeUndefined();
	});

	it("is instanceof Error", () => {
		const err = new TakumiError("test");
		expect(err).toBeInstanceOf(Error);
	});

	it("is instanceof TakumiError", () => {
		const err = new TakumiError("test");
		expect(err).toBeInstanceOf(TakumiError);
	});

	it("has a stack trace", () => {
		const err = new TakumiError("test");
		expect(err.stack).toBeDefined();
		expect(err.stack).toContain("TakumiError");
	});
});

// ── ConfigError ──────────────────────────────────────────────────────────────

describe("ConfigError", () => {
	it("sets code to CONFIG_ERROR", () => {
		const err = new ConfigError("bad config");
		expect(err.code).toBe("CONFIG_ERROR");
	});

	it("sets name to ConfigError", () => {
		const err = new ConfigError("bad config");
		expect(err.name).toBe("ConfigError");
	});

	it("stores the message", () => {
		const err = new ConfigError("missing key");
		expect(err.message).toBe("missing key");
	});

	it("inherits from TakumiError", () => {
		const err = new ConfigError("test");
		expect(err).toBeInstanceOf(TakumiError);
	});

	it("inherits from Error", () => {
		const err = new ConfigError("test");
		expect(err).toBeInstanceOf(Error);
	});

	it("supports cause chaining", () => {
		const cause = new Error("parse failure");
		const err = new ConfigError("invalid JSON", cause);
		expect(err.cause).toBe(cause);
	});
});

// ── RenderError ──────────────────────────────────────────────────────────────

describe("RenderError", () => {
	it("sets code to RENDER_ERROR", () => {
		const err = new RenderError("buffer overflow");
		expect(err.code).toBe("RENDER_ERROR");
	});

	it("sets name to RenderError", () => {
		const err = new RenderError("test");
		expect(err.name).toBe("RenderError");
	});

	it("inherits from TakumiError", () => {
		const err = new RenderError("test");
		expect(err).toBeInstanceOf(TakumiError);
	});

	it("inherits from Error", () => {
		const err = new RenderError("test");
		expect(err).toBeInstanceOf(Error);
	});

	it("supports cause chaining", () => {
		const cause = new Error("yoga layout fail");
		const err = new RenderError("layout broke", cause);
		expect(err.cause).toBe(cause);
	});
});

// ── AgentError ───────────────────────────────────────────────────────────────

describe("AgentError", () => {
	it("sets code to AGENT_ERROR", () => {
		const err = new AgentError("stream failure");
		expect(err.code).toBe("AGENT_ERROR");
	});

	it("sets name to AgentError", () => {
		const err = new AgentError("test");
		expect(err.name).toBe("AgentError");
	});

	it("defaults retryable to false", () => {
		const err = new AgentError("non-retryable");
		expect(err.retryable).toBe(false);
	});

	it("accepts retryable = true", () => {
		const err = new AgentError("transient", true);
		expect(err.retryable).toBe(true);
	});

	it("inherits from TakumiError", () => {
		const err = new AgentError("test");
		expect(err).toBeInstanceOf(TakumiError);
	});

	it("inherits from Error", () => {
		const err = new AgentError("test");
		expect(err).toBeInstanceOf(Error);
	});

	it("supports cause chaining", () => {
		const cause = new Error("API 500");
		const err = new AgentError("stream died", true, cause);
		expect(err.cause).toBe(cause);
		expect(err.retryable).toBe(true);
	});
});

// ── ToolError ────────────────────────────────────────────────────────────────

describe("ToolError", () => {
	it("sets code to TOOL_ERROR", () => {
		const err = new ToolError("file_read", "not found");
		expect(err.code).toBe("TOOL_ERROR");
	});

	it("sets name to ToolError", () => {
		const err = new ToolError("file_read", "not found");
		expect(err.name).toBe("ToolError");
	});

	it("stores the toolName", () => {
		const err = new ToolError("bash_exec", "command failed");
		expect(err.toolName).toBe("bash_exec");
	});

	it("formats message with tool name in brackets", () => {
		const err = new ToolError("file_write", "permission denied");
		expect(err.message).toBe("[file_write] permission denied");
	});

	it("inherits from TakumiError", () => {
		const err = new ToolError("test", "msg");
		expect(err).toBeInstanceOf(TakumiError);
	});

	it("inherits from Error", () => {
		const err = new ToolError("test", "msg");
		expect(err).toBeInstanceOf(Error);
	});

	it("supports cause chaining", () => {
		const cause = new Error("EACCES");
		const err = new ToolError("file_read", "access denied", cause);
		expect(err.cause).toBe(cause);
	});

	it("is instanceof ToolError but also TakumiError", () => {
		const err = new ToolError("x", "y");
		expect(err).toBeInstanceOf(ToolError);
		expect(err).toBeInstanceOf(TakumiError);
		expect(err).toBeInstanceOf(Error);
	});
});

// ── PermissionError ──────────────────────────────────────────────────────────

describe("PermissionError", () => {
	it("sets code to PERMISSION_ERROR", () => {
		const err = new PermissionError("bash", "execute");
		expect(err.code).toBe("PERMISSION_ERROR");
	});

	it("sets name to PermissionError", () => {
		const err = new PermissionError("bash", "execute");
		expect(err.name).toBe("PermissionError");
	});

	it("stores tool and action", () => {
		const err = new PermissionError("file_write", "write");
		expect(err.tool).toBe("file_write");
		expect(err.action).toBe("write");
	});

	it("generates default message from tool and action", () => {
		const err = new PermissionError("bash", "execute");
		expect(err.message).toBe("Permission denied: bash cannot execute");
	});

	it("accepts a custom message", () => {
		const err = new PermissionError("bash", "rm -rf", "Dangerous command blocked");
		expect(err.message).toBe("Dangerous command blocked");
	});

	it("inherits from TakumiError", () => {
		const err = new PermissionError("test", "action");
		expect(err).toBeInstanceOf(TakumiError);
	});

	it("inherits from Error", () => {
		const err = new PermissionError("test", "action");
		expect(err).toBeInstanceOf(Error);
	});

	it("is instanceof PermissionError but also TakumiError", () => {
		const err = new PermissionError("x", "y");
		expect(err).toBeInstanceOf(PermissionError);
		expect(err).toBeInstanceOf(TakumiError);
		expect(err).toBeInstanceOf(Error);
	});
});

// ── Cross-type instanceof checks ────────────────────────────────────────────

describe("cross-type instanceof checks", () => {
	it("ToolError is not instanceof ConfigError", () => {
		const err = new ToolError("t", "m");
		expect(err).not.toBeInstanceOf(ConfigError);
	});

	it("ConfigError is not instanceof ToolError", () => {
		const err = new ConfigError("m");
		expect(err).not.toBeInstanceOf(ToolError);
	});

	it("AgentError is not instanceof RenderError", () => {
		const err = new AgentError("m");
		expect(err).not.toBeInstanceOf(RenderError);
	});

	it("PermissionError is not instanceof AgentError", () => {
		const err = new PermissionError("t", "a");
		expect(err).not.toBeInstanceOf(AgentError);
	});

	it("all error types are instanceof TakumiError", () => {
		expect(new ConfigError("x")).toBeInstanceOf(TakumiError);
		expect(new RenderError("x")).toBeInstanceOf(TakumiError);
		expect(new AgentError("x")).toBeInstanceOf(TakumiError);
		expect(new ToolError("t", "x")).toBeInstanceOf(TakumiError);
		expect(new PermissionError("t", "a")).toBeInstanceOf(TakumiError);
	});

	it("all error types are instanceof Error", () => {
		expect(new ConfigError("x")).toBeInstanceOf(Error);
		expect(new RenderError("x")).toBeInstanceOf(Error);
		expect(new AgentError("x")).toBeInstanceOf(Error);
		expect(new ToolError("t", "x")).toBeInstanceOf(Error);
		expect(new PermissionError("t", "a")).toBeInstanceOf(Error);
	});
});
