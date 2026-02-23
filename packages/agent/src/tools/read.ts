/**
 * Read file tool — reads file contents with optional line range.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import type { ToolDefinition } from "@takumi/core";
import { LIMITS } from "@takumi/core";
import type { ToolHandler } from "./registry.js";

export const readDefinition: ToolDefinition = {
	name: "read",
	description:
		"Read the contents of a file. Returns content with line numbers. " +
		"Optionally specify offset (1-based line number) and limit to read a range.",
	inputSchema: {
		type: "object",
		properties: {
			file_path: { type: "string", description: "Absolute path to the file" },
			offset: { type: "number", description: "Starting line number (1-based)" },
			limit: { type: "number", description: "Maximum number of lines to read" },
		},
		required: ["file_path"],
	},
	requiresPermission: false,
	category: "read",
};

export const readHandler: ToolHandler = async (input) => {
	const filePath = input.file_path as string;
	const offset = (input.offset as number | undefined) ?? 1;
	const limit = input.limit as number | undefined;

	if (!filePath) {
		return { output: "Error: file_path is required", isError: true };
	}

	if (!existsSync(filePath)) {
		return { output: `Error: File not found: ${filePath}`, isError: true };
	}

	try {
		const stat = statSync(filePath);
		if (stat.isDirectory()) {
			return { output: `Error: ${filePath} is a directory, not a file`, isError: true };
		}

		if (stat.size > LIMITS.MAX_FILE_SIZE) {
			return {
				output: `Error: File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max: ${LIMITS.MAX_FILE_SIZE / 1024 / 1024}MB`,
				isError: true,
			};
		}

		const content = readFileSync(filePath, "utf-8");
		const allLines = content.split("\n");

		if (allLines.length > LIMITS.MAX_FILE_LINES && !limit) {
			return {
				output: `Error: File has ${allLines.length} lines (max ${LIMITS.MAX_FILE_LINES}). Use offset and limit to read a range.`,
				isError: true,
			};
		}

		const startIdx = Math.max(0, offset - 1);
		const endIdx = limit ? startIdx + limit : allLines.length;
		const selectedLines = allLines.slice(startIdx, endIdx);

		// Format with line numbers like `cat -n`
		const formatted = selectedLines
			.map((line, i) => {
				const lineNum = String(startIdx + i + 1).padStart(6);
				return `${lineNum}\t${line}`;
			})
			.join("\n");

		return { output: formatted, isError: false };
	} catch (err) {
		return { output: `Error reading file: ${(err as Error).message}`, isError: true };
	}
};
