/**
 * Edit file tool — performs exact string replacement in a file.
 */

import { access } from "node:fs/promises";
import type { ToolDefinition } from "@takumi/core";
import { normalizeLineEndings, readFileWithEncoding, writeFileWithEncoding } from "./file-encoding.js";
import { defaultFileMutationQueue } from "./file-mutation-queue.js";
import type { ToolHandler } from "./registry.js";

export const editDefinition: ToolDefinition = {
	name: "edit",
	description:
		"Perform an exact string replacement in a file. " +
		"The old_string must be unique in the file (or set replace_all to true). " +
		"The edit will fail if old_string is not found or is not unique.",
	inputSchema: {
		type: "object",
		properties: {
			file_path: { type: "string", description: "Absolute path to the file" },
			old_string: { type: "string", description: "Exact text to find and replace" },
			new_string: { type: "string", description: "Replacement text" },
			replace_all: {
				type: "boolean",
				description: "Replace all occurrences (default: false)",
				default: false,
			},
		},
		required: ["file_path", "old_string", "new_string"],
	},
	requiresPermission: true,
	category: "write",
};

export const editHandler: ToolHandler = async (input) => {
	const filePath = input.file_path as string;
	const oldString = input.old_string as string;
	const newString = input.new_string as string;
	const replaceAll = (input.replace_all as boolean) ?? false;

	if (!filePath || !oldString || newString === undefined) {
		return { output: "Error: file_path, old_string, and new_string are required", isError: true };
	}

	try {
		await access(filePath);
	} catch {
		return { output: `Error: File not found: ${filePath}`, isError: true };
	}

	if (oldString === newString) {
		return { output: "Error: old_string and new_string must be different", isError: true };
	}

	try {
		return await defaultFileMutationQueue.enqueue(filePath, async () => {
			const { content, lineEnding, bom } = await readFileWithEncoding(filePath);

			// Normalize line endings on the search/replace strings to match the
			// LF-normalized file content — LLMs often send CRLF on Windows.
			const normalizedOld = normalizeLineEndings(oldString);
			const normalizedNew = normalizeLineEndings(newString);

			// Count occurrences
			let count = 0;
			let searchPos = 0;
			while (true) {
				const idx = content.indexOf(normalizedOld, searchPos);
				if (idx === -1) break;
				count++;
				searchPos = idx + normalizedOld.length;
			}

			if (count === 0) {
				return {
					output:
						"Error: old_string not found in file. Make sure it matches exactly (including whitespace and indentation).",
					isError: true,
				};
			}

			if (count > 1 && !replaceAll) {
				return {
					output: `Error: old_string found ${count} times. Provide more context to make it unique, or set replace_all to true.`,
					isError: true,
				};
			}

			let newContent: string;
			if (replaceAll) {
				newContent = content.split(normalizedOld).join(normalizedNew);
			} else {
				const idx = content.indexOf(normalizedOld);
				newContent = content.slice(0, idx) + normalizedNew + content.slice(idx + normalizedOld.length);
			}

			await writeFileWithEncoding(filePath, newContent, { lineEnding, bom });

			const replacements = replaceAll ? count : 1;
			return {
				output: `Edited ${filePath}: ${replacements} replacement(s) made`,
				isError: false,
			};
		});
	} catch (err) {
		return { output: `Error editing file: ${(err as Error).message}`, isError: true };
	}
};
