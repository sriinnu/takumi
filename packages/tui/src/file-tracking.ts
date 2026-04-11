import { isAbsolute, normalize, relative } from "node:path";
import type { HandoffFileChange, ToolDefinition } from "@takumi/core";

export interface PendingTrackedFileTool {
	kind: "read" | "change";
	toolName: string;
	path: string;
	status?: HandoffFileChange["status"];
}

const READ_TOOL_NAMES = new Set(["read", "read_file"]);
const WRITE_TOOL_NAMES = new Set(["write", "write_file", "create_file"]);
const EDIT_TOOL_NAMES = new Set(["edit", "edit_file", "replace_in_file"]);

export function inferPendingTrackedFileTools(
	toolName: string,
	input: Record<string, unknown>,
	definition?: Pick<ToolDefinition, "category">,
	baseDir = process.cwd(),
): PendingTrackedFileTool[] {
	if (toolName === "apply_patch") {
		return parseApplyPatchTrackedFiles(input, baseDir);
	}

	const path = extractTrackedFilePath(input, baseDir);
	if (!path) return [];

	if (definition?.category === "read" || READ_TOOL_NAMES.has(toolName)) {
		return [{ kind: "read", toolName, path }];
	}

	if (definition?.category === "write" || WRITE_TOOL_NAMES.has(toolName) || EDIT_TOOL_NAMES.has(toolName)) {
		return [{ kind: "change", toolName, path, status: defaultChangeStatus(toolName) }];
	}

	return [];
}

export function inferTrackedChangeStatus(
	pending: PendingTrackedFileTool,
	toolOutput: string,
): HandoffFileChange["status"] {
	if (pending.status === "deleted") return "deleted";
	if (pending.status === "added") return "added";

	if (/^Created file:/i.test(toolOutput) || pending.toolName === "create_file") {
		return "added";
	}

	if (/^Deleted file:/i.test(toolOutput)) {
		return "deleted";
	}

	return "modified";
}

export function appendTrackedRead(existing: string[], filePath: string): string[] {
	const normalizedPath = normalizeTrackedPath(filePath);
	if (!normalizedPath) return existing;
	return [normalizedPath, ...existing.filter((entry) => entry !== normalizedPath)];
}

export function appendTrackedChange(
	existing: HandoffFileChange[],
	filePath: string,
	status: HandoffFileChange["status"],
): HandoffFileChange[] {
	const normalizedPath = normalizeTrackedPath(filePath);
	if (!normalizedPath) return existing;

	const previous = existing.find((entry) => entry.path === normalizedPath);
	const mergedStatus = mergeTrackedStatus(previous?.status, status);

	return [{ path: normalizedPath, status: mergedStatus }, ...existing.filter((entry) => entry.path !== normalizedPath)];
}

export function normalizeTrackedPath(filePath: string, baseDir = process.cwd()): string | null {
	const trimmed = filePath.trim();
	if (!trimmed) return null;

	const normalizedPath = normalize(trimmed);
	if (!isAbsolute(normalizedPath)) {
		return normalizedPath;
	}

	const normalizedBaseDir = normalize(baseDir);
	const relativePath = relative(normalizedBaseDir, normalizedPath);
	if (relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath)) {
		return relativePath;
	}

	return normalizedPath;
}

function parseApplyPatchTrackedFiles(input: Record<string, unknown>, baseDir: string): PendingTrackedFileTool[] {
	const patch = typeof input.input === "string" ? input.input : typeof input.patch === "string" ? input.patch : "";
	if (!patch) return [];

	const tracked = new Map<string, PendingTrackedFileTool>();
	const matches = patch.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm);
	for (const match of matches) {
		const action = match[1];
		const rawPath = match[2]?.trim();
		if (!rawPath) continue;

		const path = normalizeTrackedPath(rawPath, baseDir);
		if (!path) continue;

		tracked.set(path, {
			kind: "change",
			toolName: "apply_patch",
			path,
			status: action === "Add" ? "added" : action === "Delete" ? "deleted" : "modified",
		});
	}

	return [...tracked.values()];
}

function extractTrackedFilePath(input: Record<string, unknown>, baseDir: string): string | null {
	const candidates = [input.file_path, input.filePath, input.path, input.filename, input.targetFile];
	for (const candidate of candidates) {
		if (typeof candidate !== "string") continue;
		const normalizedPath = normalizeTrackedPath(candidate, baseDir);
		if (normalizedPath) return normalizedPath;
	}
	return null;
}

function defaultChangeStatus(toolName: string): HandoffFileChange["status"] {
	if (toolName === "create_file") return "added";
	return "modified";
}

function mergeTrackedStatus(
	previous: HandoffFileChange["status"] | undefined,
	next: HandoffFileChange["status"],
): HandoffFileChange["status"] {
	if (!previous) return next;
	if (next === "deleted") return "deleted";
	if (previous === "added" && next === "modified") return "added";
	return next;
}
