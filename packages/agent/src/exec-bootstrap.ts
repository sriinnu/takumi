import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ChitraguptaBridgeOptions, ChitraguptaHealth, UnifiedRecallResult, VasanaTendency } from "@takumi/bridge";
import { ChitraguptaBridge } from "@takumi/bridge";
import type { ExecBootstrapSnapshot, ExecBootstrapTransport } from "@takumi/core";

type ExecBridgeLike = Pick<
	ChitraguptaBridge,
	| "connect"
	| "disconnect"
	| "unifiedRecall"
	| "vasanaTendencies"
	| "healthStatus"
	| "sessionCreate"
	| "sessionMetaUpdate"
	| "turnAdd"
	| "turnMaxNumber"
> & {
	isConnected: boolean;
	isSocketMode: boolean;
};

export interface ExecBootstrapResult extends ExecBootstrapSnapshot {
	bridge: ExecBridgeLike | null;
	memoryContext?: string;
	health?: ChitraguptaHealth | null;
	tendencies?: VasanaTendency[];
	recall?: UnifiedRecallResult[];
}

export interface ExecBootstrapOptions {
	cwd?: string;
	createBridge?: (options: ChitraguptaBridgeOptions) => ExecBridgeLike;
}

function loadMcpConfig(cwd: string): { command: string; args: string[] } | null {
	try {
		const mcpPath = path.join(cwd, ".vscode", "mcp.json");
		if (!existsSync(mcpPath)) return null;
		const parsed = JSON.parse(readFileSync(mcpPath, "utf-8"));
		const chitraguptaConfig = parsed?.mcpServers?.chitragupta;
		if (!chitraguptaConfig?.command) return null;
		return { command: chitraguptaConfig.command, args: chitraguptaConfig.args || [] };
	} catch {
		return null;
	}
}

function formatMemoryContext(
	projectName: string,
	recall: UnifiedRecallResult[],
	tendencies: VasanaTendency[],
	health: ChitraguptaHealth | null,
): string | undefined {
	const sections: string[] = [];

	if (recall.length > 0) {
		sections.push(
			[
				`Chitragupta recall for project ${projectName}:`,
				...recall.map(
					(entry, index) =>
						`${index + 1}. [score ${entry.score.toFixed(2)} | ${entry.type}${entry.source ? ` | ${entry.source}` : ""}] ${entry.content}`,
				),
			].join("\n"),
		);
	}

	if (tendencies.length > 0) {
		sections.push(
			[
				"Chitragupta developer tendencies:",
				...tendencies
					.slice(0, 5)
					.map(
						(tendency) =>
							`- ${tendency.tendency} (strength ${tendency.strength.toFixed(2)}, stability ${tendency.stability.toFixed(2)}): ${tendency.description}`,
					),
			].join("\n"),
		);
	}

	if (health) {
		sections.push(
			[
				"Chitragupta health snapshot:",
				`- dominant: ${health.dominant}`,
				`- alerts: ${health.alerts.length > 0 ? health.alerts.join(", ") : "none"}`,
			].join("\n"),
		);
	}

	if (sections.length === 0) return undefined;

	return [
		"Use the following Chitragupta context as guidance when planning and validating work. Prefer it when it improves consistency, but override it if the repository proves otherwise.",
		...sections,
	].join("\n\n");
}

export async function bootstrapChitraguptaForExec(options: ExecBootstrapOptions = {}): Promise<ExecBootstrapResult> {
	const cwd = options.cwd ?? process.cwd();
	const projectName = path.basename(cwd) || cwd;
	const mcpConfig = loadMcpConfig(cwd);
	const bridgeOptions: ChitraguptaBridgeOptions = {
		command: mcpConfig?.command,
		args: mcpConfig?.args,
		projectPath: cwd,
		startupTimeoutMs: 8_000,
	};
	const bridge = options.createBridge?.(bridgeOptions) ?? new ChitraguptaBridge(bridgeOptions);

	try {
		await bridge.connect();
		const [recall, tendencies, health] = await Promise.all([
			bridge.unifiedRecall(projectName, 5, projectName).catch(() => []),
			bridge.vasanaTendencies(10).catch(() => []),
			bridge.healthStatus().catch(() => null),
		]);
		const transport: ExecBootstrapTransport = bridge.isSocketMode ? "daemon-socket" : "mcp-stdio";

		return {
			bridge,
			connected: bridge.isConnected,
			degraded: false,
			transport,
			memoryEntries: recall.length,
			vasanaCount: tendencies.length,
			hasHealth: Boolean(health),
			summary: `Chitragupta connected via ${transport}`,
			memoryContext: formatMemoryContext(projectName, recall, tendencies, health),
			health,
			tendencies,
			recall,
		};
	} catch (error) {
		try {
			if (bridge.isConnected) await bridge.disconnect();
		} catch {
			// best effort
		}

		return {
			bridge: null,
			connected: false,
			degraded: true,
			transport: "unavailable",
			memoryEntries: 0,
			vasanaCount: 0,
			hasHealth: false,
			summary: `Chitragupta unavailable: ${(error as Error).message}`,
			error: error as Error,
		};
	}
}
