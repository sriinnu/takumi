import type { CapabilityDescriptor, SabhaState, TelemetrySnapshot } from "@takumi/bridge";

export function formatSabhaState(state: SabhaState | null, trackedSabhaId: string): string {
	if (!state) {
		return trackedSabhaId ? `• Tracked Sabha: ${trackedSabhaId} (details unavailable)` : "• Tracked Sabha: none";
	}

	const lines = [
		`• Sabha: ${state.id}`,
		`• Topic: ${state.topic}`,
		`• Status: ${state.status}`,
		`• Convener: ${state.convener}`,
		`• Participants: ${state.participantCount}`,
		`• Rounds: ${state.roundCount}`,
	];

	if (state.finalVerdict) {
		lines.push(`• Verdict: ${state.finalVerdict}`);
	}

	if (state.currentRound) {
		lines.push(
			`• Current round: ${state.currentRound.roundNumber} (${state.currentRound.voteSummary.count} vote(s), ${state.currentRound.unresolvedChallenges.length} unresolved challenge(s))`,
		);
	}

	if (state.participants.length > 0) {
		lines.push(
			"• Council:",
			...state.participants.map((participant) => {
				const target = participant.targetClientId ?? participant.clientId;
				return `  - ${participant.id} — ${participant.role}${target ? ` [${target}]` : ""}`;
			}),
		);
	}

	return lines.join("\n");
}

export function formatWorkingAgents(snapshot: TelemetrySnapshot | null): string {
	if (!snapshot || snapshot.instances.length === 0) {
		return "## Working agents\n\nNo live Takumi telemetry instances found.";
	}

	const liveAgents = snapshot.instances
		.filter((instance) => instance.state.activity === "working" || instance.state.activity === "waiting_input")
		.sort((left, right) => right.process.heartbeatAt - left.process.heartbeatAt);

	if (liveAgents.length === 0) {
		return "## Working agents\n\nNo agents are actively working right now.";
	}

	const lines = liveAgents.map((instance, index) => {
		const branch = instance.workspace.git.branch ?? "unknown-branch";
		const model = instance.model?.id ?? instance.model?.name ?? "unknown-model";
		const provider = instance.model?.provider ?? "unknown-provider";
		const idleLabel = instance.state.activity === "waiting_input" ? "waiting" : "working";
		return `${index + 1}. **${instance.session.name || instance.session.id}** — ${idleLabel}\n   pid ${instance.process.pid} • ${provider}/${model} • ${branch} • ${(instance.context.percent ?? 0).toFixed(1)}% context`;
	});

	return `## Working agents\n\n${lines.join("\n\n")}`;
}

export function formatAvailableAgents(capabilities: CapabilityDescriptor[]): string {
	if (capabilities.length === 0) {
		return "## Available agents\n\nNo control-plane capabilities available.";
	}

	const agentLike = capabilities
		.filter(
			(capability) =>
				capability.kind === "adapter" ||
				capability.kind === "cli" ||
				capability.kind === "llm" ||
				capability.kind === "local-model",
		)
		.filter((capability) => capability.health !== "down")
		.sort((left, right) => {
			if (left.health === right.health) {
				return left.id.localeCompare(right.id);
			}
			return left.health === "healthy" ? -1 : 1;
		});

	if (agentLike.length === 0) {
		return "## Available agents\n\nNo healthy or degraded agent lanes are currently available.";
	}

	const lines = agentLike.map(
		(capability) =>
			`- **${capability.id}** — ${capability.kind} | ${capability.health} | ${capability.trust} | ${capability.capabilities.join(", ")}`,
	);

	return `## Available agents\n\n${lines.join("\n")}`;
}

export function formatRebindMessage(result: {
	connected: boolean;
	canonicalSessionId: string | null;
	syncedMessages: number;
	pendingMessages: number;
	syncStatus?: string;
	validationWarnings?: string[];
	validationConflicts?: string[];
	lastError?: string;
	lastSyncedMessageId?: string;
	lastFailedMessageId?: string;
}): string {
	if (!result.connected) {
		return [
			"Chitragupta still unavailable.",
			`Pending local turns: ${result.pendingMessages}`,
			...(result.lastSyncedMessageId ? [`Last mirrored turn: ${result.lastSyncedMessageId}`] : []),
			...(result.lastFailedMessageId ? [`Replay stalled on: ${result.lastFailedMessageId}`] : []),
			...(result.validationConflicts && result.validationConflicts.length > 0
				? [`Replay validation conflicts: ${result.validationConflicts.join("; ")}`]
				: []),
			...(result.validationWarnings && result.validationWarnings.length > 0
				? [`Replay validation warnings: ${result.validationWarnings.join("; ")}`]
				: []),
			...(result.lastError ? [`Last error: ${result.lastError}`] : []),
		].join("\n");
	}

	return [
		"Chitragupta rebind status",
		`Canonical session: ${result.canonicalSessionId ?? "(unbound)"}`,
		`Synced local turns: ${result.syncedMessages}`,
		`Pending local turns: ${result.pendingMessages}`,
		`Sync status: ${result.syncStatus ?? "idle"}`,
		...(result.lastSyncedMessageId ? [`Last mirrored turn: ${result.lastSyncedMessageId}`] : []),
		...(result.lastFailedMessageId ? [`Replay stalled on: ${result.lastFailedMessageId}`] : []),
		...(result.validationConflicts && result.validationConflicts.length > 0
			? [`Replay validation conflicts: ${result.validationConflicts.join("; ")}`]
			: []),
		...(result.validationWarnings && result.validationWarnings.length > 0
			? [`Replay validation warnings: ${result.validationWarnings.join("; ")}`]
			: []),
		...(result.lastError ? [`Last error: ${result.lastError}`] : []),
	].join("\n");
}
