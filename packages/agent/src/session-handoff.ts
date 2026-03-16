/**
 * Session Handoff Manager — P-Track 3: Structured Handoff/Reattach
 *
 * Creates and consumes {@link HandoffPayload} for transferring work between
 * sessions, branches, and side agents. Integrates with Chitragupta's consumer
 * API for model resolution (`route.resolve`) and session continuity
 * (`session.open`, `session.turn`).
 *
 * Usage:
 * ```ts
 * const mgr = new HandoffManager({ bridge, artifactStore });
 * const payload = await mgr.createHandoff({ ... });
 * const result = await mgr.reattach(payload, targetSessionId);
 * ```
 */

import type { ChitraguptaBridge, RoutingRequest } from "@takumi/bridge";
import { routeResolve } from "@takumi/bridge";
import type {
	ArtifactStore,
	HandoffArtifactRef,
	HandoffPayload,
	HandoffRouteBinding,
	HandoffTarget,
	HandoffWorkState,
	ReattachResult,
	SessionData,
} from "@takumi/core";
import {
	createHandoffId,
	createHubArtifact,
	createLogger,
	generateSessionId,
	loadSession,
	saveSession,
} from "@takumi/core";

const log = createLogger("session-handoff");

// ── Config ────────────────────────────────────────────────────────────────────

export interface HandoffManagerConfig {
	/** Chitragupta bridge for route resolution and session ops. */
	bridge?: ChitraguptaBridge | null;
	/** Artifact store for persisting handoff artifacts. */
	artifactStore?: ArtifactStore;
	/** Sessions directory override (for testing). */
	sessionsDir?: string;
}

// ── Create handoff input ──────────────────────────────────────────────────────

export interface CreateHandoffInput {
	/** Source session ID. */
	sessionId: string;
	/** Active model. */
	model: string;
	/** Active provider family. */
	provider: string;
	/** Git branch, if applicable. */
	branch?: string;
	/** Side agent ID, if source is a side agent. */
	sideAgentId?: string;
	/** Chitragupta daemon session ID. */
	daemonSessionId?: string;
	/** Where to hand off. */
	target: HandoffTarget;
	/** Work state snapshot. */
	workState: HandoffWorkState;
	/** Artifact IDs to include. */
	artifactIds?: string[];
	/** Free-form notes. */
	notes?: string;
	/** Checkpoint turn number. */
	checkpointTurn?: number;
	/** Route class to capture binding for (e.g. "coding.deep-reasoning"). */
	routeClass?: string;
}

// ── Manager ───────────────────────────────────────────────────────────────────

export class HandoffManager {
	private readonly bridge: ChitraguptaBridge | null;
	private readonly store: ArtifactStore | undefined;
	private readonly sessionsDir: string | undefined;

	constructor(config: HandoffManagerConfig = {}) {
		this.bridge = config.bridge ?? null;
		this.store = config.artifactStore;
		this.sessionsDir = config.sessionsDir;
	}

	/**
	 * Create a handoff payload capturing the current work state, route binding,
	 * and artifact references. Persists the payload as a "handoff" artifact.
	 */
	async createHandoff(input: CreateHandoffInput): Promise<HandoffPayload> {
		const routeBinding = await this.captureRouteBinding(input);
		const artifacts = await this.resolveArtifactRefs(input.artifactIds ?? []);

		const payload: HandoffPayload = {
			version: 1,
			handoffId: createHandoffId(),
			createdAt: new Date().toISOString(),
			source: {
				sessionId: input.sessionId,
				branch: input.branch,
				sideAgentId: input.sideAgentId,
				model: input.model,
				provider: input.provider,
			},
			target: input.target,
			workState: input.workState,
			routeBinding: routeBinding ?? undefined,
			artifacts,
			daemonSessionId: input.daemonSessionId,
			checkpointTurn: input.checkpointTurn,
			notes: input.notes,
		};

		// Persist as a handoff artifact
		if (this.store) {
			const artifact = createHubArtifact({
				kind: "handoff",
				producer: "takumi.tui",
				summary: `Handoff → ${input.target.kind}${input.target.id ? ` (${input.target.id})` : ""}: ${input.workState.objective.slice(0, 120)}`,
				body: JSON.stringify(payload, null, "\t"),
				metadata: {
					handoffId: payload.handoffId,
					targetKind: input.target.kind,
					targetId: input.target.id,
				},
			});
			await this.store.save(artifact, input.sessionId);
		}

		log.info(`Handoff created: ${payload.handoffId} → ${input.target.kind}`);
		return payload;
	}

	/**
	 * Reattach to a handoff payload: load/create the target session, resolve
	 * the model via Chitragupta's route.resolve, and restore context.
	 */
	async reattach(payload: HandoffPayload, overrideSessionId?: string): Promise<ReattachResult> {
		const warnings: string[] = [];

		// 1. Resolve the target session
		let targetSessionId: string;
		let session: SessionData | null = null;

		if (overrideSessionId) {
			targetSessionId = overrideSessionId;
			session = await loadSession(targetSessionId, this.sessionsDir);
		} else if ((payload.target.kind === "session" || payload.target.kind === "branch") && payload.target.id) {
			targetSessionId = payload.target.id;
			session = await loadSession(targetSessionId, this.sessionsDir);
		} else {
			targetSessionId = generateSessionId();
		}

		// 2. Resolve model via Chitragupta consumer API (route.resolve)
		const resolvedModel = await this.resolveModelForReattach(payload, warnings);

		// 3. Create daemon session for continuity if bridge available
		const daemonSessionId = await this.ensureDaemonSession(payload, targetSessionId);

		// 4. Build or update the target session
		const now = Date.now();
		if (!session) {
			session = {
				id: targetSessionId,
				title: `Reattach: ${payload.workState.objective.slice(0, 60)}`,
				createdAt: now,
				updatedAt: now,
				messages: [],
				model: resolvedModel,
				tokenUsage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
			};
		} else {
			session.model = resolvedModel;
			session.updatedAt = now;
		}

		// 5. Inject handoff context as a system-level message
		const contextMessage = this.buildContextMessage(payload, daemonSessionId);
		session.messages.push(contextMessage);

		await saveSession(session, this.sessionsDir);
		log.info(`Reattached handoff ${payload.handoffId} → session ${targetSessionId}`);

		return {
			success: true,
			sessionId: targetSessionId,
			messageCount: session.messages.length,
			model: resolvedModel,
			warnings,
		};
	}

	/**
	 * Load a persisted handoff payload from the artifact store by handoff ID.
	 */
	async loadHandoff(handoffId: string): Promise<HandoffPayload | null> {
		if (!this.store) return null;
		const results = await this.store.query({ kind: "handoff", limit: 50 });
		for (const art of results) {
			if (!art.body) continue;
			try {
				const parsed = JSON.parse(art.body) as HandoffPayload;
				if (parsed.handoffId === handoffId) return parsed;
			} catch {}
		}
		return null;
	}

	/**
	 * List recent handoff artifacts (summary view).
	 */
	async listHandoffs(limit = 10): Promise<Array<{ handoffId: string; createdAt: string; summary: string }>> {
		if (!this.store) return [];
		const results = await this.store.query({ kind: "handoff", limit });
		return results.map((art) => {
			let handoffId = "unknown";
			if (art.body) {
				try {
					const parsed = JSON.parse(art.body) as HandoffPayload;
					handoffId = parsed.handoffId;
				} catch {
					/* ignore */
				}
			}
			return { handoffId, createdAt: art.createdAt, summary: art.summary };
		});
	}

	// ── Private helpers ───────────────────────────────────────────────────────

	/**
	 * Capture the current Chitragupta route binding via `route.resolve`.
	 * Falls back gracefully if the daemon is unavailable.
	 */
	private async captureRouteBinding(input: CreateHandoffInput): Promise<HandoffRouteBinding | null> {
		if (!input.routeClass || !this.bridge?.isConnected) return null;

		const socket = this.bridge.daemonSocket;
		const socketMode = this.bridge.isSocketMode;

		const request: RoutingRequest = {
			consumer: "takumi",
			sessionId: input.daemonSessionId ?? input.sessionId,
			capability: input.routeClass,
		};

		try {
			const decision = await routeResolve(socket, socketMode, request);
			if (!decision?.selected) return null;

			return {
				routeClass: input.routeClass,
				providerFamily: decision.selected.providerFamily ?? input.provider,
				modelId: (decision.selected.metadata?.modelId as string) ?? input.model,
				fallbackChain: decision.fallbackChain,
				degraded: decision.degraded,
			};
		} catch (err) {
			log.debug(`Route capture failed: ${(err as Error).message}`);
			return null;
		}
	}

	/**
	 * Resolve the best model for reattach using the Chitragupta consumer API.
	 * Uses `route.resolve` with the handoff's route class. Falls back to the
	 * source model if the daemon is unavailable.
	 */
	private async resolveModelForReattach(payload: HandoffPayload, warnings: string[]): Promise<string> {
		const fallbackModel = payload.source.model;

		if (!this.bridge?.isConnected || !payload.routeBinding) {
			if (!this.bridge?.isConnected) {
				warnings.push("Chitragupta daemon unavailable — using source model as fallback.");
			}
			return fallbackModel;
		}

		const socket = this.bridge.daemonSocket;
		const socketMode = this.bridge.isSocketMode;

		const request: RoutingRequest = {
			consumer: "takumi",
			sessionId: payload.daemonSessionId ?? payload.source.sessionId,
			capability: payload.routeBinding.routeClass,
		};

		try {
			const decision = await routeResolve(socket, socketMode, request);
			if (!decision?.selected) {
				warnings.push("Route resolution returned no match — using source model.");
				return fallbackModel;
			}

			const resolvedModel = (decision.selected.metadata?.modelId as string) ?? fallbackModel;
			if (decision.degraded) {
				warnings.push(`Route is degraded: ${decision.reason}`);
			}
			return resolvedModel;
		} catch (err) {
			warnings.push(`Route resolution failed: ${(err as Error).message} — using source model.`);
			return fallbackModel;
		}
	}

	/**
	 * Ensure a daemon session exists for cross-session continuity via
	 * `session.open` from the consumer API contract.
	 */
	private async ensureDaemonSession(payload: HandoffPayload, targetSessionId: string): Promise<string | null> {
		if (!this.bridge?.isConnected) return null;

		try {
			const result = await this.bridge.sessionCreate({
				project: process.cwd(),
				title: `Reattach ${targetSessionId} ← ${payload.source.sessionId}: ${payload.workState.objective.slice(0, 48)}`,
				agent: "takumi",
				model: payload.source.model,
				provider: payload.source.provider,
			});
			return result.id;
		} catch (err) {
			log.debug(`Daemon session create failed: ${(err as Error).message}`);
			return null;
		}
	}

	/**
	 * Resolve artifact references from the store.
	 */
	private async resolveArtifactRefs(artifactIds: string[]): Promise<HandoffArtifactRef[]> {
		if (!this.store || artifactIds.length === 0) return [];

		const refs: HandoffArtifactRef[] = [];
		for (const id of artifactIds) {
			const art = await this.store.load(id);
			if (art) {
				refs.push({ artifactId: art.artifactId, kind: art.kind, summary: art.summary });
			}
		}
		return refs;
	}

	/**
	 * Build an assistant message that injects the handoff context into the
	 * receiving session so the agent has full awareness of prior work.
	 */
	private buildContextMessage(payload: HandoffPayload, daemonSessionId: string | null): import("@takumi/core").Message {
		const sections: string[] = [
			"## Handoff Context",
			"",
			`**Objective:** ${payload.workState.objective}`,
			`**Source:** session \`${payload.source.sessionId}\`${payload.source.branch ? ` (branch: ${payload.source.branch})` : ""}${payload.source.sideAgentId ? ` (side-agent: ${payload.source.sideAgentId})` : ""}`,
			`**Model:** ${payload.source.model} (${payload.source.provider})`,
			`**Validation:** ${payload.workState.validationStatus}`,
		];

		if (payload.workState.decisions.length > 0) {
			sections.push("", "**Decisions:**");
			for (const d of payload.workState.decisions) {
				sections.push(`- ${d}`);
			}
		}

		if (payload.workState.filesChanged.length > 0) {
			sections.push("", "**Files changed:**");
			for (const f of payload.workState.filesChanged) {
				sections.push(`- ${f.path} (${f.status})`);
			}
		}

		if (payload.workState.blockers.length > 0) {
			sections.push("", "**Blockers/Open questions:**");
			for (const b of payload.workState.blockers) {
				sections.push(`- ${b}`);
			}
		}

		if (payload.workState.nextAction) {
			sections.push("", `**Next action:** ${payload.workState.nextAction}`);
		}

		if (payload.notes) {
			sections.push("", `**Notes:** ${payload.notes}`);
		}

		if (payload.artifacts.length > 0) {
			sections.push("", "**Referenced artifacts:**");
			for (const a of payload.artifacts) {
				sections.push(`- [${a.kind}] ${a.summary} (\`${a.artifactId}\`)`);
			}
		}

		if (payload.routeBinding) {
			sections.push(
				"",
				"**Route binding:**",
				`- Class: ${payload.routeBinding.routeClass}`,
				`- Provider: ${payload.routeBinding.providerFamily}`,
				`- Model: ${payload.routeBinding.modelId}`,
				`- Degraded: ${payload.routeBinding.degraded}`,
			);
		}

		if (daemonSessionId) {
			sections.push("", `**Daemon session:** ${daemonSessionId}`);
		}

		return {
			id: `handoff-ctx-${Date.now()}`,
			role: "assistant",
			content: [{ type: "text", text: sections.join("\n") }],
			timestamp: Date.now(),
		};
	}
}
