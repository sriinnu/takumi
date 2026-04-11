import type { CSSProperties } from "react";
import type { AgentState, SessionDetail } from "../hooks/useAgentStream";

const panelStyle: CSSProperties = {
	background: "var(--c-bg)",
	border: "1px solid var(--c-border)",
	borderRadius: 10,
	padding: 14,
};

const metricToneMap: Record<string, string> = {
	critical: "#dc2626",
	warning: "#d97706",
	info: "#2563eb",
	none: "#0f766e",
};

export interface TaskPanePanelProps {
	state: AgentState;
	sessionDetail: SessionDetail | null;
}

/**
 * TaskPanePanel gives the Build Window a denser task-oriented surface:
 * live usage telemetry, tokmeter project context, and the latest user ↔
 * assistant exchange in one place.
 */
export function TaskPanePanel(props: TaskPanePanelProps) {
	const { state, sessionDetail } = props;
	const usage = state.usage;
	const sync = state.sync;
	const tokmeter = state.tokmeter;
	const recentTurns = sessionDetail?.turns.slice(-6).reverse() ?? [];
	const maxDailyCost = Math.max(...(tokmeter?.recentDaily ?? []).map((entry) => entry.costUsd), 0);
	const contextTone = state.contextPercent != null && state.contextPercent >= 85 ? "#dc2626" : "#2563eb";
	const toolSummary = state.toolsInFlight.length > 0 ? state.toolsInFlight.join(", ") : "No active tools";
	const syncSummary = formatSyncSummary(sync);
	const syncDetail = formatSyncDetail(sync);
	const syncAccent = resolveSyncAccent(sync);
	const routeSummary = state.routing
		? `${state.routing.authority} · ${state.routing.enforcement}`
		: "Waiting for route telemetry";

	return (
		<section style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
			<div style={panelStyle}>
				<div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", marginBottom: 10 }}>
					<div>
						<div style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text-secondary)", marginBottom: 4 }}>
							Task Pane
						</div>
						<div style={{ fontSize: 12, color: "var(--c-text-muted)" }}>
							Live task telemetry, tokmeter project context, and recent coding back-and-forth.
						</div>
					</div>
					<div style={{ fontSize: 11, color: "var(--c-text-muted)" }}>
						Updated {formatRelativeTime(state.updatedAt)}
					</div>
				</div>
				<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 10 }}>
					<MetricTile
						label="Turns"
						value={`${usage?.turnCount ?? 0}`}
						detail={usage ? `${formatTokenCount(usage.totalTokens)} tracked in this session` : "Waiting for usage telemetry"}
						tone="#2563eb"
					/>
					<MetricTile
						label="Session Spend"
						value={formatUsd(usage?.totalCostUsd ?? 0)}
						detail={usage ? `${formatTokenCount(usage.totalTokens)} total tokens` : "No priced turns yet"}
						tone={metricToneMap[usage?.alertLevel ?? "none"] ?? "#0f766e"}
					/>
					<MetricTile
						label="Burn Rate"
						value={formatUsdPerMinute(usage?.ratePerMinute ?? 0)}
						detail={usage ? `Projected ${formatUsd(usage.projectedUsd)}` : "Projection unavailable"}
						tone={metricToneMap[usage?.alertLevel ?? "none"] ?? "#0f766e"}
					/>
					<MetricTile
						label="Context"
						value={state.contextPercent != null ? `${Math.round(state.contextPercent)}%` : "—"}
						detail={state.contextPressure ?? "normal"}
						tone={contextTone}
					/>
					<MetricTile
						label="Tokmeter Today"
						value={formatUsd(tokmeter?.todayCostUsd ?? 0)}
						detail={tokmeter ? `${formatTokenCount(tokmeter.todayTokens)} today` : "Waiting for tokmeter sync"}
						tone="#7c3aed"
					/>
					<MetricTile
						label="Project Lifetime"
						value={formatUsd(tokmeter?.totalCostUsd ?? 0)}
						detail={tokmeter ? `${tokmeter.activeDays} active day${tokmeter.activeDays === 1 ? "" : "s"}` : "No project summary yet"}
						tone="#4f46e5"
					/>
				</div>
				<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
					<SignalPill label="Sync" value={syncSummary} accent={syncAccent} />
					<SignalPill label="Route" value={routeSummary} accent={state.routing?.degraded ? "#dc2626" : "#2563eb"} />
					<SignalPill label="Tools" value={toolSummary} accent={state.toolsInFlight.length > 0 ? "#d97706" : "#16a34a"} />
					<SignalPill
						label="Provider"
						value={`${state.provider ?? "unknown"} / ${state.model ?? "unknown"}`}
						accent="#0f766e"
					/>
					{tokmeter && (
						<SignalPill
							label="Tokmeter"
							value={tokmeter.matchedProjects.length > 0 ? `${tokmeter.matchedProjects.length} project bucket${tokmeter.matchedProjects.length === 1 ? "" : "s"}` : tokmeter.projectQuery}
							accent="#7c3aed"
						/>
					)}
				</div>
				{sync?.lastSyncError && sync.status === "failed" && (
					<div style={{ fontSize: 11, color: "#b45309", marginTop: 10 }}>
						Last sync error: {sync.lastSyncError}
					</div>
				)}
				{syncDetail && (
					<div style={{ fontSize: 11, color: "var(--c-text-muted)", marginTop: 10 }}>
						{syncDetail}
					</div>
				)}
			</div>

			<div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(260px, 0.9fr)", gap: 12 }}>
				<div style={panelStyle}>
					<div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
						<div>
							<div style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text-secondary)", marginBottom: 4 }}>
								Task Thread
							</div>
							<div style={{ fontSize: 12, color: "var(--c-text-muted)" }}>
								Latest-first back-and-forth for the focused session.
							</div>
						</div>
						<div style={{ fontSize: 11, color: "var(--c-text-muted)" }}>
							{sessionDetail ? `${sessionDetail.turns.length} turns loaded` : "No focused session yet"}
						</div>
					</div>
					{recentTurns.length === 0 ? (
						<div style={{ fontSize: 12, color: "var(--c-text-muted)" }}>
							Focus or attach a session to keep the task thread in sync.
						</div>
					) : (
						<div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflow: "auto" }}>
							{recentTurns.map((turn, index) => {
								const accent = turn.role === "user" ? "#2563eb" : turn.role === "assistant" ? "#16a34a" : "#6b7280";
								return (
									<div
										key={`${turn.timestamp}-${index}`}
										style={{
											border: `1px solid color-mix(in srgb, ${accent} 35%, var(--c-border))`,
											borderLeft: `4px solid ${accent}`,
											borderRadius: 8,
											padding: 10,
											background: "var(--c-bg-card)",
										}}
									>
										<div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
											<span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: accent }}>
												{turn.role}
											</span>
											<span style={{ fontSize: 11, color: "var(--c-text-muted)" }}>
												{new Date(turn.timestamp).toLocaleTimeString()}
											</span>
										</div>
										<div style={{ fontSize: 13, color: "var(--c-text)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
											{turn.content}
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>

				<div style={panelStyle}>
					<div style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text-secondary)", marginBottom: 4 }}>
						Tokmeter Project View
					</div>
					<div style={{ fontSize: 12, color: "var(--c-text-muted)", marginBottom: 10 }}>
						{tokmeter
							? `Project query “${tokmeter.projectQuery}” • synced ${formatRelativeTime(tokmeter.refreshedAt)}`
							: "Project telemetry arrives once the bridge syncs tokmeter."}
					</div>
					{tokmeter ? (
						<>
							<div style={{ display: "flex", alignItems: "end", gap: 8, minHeight: 84, marginBottom: 12 }}>
								{tokmeter.recentDaily.map((entry) => {
									const height = maxDailyCost > 0 ? Math.max(10, Math.round((entry.costUsd / maxDailyCost) * 56)) : 10;
									const active = entry.costUsd > 0 || entry.totalTokens > 0;
									return (
										<div key={entry.date} style={{ flex: 1, minWidth: 0 }}>
											<div
												style={{
													height,
													borderRadius: 999,
													background: active ? "linear-gradient(180deg, #8b5cf6 0%, #4f46e5 100%)" : "#e5e7eb",
													marginBottom: 6,
												}}
											/>
											<div style={{ fontSize: 10, color: "var(--c-text-muted)", textAlign: "center" }}>
												{entry.date.slice(5)}
											</div>
										</div>
									);
								})}
							</div>
							<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
								<SummaryList
									title="Top models"
									emptyLabel="No priced model history yet"
									items={tokmeter.topModels.map((entry) => ({
										label: entry.model,
										detail: `${entry.provider} • ${formatUsd(entry.costUsd)} • ${formatTokenCount(entry.totalTokens)}`,
									}))}
								/>
								<SummaryList
									title="Top providers"
									emptyLabel="No provider history yet"
									items={tokmeter.topProviders.map((entry) => ({
										label: entry.provider,
										detail: `${formatUsd(entry.costUsd)} • ${formatTokenCount(entry.totalTokens)}`,
									}))}
								/>
							</div>
							{tokmeter.note && (
								<div style={{ fontSize: 11, color: "var(--c-text-muted)", marginTop: 10 }}>
									{tokmeter.note}
								</div>
							)}
						</>
					) : (
						<div style={{ fontSize: 12, color: "var(--c-text-muted)" }}>
							Waiting for tokmeter project telemetry.
						</div>
					)}
				</div>
			</div>
		</section>
	);
}

function MetricTile(props: { label: string; value: string; detail: string; tone: string }) {
	const { label, value, detail, tone } = props;
	return (
		<div style={{ border: `1px solid color-mix(in srgb, ${tone} 30%, var(--c-border))`, borderRadius: 8, padding: 10, background: "var(--c-bg-card)" }}>
			<div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--c-text-muted)", marginBottom: 6 }}>
				{label}
			</div>
			<div style={{ fontSize: 18, fontWeight: 700, color: tone, marginBottom: 4 }}>{value}</div>
			<div style={{ fontSize: 11, color: "var(--c-text-muted)", lineHeight: 1.4 }}>{detail}</div>
		</div>
	);
}

function SignalPill(props: { label: string; value: string; accent: string }) {
	const { label, value, accent } = props;
	return (
		<div style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, border: `1px solid color-mix(in srgb, ${accent} 28%, var(--c-border))`, padding: "5px 10px", background: "var(--c-bg-card)" }}>
			<span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: accent }}>
				{label}
			</span>
			<span style={{ fontSize: 11, color: "var(--c-text)" }}>{value}</span>
		</div>
	);
}

function SummaryList(props: { title: string; emptyLabel: string; items: Array<{ label: string; detail: string }> }) {
	const { title, emptyLabel, items } = props;
	return (
		<div>
			<div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--c-text-muted)", marginBottom: 6 }}>
				{title}
			</div>
			{items.length === 0 ? (
				<div style={{ fontSize: 11, color: "var(--c-text-muted)" }}>{emptyLabel}</div>
			) : (
				<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
					{items.map((item) => (
						<div key={`${title}-${item.label}`} style={{ padding: 8, borderRadius: 8, background: "var(--c-bg-card)", border: "1px solid var(--c-border)" }}>
							<div style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text)", marginBottom: 4 }}>{item.label}</div>
							<div style={{ fontSize: 11, color: "var(--c-text-muted)" }}>{item.detail}</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function formatUsd(value: number): string {
	if (value < 0.01) return `$${value.toFixed(4)}`;
	if (value < 1) return `$${value.toFixed(3)}`;
	return `$${value.toFixed(2)}`;
}

function formatUsdPerMinute(value: number): string {
	if (!(value > 0)) return "$0.00/m";
	if (value < 0.01) return `$${value.toFixed(4)}/m`;
	if (value < 1) return `$${value.toFixed(3)}/m`;
	return `$${value.toFixed(2)}/m`;
}

function formatTokenCount(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
	return `${value}`;
}

function formatRelativeTime(timestamp: number): string {
	const deltaMs = Date.now() - timestamp;
	if (deltaMs < 5_000) return "just now";
	if (deltaMs < 60_000) return `${Math.round(deltaMs / 1_000)}s ago`;
	if (deltaMs < 3_600_000) return `${Math.round(deltaMs / 60_000)}m ago`;
	return `${Math.round(deltaMs / 3_600_000)}h ago`;
}

function formatSyncSummary(sync: AgentState["sync"] | undefined | null): string {
	if (!sync) return "unknown";
	const status = sync.status || "idle";
	const pendingLabel = sync.pendingLocalTurns > 0 ? ` · ${sync.pendingLocalTurns} pending` : "";
	const bindingLabel = sync.canonicalSessionId ? "" : " · unbound";
	return `${status}${pendingLabel}${bindingLabel}`;
}

/**
 * Surface the current replay cursor so desktop operators can tell whether the
 * daemon is actively replaying, stalled on a specific turn, or fully mirrored.
 */
function formatSyncDetail(sync: AgentState["sync"] | undefined | null): string | null {
	if (!sync) return null;

	if (sync.status === "failed" && sync.lastFailedMessageId) {
		return `Replay stalled on ${sync.lastFailedMessageId}${formatSyncRelativeSuffix(sync.lastFailedMessageTimestamp)}`;
	}

	if (sync.status === "syncing" && sync.lastAttemptedMessageId) {
		return `Replaying ${sync.lastAttemptedMessageId}${formatSyncRelativeSuffix(sync.lastAttemptedMessageTimestamp)}`;
	}

	if (sync.status === "ready" && sync.lastSyncedMessageId) {
		const syncedAt = sync.lastSyncedAt ?? sync.lastSyncedMessageTimestamp;
		return `Last mirrored turn ${sync.lastSyncedMessageId}${formatSyncRelativeSuffix(syncedAt)}`;
	}

	if (!sync.canonicalSessionId && sync.pendingLocalTurns > 0) {
		return "Waiting for canonical session binding before replay can resume.";
	}

	if (sync.status === "pending" && sync.pendingLocalTurns > 0) {
		return "Local replay is queued and will resume when the bridge is ready.";
	}

	return null;
}

function formatSyncRelativeSuffix(timestamp: number | null): string {
	return timestamp ? ` · ${formatRelativeTime(timestamp)}` : "";
}

function resolveSyncAccent(sync: AgentState["sync"] | undefined | null): string {
	if (!sync) return "#6b7280";
	if (sync.status === "failed") return "#dc2626";
	if (sync.status === "syncing") return "#2563eb";
	if (sync.status === "pending") return "#d97706";
	if (sync.status === "ready") return "#16a34a";
	return "#6b7280";
}
