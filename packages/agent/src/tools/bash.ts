/**
 * Bash tool — executes shell commands in a sandboxed environment.
 * Commands are validated against an allowlist before execution.
 */

import { execSync } from "node:child_process";
import type { ToolDefinition, ToolResult } from "@takumi/core";
import { LIMITS } from "@takumi/core";
import { validateCommand } from "../safety/sandbox.js";
import type { ToolHandler } from "./registry.js";

export const bashDefinition: ToolDefinition = {
	name: "bash",
	description:
		"Execute a shell command and return its output. " +
		"Commands are validated against a safety allowlist. " +
		"Use for git operations, running tests, installing packages, etc.",
	inputSchema: {
		type: "object",
		properties: {
			command: { type: "string", description: "The shell command to execute" },
			timeout: {
				type: "number",
				description: "Timeout in milliseconds (max 600000)",
				default: 120000,
			},
		},
		required: ["command"],
	},
	requiresPermission: true,
	category: "execute",
};

export const bashHandler: ToolHandler = async (input, signal) => {
	const command = input.command as string;
	const timeout = Math.min(
		(input.timeout as number | undefined) ?? LIMITS.BASH_TIMEOUT,
		600_000,
	);

	if (!command) {
		return { output: "Error: command is required", isError: true };
	}

	const validation = validateCommand(command);
	if (!validation.allowed) {
		return {
			output: `Command blocked: ${validation.reason}`,
			isError: true,
		};
	}

	try {
		const result = execSync(command, {
			timeout,
			maxBuffer: LIMITS.MAX_BASH_OUTPUT,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env },
		});

		const output = typeof result === "string" ? result : "";

		if (output.length > LIMITS.MAX_BASH_OUTPUT) {
			return {
				output: output.slice(0, LIMITS.MAX_BASH_OUTPUT) + "\n... (output truncated)",
				isError: false,
			};
		}

		return { output: output || "(no output)", isError: false };
	} catch (err: any) {
		// execSync throws on non-zero exit code
		const stderr = err.stderr?.toString() ?? "";
		const stdout = err.stdout?.toString() ?? "";
		const exitCode = err.status ?? 1;
		const output = [
			stdout,
			stderr,
			`Exit code: ${exitCode}`,
		].filter(Boolean).join("\n");

		return { output, isError: true };
	}
};
