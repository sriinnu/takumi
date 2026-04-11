/**
 * Glob tool — find files matching glob patterns.
 * Uses Node.js built-in fs.glob (Node 22+, async).
 */

import { glob } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolDefinition } from "@takumi/core";
import type { ToolHandler } from "./registry.js";

export const globDefinition: ToolDefinition = {
	name: "glob",
	description:
		"Find files matching a glob pattern. Returns matching file paths. " +
		"Supports *, **, and ? wildcards. Use for finding files by name or extension.",
	inputSchema: {
		type: "object",
		properties: {
			pattern: { type: "string", description: "Glob pattern (e.g. '**/*.ts', 'src/**/*.test.ts')" },
			path: { type: "string", description: "Directory to search in (defaults to cwd)" },
		},
		required: ["pattern"],
	},
	requiresPermission: false,
	category: "search",
};

export const globHandler: ToolHandler = async (input) => {
	const pattern = input.pattern as string;
	const searchPath = (input.path as string | undefined) ?? process.cwd();

	if (!pattern) {
		return { output: "Error: pattern is required", isError: true };
	}

	try {
		const cwd = resolve(searchPath);
		const matches: string[] = [];
		for await (const entry of glob(pattern, { cwd, withFileTypes: false })) {
			matches.push(entry as string);
			if (matches.length > 500) break;
		}

		const sorted = matches.sort();
		const limited = sorted.slice(0, 500);

		if (limited.length === 0) {
			return { output: "No files matched the pattern.", isError: false };
		}

		let output = limited.map((f) => resolve(cwd, f)).join("\n");
		if (matches.length > 500) {
			output += `\n... and more files (results truncated at 500)`;
		}

		return { output, isError: false };
	} catch (err) {
		return { output: `Glob error: ${(err as Error).message}`, isError: true };
	}
};
