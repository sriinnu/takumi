// Agent loop
export { agentLoop } from "./loop.js";
export type { AgentLoopOptions, MessagePayload } from "./loop.js";

// Message building
export { buildSystemPrompt, buildUserMessage, buildToolResult } from "./message.js";

// SSE stream parser
export { parseSSEStream } from "./stream.js";

// Retry logic
export { withRetry, RetryableError, computeDelay, isRetryableError, getRetryAfterMs, DEFAULT_RETRY_OPTIONS } from "./retry.js";
export type { RetryOptions } from "./retry.js";

// Error types and categorization
export { ContextOverflowError, ProviderUnavailableError, isRetryable, categorizeError, friendlyErrorMessage } from "./errors.js";
export type { ErrorCategory } from "./errors.js";

// Tool registry
export { ToolRegistry } from "./tools/registry.js";
export type { ToolHandler } from "./tools/registry.js";

// Built-in tools
export { readDefinition, readHandler } from "./tools/read.js";
export { writeDefinition, writeHandler } from "./tools/write.js";
export { editDefinition, editHandler } from "./tools/edit.js";
export { bashDefinition, bashHandler } from "./tools/bash.js";
export { globDefinition, globHandler } from "./tools/glob.js";
export { grepDefinition, grepHandler } from "./tools/grep.js";
export { askDefinition, createAskHandler } from "./tools/ask.js";
export { registerBuiltinTools } from "./tools/builtin.js";

// Safety
export { validateCommand, SAFE_COMMANDS, DANGEROUS_PATTERNS } from "./safety/sandbox.js";
export { PermissionEngine } from "./safety/permissions.js";

// Context
export { buildContext } from "./context/builder.js";
export type { ContextOptions } from "./context/builder.js";
export { detectProject } from "./context/project.js";
export type { ProjectInfo } from "./context/project.js";
export {
	compactHistory,
	shouldCompact,
	compactMessages,
	estimatePayloadTokens,
	estimateTotalPayloadTokens,
} from "./context/compact.js";
export type { CompactOptions, CompactResult, PayloadCompactOptions } from "./context/compact.js";
export { loadSoul, formatSoulPrompt } from "./context/soul.js";
export type { SoulData } from "./context/soul.js";

// Providers
export { DarpanaProvider } from "./providers/darpana.js";
export { DirectProvider } from "./providers/direct.js";
