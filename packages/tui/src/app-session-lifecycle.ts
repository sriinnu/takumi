/**
 * Session lifecycle manager extracted from TakumiApp.
 *
 * Owns the mutable session state (auto-saver, active work, title override)
 * and exposes session lifecycle operations (activate, resume, build, save).
 */
import type { ExtensionRunner } from "@takumi/agent";
import type { AutoSaver, SessionData } from "@takumi/core";
import { createAutoSaver } from "@takumi/core";
import type { RenderScheduler } from "@takumi/render";
import type { AgentRunner } from "./agent/agent-runner.js";
import type { CodingAgent } from "./agent/coding-agent.js";
import { buildSessionTitle, normalizeSessionTitle } from "./app-extension-runtime.js";
import { attachSessionToRuntime } from "./app-session-attach.js";
import { applyPersistedSessionState, buildSessionControlPlaneState } from "./app-session-control-plane.js";
import type { AutocycleAgent } from "./autocycle/autocycle-agent.js";
import type { ExtensionUiStore } from "./extension-ui-store.js";
import type { AppState } from "./state.js";

export interface SessionManagerDeps {
	state: AppState;
	getAgentRunner(): AgentRunner | null;
	extensionRunner: ExtensionRunner | null;
	extensionUiStore: ExtensionUiStore;
	getScheduler(): RenderScheduler | null;
	addInfoMessage(text: string): void;
}

export class SessionManager {
	autoSaver: AutoSaver | null = null;
	activeCoder: CodingAgent | null = null;
	activeAutocycle: AutocycleAgent | null = null;
	sessionTitleOverride: string | null = null;
	resumeSessionId: string | undefined;

	private readonly deps: SessionManagerDeps;

	constructor(deps: SessionManagerDeps) {
		this.deps = deps;
	}

	applySessionState(session: SessionData): void {
		this.sessionTitleOverride = normalizeSessionTitle(session.title);
		this.deps.extensionUiStore.resetSessionUi();
		applyPersistedSessionState(this.deps.state, session);
		this.deps.getAgentRunner()?.hydrateHistory(session.messages);
	}

	async cleanupActiveWork(reason: string): Promise<void> {
		const agentRunner = this.deps.getAgentRunner();
		if (agentRunner?.isRunning) {
			agentRunner.cancel();
		}

		const activeAutocycle = this.activeAutocycle;
		this.activeAutocycle = null;
		if (activeAutocycle?.isActive) {
			activeAutocycle.cancel();
		}

		const activeCoder = this.activeCoder;
		this.activeCoder = null;
		if (!activeCoder) return;
		if (activeCoder.isActive) await activeCoder.cancel(reason);
		await activeCoder.shutdown();
	}

	async rotateAutoSaver(): Promise<void> {
		if (!this.autoSaver) return;
		try {
			await this.autoSaver.save();
		} catch {
			/* best effort */
		}
		this.autoSaver.stop();
		this.autoSaver = null;
	}

	async activateSession(session: SessionData, notice?: string, reason: "new" | "resume" = "resume"): Promise<void> {
		const { state, extensionRunner, addInfoMessage } = this.deps;
		const previousSessionId = state.sessionId.value || undefined;
		if (extensionRunner) {
			const cancelled = await extensionRunner.emitCancellable({
				type: "session_before_switch",
				reason,
				targetSessionId: session.id,
			});
			if (cancelled?.cancel) {
				addInfoMessage("Session switch blocked by extension.");
				return;
			}
		}

		await this.cleanupActiveWork(`Switching to session ${session.id}.`);
		await this.rotateAutoSaver();
		this.applySessionState(session);
		this.resumeSessionId = session.id;
		this.startAutoSaver();
		if (extensionRunner) {
			await extensionRunner.emit({ type: "session_switch", reason, previousSessionId });
		}
		if (notice) addInfoMessage(notice);
		this.deps.getScheduler()?.scheduleRender();
	}

	async resumeSession(sessionId: string): Promise<void> {
		const result = await attachSessionToRuntime({
			sessionId,
			model: this.deps.state.model.value,
			chitragupta: this.deps.state.chitraguptaBridge.value,
			activateSession: (session, notice) => this.activateSession(session, notice, "resume"),
		});
		if (!result.success) {
			this.deps.addInfoMessage(result.error ?? `Could not resume session: ${sessionId}`);
		}
	}

	buildSessionData(): SessionData {
		const { state } = this.deps;
		const messages = state.messages.value;
		const controlPlane = buildSessionControlPlaneState(state);
		return {
			id: state.sessionId.value,
			title: buildSessionTitle(messages, this.sessionTitleOverride),
			createdAt: messages.length > 0 ? messages[0].timestamp : Date.now(),
			updatedAt: Date.now(),
			messages,
			model: state.model.value,
			tokenUsage: {
				inputTokens: state.totalInputTokens.value,
				outputTokens: state.totalOutputTokens.value,
				totalCost: state.totalCost.value,
			},
			controlPlane,
		};
	}

	startAutoSaver(): void {
		if (!this.autoSaver) {
			this.autoSaver = createAutoSaver(this.deps.state.sessionId.value, () => this.buildSessionData());
		}
	}
}
