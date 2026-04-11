import type { ConventionFiles, ExtensionRunner, MessagePayload } from "@takumi/agent";
import type { AgentEvent, SessionData, TakumiConfig, ToolDefinition } from "@takumi/core";
import type { AgentRunner } from "../agent/agent-runner.js";
import type { CodingAgent } from "../agent/coding-agent.js";
import type { AutocycleAgent } from "../autocycle/autocycle-agent.js";
import type { ChitraguptaConnectResult } from "../chitragupta/app-chitragupta.js";
import type { KeybindingConfigLoadResult } from "../input/keybinding-config.js";
import type { AppState } from "../state.js";
import type { SlashCommandRegistry } from "./commands.js";

export type ProviderFactory = (
	providerName: string,
) => Promise<
	| ((
			messages: MessagePayload[],
			system: string,
			tools?: ToolDefinition[],
			signal?: AbortSignal,
			options?: { model?: string },
	  ) => AsyncIterable<AgentEvent>)
	| null
>;

export interface AppCommandContext {
	commands: SlashCommandRegistry;
	state: AppState;
	agentRunner: AgentRunner | null;
	config: TakumiConfig;
	autoPr: boolean;
	autoShip: boolean;
	providerFactory?: ProviderFactory;
	addInfoMessage(text: string): void;
	buildSessionData(): SessionData;
	startAutoSaver(): void;
	resumeSession?(sessionId: string): Promise<void>;
	activateSession?(session: SessionData, notice?: string, reason?: "new" | "resume"): Promise<void>;
	reconnectChitragupta?(): Promise<ChitraguptaConnectResult>;
	quit(): Promise<void>;
	getExtensionRunner(): ExtensionRunner | null;
	getConventionFiles(): ConventionFiles | null;
	ensureKeybindingsFile?(): Promise<{ filePath: string; created: boolean }>;
	reloadKeybindings?(): Promise<KeybindingConfigLoadResult>;
	getActiveCoder(): CodingAgent | null;
	setActiveCoder(coder: CodingAgent | null): void;
	getActiveAutocycle(): AutocycleAgent | null;
	setActiveAutocycle(agent: AutocycleAgent | null): void;
}
