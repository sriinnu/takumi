/**
 * Command-driven tool execution.
 *
 * I route slash-command tool calls through the same permission, extension, and
 * observation surfaces that the main agent loop uses.
 */

import { type ExtensionRunner, ObservationCollector, type ToolRegistry } from "@takumi/agent";
import type { ChitraguptaObserver } from "@takumi/bridge";
import type { PermissionDecision, ToolResult } from "@takumi/core";

interface ExecuteCommandToolOptions {
	toolName: string;
	input: Record<string, unknown>;
	tools: ToolRegistry;
	extensionRunner: ExtensionRunner | null;
	observer: ChitraguptaObserver | null;
	sessionId: string | null;
	getPermissionDecision: (tool: string, args: Record<string, unknown>) => Promise<PermissionDecision>;
	recordToolUse: (tool: string, args: Record<string, unknown>, result: ToolResult) => void;
	onObservationFlush: () => void;
}

export async function executeCommandTool(options: ExecuteCommandToolOptions): Promise<ToolResult> {
	const definition = options.tools.getDefinition(options.toolName);
	if (!definition) {
		return options.tools.execute(options.toolName, options.input);
	}

	if (definition.requiresPermission) {
		const decision = await options.getPermissionDecision(options.toolName, options.input);
		if (!decision.allowed) {
			return {
				output: decision.reason ?? `Permission denied for tool: ${options.toolName}`,
				isError: true,
			};
		}
	}

	const toolCallId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	if (options.extensionRunner) {
		const blocked = await options.extensionRunner.emitToolCall({
			type: "tool_call",
			toolCallId,
			toolName: options.toolName,
			args: options.input,
		});
		if (blocked?.block) {
			return {
				output: blocked.reason ?? "Blocked by extension",
				isError: true,
			};
		}
	}

	const collector = options.sessionId ? new ObservationCollector({ sessionId: options.sessionId }) : undefined;
	const startedAt = Date.now();
	let result = await options.tools.execute(options.toolName, options.input, undefined, { permissionChecked: true });
	if (options.extensionRunner) {
		const modified = await options.extensionRunner.emitToolResult({
			type: "tool_result",
			toolCallId,
			toolName: options.toolName,
			result,
			isError: result.isError,
		});
		if (modified?.output !== undefined) {
			result = {
				output: modified.output,
				isError: modified.isError ?? result.isError,
			};
		}
	}

	collector?.recordToolUsage(options.toolName, options.input, Date.now() - startedAt, !result.isError);
	options.recordToolUse(options.toolName, options.input, result);
	if (collector && collector.pending > 0 && options.observer) {
		const response = await options.observer.observeBatch(collector.flush());
		if (response.accepted > 0) {
			options.onObservationFlush();
		}
	}
	return result;
}
