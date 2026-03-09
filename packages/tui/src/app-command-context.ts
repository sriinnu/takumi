import type { MessagePayload } from "@takumi/agent";
import type { AgentEvent, SessionData, TakumiConfig, ToolDefinition } from "@takumi/core";
import type { AgentRunner } from "./agent-runner.js";
import type { AutocycleAgent } from "./autocycle-agent.js";
import type { CodingAgent } from "./coding-agent.js";
import type { SlashCommandRegistry } from "./commands.js";
import type { AppState } from "./state.js";

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
	quit(): Promise<void>;
	getActiveCoder(): CodingAgent | null;
	setActiveCoder(coder: CodingAgent | null): void;
	getActiveAutocycle(): AutocycleAgent | null;
	setActiveAutocycle(agent: AutocycleAgent | null): void;
}
