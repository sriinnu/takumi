/**
 * Grep tool — search file contents using regex patterns.
 * Uses child_process.spawn (async) with array args (no shell injection).
 * Invokes ripgrep (rg) or falls back to node grep.
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { ToolDefinition } from "@takumi/core";
import type { ToolHandler } from "./registry.js";

/** Async wrapper around child_process.spawn — non-blocking alternative to spawnSync. */
function spawnAsync(
	cmd: string,
	args: string[],
	opts: { timeout?: number; maxBuffer?: number },
): Promise<{ stdout: string; stderr: string; status: number }> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
		const chunks: Buffer[] = [];
		const errChunks: Buffer[] = [];
		let totalBytes = 0;
		const maxBuf = opts.maxBuffer ?? 1024 * 1024;

		child.stdout.on("data", (d: Buffer) => {
			totalBytes += d.length;
			if (totalBytes <= maxBuf) chunks.push(d);
		});
		child.stderr.on("data", (d: Buffer) => errChunks.push(d));
		child.on("error", reject);

		const timer = opts.timeout
			? setTimeout(() => {
					child.kill("SIGTERM");
					reject(new Error(`Process timed out after ${opts.timeout}ms`));
				}, opts.timeout)
			: null;

		child.on("close", (status) => {
			if (timer) clearTimeout(timer);
			resolve({
				stdout: Buffer.concat(chunks).toString("utf-8"),
				stderr: Buffer.concat(errChunks).toString("utf-8"),
				status: status ?? 1,
			});
		});
	});
}

export const grepDefinition: ToolDefinition = {
	name: "grep",
	description:
		"Search file contents using a regex pattern. Returns matching lines with " +
		"file path and line number. Supports context lines and file type filtering.",
	inputSchema: {
		type: "object",
		properties: {
			pattern: { type: "string", description: "Regex pattern to search for" },
			path: { type: "string", description: "Directory or file to search (defaults to cwd)" },
			glob: { type: "string", description: "Glob pattern to filter files (e.g. '*.ts')" },
			context: { type: "number", description: "Lines of context around each match" },
			maxResults: { type: "number", description: "Maximum results (default: 50)" },
		},
		required: ["pattern"],
	},
	requiresPermission: false,
	category: "search",
};

export const grepHandler: ToolHandler = async (input) => {
	const pattern = input.pattern as string;
	const searchPath = (input.path as string | undefined) ?? process.cwd();
	const glob = input.glob as string | undefined;
	const context = input.context as number | undefined;
	const maxResults = (input.maxResults as number | undefined) ?? 50;

	if (!pattern) {
		return { output: "Error: pattern is required", isError: true };
	}

	try {
		const cwd = resolve(searchPath);

		// Build args as array — spawnSync handles escaping (no shell injection)
		const args: string[] = ["--line-number", "--no-heading", "--color=never"];

		if (glob) {
			args.push("--glob", glob);
		}
		if (context !== undefined && context > 0) {
			args.push(`-C`, String(context));
		}
		args.push("-m", String(maxResults));
		args.push("--", pattern, cwd);

		const result = await spawnAsync("rg", args, {
			maxBuffer: 1024 * 1024,
			timeout: 30_000,
		});

		// rg exits with code 1 for "no matches" — not an error
		if (result.status === 1) {
			return { output: "No matches found.", isError: false };
		}

		// rg exits with code 2+ for actual errors
		if (result.status !== null && result.status >= 2) {
			return { output: `Grep error: ${result.stderr || "unknown error"}`, isError: true };
		}

		const output = (result.stdout || "").trim();
		if (!output) {
			return { output: "No matches found.", isError: false };
		}

		return { output, isError: false };
	} catch (err: unknown) {
		return { output: `Grep error: ${(err as Error).message}`, isError: true };
	}
};
