import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SteeringPriorityLevel } from "@takumi/agent";
import { createLogger } from "@takumi/core";
import type { AppState } from "./state.js";

const log = createLogger("app");
const RECENT_NOTIFICATION_WINDOW_MS = 8_000;
const recentDirectives = new Map<string, number>();

export function wasRecentlyHandled(key: string, windowMs = RECENT_NOTIFICATION_WINDOW_MS): boolean {
	const now = Date.now();
	const lastAt = recentDirectives.get(key) ?? 0;
	if (lastAt && now - lastAt < windowMs) return true;
	recentDirectives.set(key, now);
	return false;
}

export function enqueueDirective(
	state: AppState,
	text: string,
	priority: SteeringPriorityLevel,
	metadata?: Record<string, unknown>,
): void {
	const id = state.steeringQueue.enqueue(text, { priority, metadata });
	if (id) {
		state.steeringPending.value = state.steeringQueue.size;
	}
}

export function loadMcpConfig(): { command: string; args: string[] } | null {
	try {
		const mcpPath = join(process.cwd(), ".vscode", "mcp.json");
		if (!existsSync(mcpPath)) {
			log.debug("No .vscode/mcp.json found");
			return null;
		}
		const raw = readFileSync(mcpPath, "utf-8");
		const parsed = JSON.parse(raw);
		const chitraguptaConfig = parsed?.mcpServers?.chitragupta;
		if (!chitraguptaConfig?.command) return null;
		log.info("Loaded MCP config from .vscode/mcp.json");
		return { command: chitraguptaConfig.command, args: chitraguptaConfig.args || [] };
	} catch (err) {
		log.debug(`Failed to load MCP config: ${(err as Error).message}`);
		return null;
	}
}
