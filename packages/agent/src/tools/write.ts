/**
 * Write file tool — creates or overwrites a file with given content.
 */

import { access, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ToolDefinition } from "@takumi/core";
import { writeFileWithEncoding } from "./file-encoding.js";
import { defaultFileMutationQueue } from "./file-mutation-queue.js";
import type { ToolHandler } from "./registry.js";

export const writeDefinition: ToolDefinition = {
	name: "write",
	description:
		"Write content to a file. Creates the file if it does not exist. " +
		"Creates parent directories automatically. Overwrites existing content.",
	inputSchema: {
		type: "object",
		properties: {
			file_path: { type: "string", description: "Absolute path to the file" },
			content: { type: "string", description: "Content to write to the file" },
		},
		required: ["file_path", "content"],
	},
	requiresPermission: true,
	category: "write",
};

export const writeHandler: ToolHandler = async (input) => {
	const filePath = input.file_path as string;
	const content = input.content as string;

	if (!filePath) {
		return { output: "Error: file_path is required", isError: true };
	}

	if (content === undefined || content === null) {
		return { output: "Error: content is required", isError: true };
	}

	try {
		return await defaultFileMutationQueue.enqueue(filePath, async () => {
			// Ensure parent directory exists
			const dir = dirname(filePath);
			try {
				await access(dir);
			} catch {
				await mkdir(dir, { recursive: true });
			}

			let existed = false;
			try {
				await access(filePath);
				existed = true;
			} catch {
				// File doesn't exist — will be created
			}

			await writeFileWithEncoding(filePath, content, { lineEnding: "lf", bom: "none" });

			const lineCount = content.split("\n").length;
			const action = existed ? "Updated" : "Created";
			return {
				output: `${action} file: ${filePath} (${lineCount} lines)`,
				isError: false,
			};
		});
	} catch (err) {
		return { output: `Error writing file: ${(err as Error).message}`, isError: true };
	}
};
