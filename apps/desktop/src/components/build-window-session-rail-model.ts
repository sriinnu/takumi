import type { RuntimeSummary, SessionSummary } from "../hooks/useAgentStream";

/**
 * I describe the operator-facing state one session rail card should render.
 */
export interface SessionRailEntryModel {
	id: string;
	title: string;
	turnsLabel: string;
	updatedAtLabel: string;
	selected: boolean;
	live: boolean;
	providerModelLabel: string;
	statusLabel: string;
	sourceLabel: string | null;
	runtimeHint: string | null;
	attachLabel: "Attach" | "Attached" | "Resume";
	attachDisabled: boolean;
	statusTone: "neutral" | "success" | "warning" | "error";
}

export interface BuildSessionRailEntriesInput {
	sessions: SessionSummary[];
	selectedSessionId: string | null;
	liveSessionId: string | null | undefined;
	liveActivity: string | undefined;
	liveRuntimeSource: string | null | undefined;
	provider: string | null | undefined;
	model: string | null | undefined;
	runtimes: RuntimeSummary[];
}

/**
 * I turn raw session + runtime snapshots into stable session-rail cards.
 *
 * The desktop shell only has first-class provider/model truth for the currently
 * attached live runtime, but it can still surface useful parity for every other
 * session by folding in local runtime metadata when it exists.
 */
export function buildSessionRailEntries(input: BuildSessionRailEntriesInput): SessionRailEntryModel[] {
	const runtimesBySessionId = indexRuntimesBySessionId(input.runtimes);
	return input.sessions.map((session) => buildSessionRailEntry(session, input, runtimesBySessionId));
}

function buildSessionRailEntry(
	session: SessionSummary,
	input: BuildSessionRailEntriesInput,
	runtimesBySessionId: Map<string, RuntimeSummary>,
): SessionRailEntryModel {
	const live = session.id === input.liveSessionId;
	const runtime = runtimesBySessionId.get(session.id) ?? null;

	if (live) {
		return {
			id: session.id,
			title: session.title || "Untitled",
			turnsLabel: `${session.turns} turns`,
			updatedAtLabel: new Date(session.timestamp).toLocaleString(),
			selected: session.id === input.selectedSessionId,
			live: true,
			providerModelLabel: `${input.provider ?? "unknown"} / ${input.model ?? "unknown"}`,
			statusLabel: `attached · ${input.liveActivity ?? "idle"}`,
			sourceLabel: input.liveRuntimeSource ? `Source: ${input.liveRuntimeSource}` : "Source: attached runtime",
			runtimeHint: runtime ? formatRuntimeHint(runtime) : null,
			attachLabel: "Attached",
			attachDisabled: true,
			statusTone: pickLiveTone(input.liveActivity),
		};
	}

	if (runtime?.state === "running") {
		return {
			id: session.id,
			title: session.title || "Untitled",
			turnsLabel: `${session.turns} turns`,
			updatedAtLabel: new Date(session.timestamp).toLocaleString(),
			selected: session.id === input.selectedSessionId,
			live: false,
			providerModelLabel: "local runtime available",
			statusLabel: "runtime running",
			sourceLabel: runtime.runtimeSource ? `Source: ${runtime.runtimeSource}` : "Source: local runtime",
			runtimeHint: formatRuntimeHint(runtime),
			attachLabel: "Attach",
			attachDisabled: false,
			statusTone: "success",
		};
	}

	if (runtime) {
		return {
			id: session.id,
			title: session.title || "Untitled",
			turnsLabel: `${session.turns} turns`,
			updatedAtLabel: new Date(session.timestamp).toLocaleString(),
			selected: session.id === input.selectedSessionId,
			live: false,
			providerModelLabel: "local runtime stopped",
			statusLabel: `runtime ${runtime.state}`,
			sourceLabel: runtime.runtimeSource ? `Source: ${runtime.runtimeSource}` : "Source: local runtime",
			runtimeHint: formatRuntimeHint(runtime),
			attachLabel: "Resume",
			attachDisabled: false,
			statusTone: runtime.state === "stopped" ? "warning" : "neutral",
		};
	}

	return {
		id: session.id,
		title: session.title || "Untitled",
		turnsLabel: `${session.turns} turns`,
		updatedAtLabel: new Date(session.timestamp).toLocaleString(),
		selected: session.id === input.selectedSessionId,
		live: false,
		providerModelLabel: "daemon history",
		statusLabel: "detached",
		sourceLabel: "Source: daemon history",
		runtimeHint: null,
		attachLabel: "Attach",
		attachDisabled: false,
		statusTone: "neutral",
	};
}

function indexRuntimesBySessionId(runtimes: RuntimeSummary[]): Map<string, RuntimeSummary> {
	const bySessionId = new Map<string, RuntimeSummary>();
	for (const runtime of [...runtimes].sort(compareRuntimePriority)) {
		if (!runtime.sessionId || bySessionId.has(runtime.sessionId)) continue;
		bySessionId.set(runtime.sessionId, runtime);
	}
	return bySessionId;
}

function compareRuntimePriority(left: RuntimeSummary, right: RuntimeSummary): number {
	const leftRunning = left.state === "running" ? 1 : 0;
	const rightRunning = right.state === "running" ? 1 : 0;
	if (leftRunning !== rightRunning) {
		return rightRunning - leftRunning;
	}
	return right.startedAt - left.startedAt;
}

function pickLiveTone(activity: string | undefined): SessionRailEntryModel["statusTone"] {
	if (activity === "working") return "success";
	if (activity === "waiting_input") return "warning";
	if (activity === "error") return "error";
	return "neutral";
}

function formatRuntimeHint(runtime: RuntimeSummary): string {
	return `${runtime.runtimeId} · pid ${runtime.pid}`;
}
