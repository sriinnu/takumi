import type { CSSProperties } from "react";
import { ReviewSurface } from "./review-surface";
import type {
	AgentState,
	ArtifactDetail,
	ArtifactSummary,
	OperatorAlert,
	PendingApproval,
	RepoDiffSnapshot,
	RuntimeSummary,
	SessionDetail,
	SessionSummary,
} from "../hooks/useAgentStream";

export const cardStyle: CSSProperties = {
	background: "var(--c-bg-card)",
	border: "1px solid var(--c-border)",
	borderRadius: 10,
	padding: 14,
};

const toneMap: Record<string, string> = {
	critical: "#dc2626",
	warning: "#d97706",
	info: "#2563eb",
};

export function ActivityBadge({ activity }: { activity: string }) {
	const colors: Record<string, string> = {
		working: "#22c55e",
		waiting_input: "#eab308",
		idle: "#6b7280",
		error: "#ef4444",
	};
	return (
		<span
			style={{
				display: "inline-block",
				width: 8,
				height: 8,
				borderRadius: "50%",
				backgroundColor: colors[activity] ?? "#6b7280",
				marginRight: 6,
			}}
		/>
	);
}

export function buttonStyle(primary: boolean): CSSProperties {
	return {
		padding: "6px 10px",
		borderRadius: 6,
		border: primary ? "none" : "1px solid var(--c-input-border)",
		background: primary ? "#2563eb" : "var(--c-bg)",
		color: primary ? "white" : "var(--c-text)",
		fontSize: 12,
		cursor: "pointer",
	};
}

export function SessionRail(props: {
	sessions: SessionSummary[];
	selectedSessionId: string | null;
	liveSessionId: string | null | undefined;
	liveActivity: string | undefined;
	liveRuntimeSource: string | null | undefined;
	provider: string | null | undefined;
	model: string | null | undefined;
	onSelect(sessionId: string): void;
	onAttach(sessionId: string): void;
}) {
	const { sessions, selectedSessionId, liveSessionId, liveActivity, liveRuntimeSource, provider, model, onSelect, onAttach } = props;
	return (
		<aside style={{ ...cardStyle, minHeight: 620 }}>
			<div style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text-secondary)", marginBottom: 10 }}>Session Rail</div>
			<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
				{sessions.map((session) => {
					const selected = session.id === selectedSessionId;
					const live = session.id === liveSessionId;
					return (
						<div
							key={session.id}
							style={{
								padding: 10,
								borderRadius: 8,
								border: selected ? "1px solid #2563eb" : "1px solid var(--c-border)",
								background: selected ? "#eff6ff" : "white",
							}}
						>
							<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
								{live && <ActivityBadge activity={liveActivity ?? "idle"} />}
								<strong style={{ fontSize: 12, color: "var(--c-text)" }}>{session.title || "Untitled"}</strong>
							</div>
							<div style={{ fontSize: 11, color: "var(--c-text-muted)" }}>{session.turns} turns</div>
							<div style={{ fontSize: 11, color: "var(--c-text-muted)", marginTop: 2 }}>
								{live ? `${provider ?? "unknown"} / ${model ?? "unknown"}` : "daemon session"}
							</div>
							{live && liveRuntimeSource && (
								<div style={{ fontSize: 11, color: "var(--c-text-muted)", marginTop: 2 }}>Source: {liveRuntimeSource}</div>
							)}
							<div style={{ fontSize: 11, color: "var(--c-text-dim)", marginTop: 2 }}>
								{new Date(session.timestamp).toLocaleString()}
							</div>
							<div style={{ display: "flex", gap: 8, marginTop: 8 }}>
								<button type="button" onClick={() => onSelect(session.id)} style={buttonStyle(false)}>
									Focus
								</button>
								<button type="button" onClick={() => onAttach(session.id)} style={buttonStyle(true)}>
									Attach
								</button>
							</div>
						</div>
					);
				})}
				{sessions.length === 0 && <div style={{ fontSize: 12, color: "var(--c-text-muted)" }}>No daemon-backed sessions available yet.</div>}
			</div>
		</aside>
	);
}

export function ActivityPane(props: {
	state: AgentState | null;
	repoDiff: RepoDiffSnapshot | null;
	selectedArtifactDetail: ArtifactDetail | null;
	onClearArtifact(): void;
	onExportArtifact(): void;
	onPromoteArtifact(): void;
	onInterrupt(): void;
	onRefresh(): void;
	onContinue(): void;
	onExtensionConfirm(): void;
	onExtensionCancel(): void;
	onExtensionPick(index: number): void;
	canContinue: boolean;
}) {
	const {
		state,
		repoDiff,
		selectedArtifactDetail,
		onClearArtifact,
		onExportArtifact,
		onPromoteArtifact,
		onInterrupt,
		onRefresh,
		onContinue,
		onExtensionConfirm,
		onExtensionCancel,
		onExtensionPick,
		canContinue,
	} = props;
	const extensionPrompt = state?.extensionUi?.prompt ?? null;
	const extensionWidgets = state?.extensionUi?.widgets ?? [];
	return (
		<main style={{ ...cardStyle, minHeight: 620 }}>
			{state ? (
				<>
					<div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
						<ActivityBadge activity={state.activity} />
						<strong>{state.activity}</strong>
						<span style={{ marginLeft: "auto", fontSize: 12, color: "var(--c-text-muted)" }}>
							PID {state.pid} · {state.provider ?? "unknown"} / {state.model ?? "no model"}
						</span>
					</div>
					<div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
						<button type="button" onClick={onInterrupt} style={buttonStyle(false)}>
							Interrupt
						</button>
						<button type="button" onClick={onRefresh} style={buttonStyle(false)}>
							Refresh
						</button>
						<button type="button" onClick={onContinue} disabled={!canContinue} style={{ ...buttonStyle(true), opacity: canContinue ? 1 : 0.5 }}>
							Continue
						</button>
					</div>
					{state.routing && (
						<div style={{ ...cardStyle, background: "var(--c-bg)", marginBottom: 12 }}>
							<div style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text-secondary)", marginBottom: 8 }}>Lane & Routing Board</div>
							<div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, fontSize: 12 }}>
								<div>Capability: <strong>{state.routing.capability ?? "unknown"}</strong></div>
								<div>Lane count: <strong>{state.routing.laneCount}</strong></div>
								<div>Authority: <strong>{state.routing.authority}</strong></div>
								<div>Enforcement: <strong>{state.routing.enforcement}</strong></div>
								<div style={{ gridColumn: "1 / -1" }}>
									Selected: <strong>{state.routing.selectedId ?? "local fallback"}</strong>
									{state.routing.degraded && <span style={{ color: "#dc2626", marginLeft: 8 }}>degraded</span>}
								</div>
								{state.routing.fallbackChain.length > 0 && <div style={{ gridColumn: "1 / -1", color: "var(--c-text-muted)" }}>Fallback chain: {state.routing.fallbackChain.join(" → ")}</div>}
								{state.routing.reason && <div style={{ gridColumn: "1 / -1", color: "var(--c-text-muted)" }}>Reason: {state.routing.reason}</div>}
							</div>
						</div>
					)}
					{state.toolsInFlight.length > 0 && <div style={{ fontSize: 13, color: "var(--c-text-secondary)", marginBottom: 8 }}>Tools: {state.toolsInFlight.join(", ")}</div>}
						{state.contextPercent != null && (
							<div style={{ marginBottom: 12 }}>
							<div style={{ fontSize: 12, color: "var(--c-text-muted)", marginBottom: 2 }}>Context: {Math.round(state.contextPercent)}%</div>
							<div style={{ height: 4, background: "#e5e7eb", borderRadius: 2 }}>
								<div style={{ height: 4, borderRadius: 2, width: `${Math.min(100, state.contextPercent)}%`, background: state.contextPercent > 80 ? "#ef4444" : "#22c55e" }} />
								</div>
							</div>
						)}
						{extensionPrompt && (
							<div style={{ ...cardStyle, background: "var(--c-bg)", marginBottom: 12 }}>
								<div style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text-secondary)", marginBottom: 8 }}>
									Extension Prompt
								</div>
								<div style={{ fontSize: 13, color: "var(--c-text)", marginBottom: 6 }}>
									{extensionPrompt.title ?? (extensionPrompt.kind === "confirm" ? "Confirm" : "Select")}
								</div>
								<div style={{ fontSize: 12, color: "var(--c-text-muted)", marginBottom: 10 }}>{extensionPrompt.message}</div>
								{extensionPrompt.kind === "pick" ? (
									<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
										{extensionPrompt.options.map((option) => (
											<button
												key={option.index}
												type="button"
												onClick={() => onExtensionPick(option.index)}
												style={{ ...buttonStyle(false), textAlign: "left" }}
											>
												<div style={{ fontWeight: 700 }}>{option.label}</div>
												{option.description && (
													<div style={{ fontSize: 11, color: "var(--c-text-muted)", marginTop: 2 }}>
														{option.description}
													</div>
												)}
											</button>
										))}
										<div style={{ fontSize: 11, color: "var(--c-text-muted)" }}>
											Showing {extensionPrompt.options.length} of {extensionPrompt.optionCount} options
										</div>
										<div>
											<button type="button" onClick={onExtensionCancel} style={buttonStyle(false)}>
												Cancel
											</button>
										</div>
									</div>
								) : (
									<div style={{ display: "flex", gap: 8 }}>
										<button type="button" onClick={onExtensionConfirm} style={buttonStyle(true)}>
											Confirm
										</button>
										<button type="button" onClick={onExtensionCancel} style={buttonStyle(false)}>
											Cancel
										</button>
									</div>
								)}
							</div>
						)}
						<div style={{ marginBottom: 16 }}>
							<div style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text-secondary)", marginBottom: 8 }}>Live Output</div>
							{state.lastAssistantText ? <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "#1f2937", margin: 0, maxHeight: 220, overflow: "auto" }}>{state.lastAssistantText}</pre> : <div style={{ fontSize: 12, color: "var(--c-text-muted)" }}>No live assistant output yet.</div>}
						</div>
						{extensionWidgets.length > 0 && (
							<div style={{ ...cardStyle, background: "var(--c-bg)", marginBottom: 16 }}>
								<div style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text-secondary)", marginBottom: 8 }}>
									Extension Widgets
								</div>
								<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
									{extensionWidgets.map((widget) => (
										<div key={widget.key} style={{ border: "1px solid var(--c-border)", borderRadius: 8, padding: 10 }}>
											<div style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text)", marginBottom: 6 }}>{widget.key}</div>
											<pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, color: "var(--c-text-secondary)" }}>
												{widget.previewLines.join("\n")}
											</pre>
											{widget.truncated && (
												<div style={{ fontSize: 11, color: "var(--c-text-muted)", marginTop: 6 }}>Preview truncated</div>
											)}
										</div>
									))}
								</div>
							</div>
						)}
						<ReviewSurface
							repoDiff={repoDiff}
							selectedArtifactDetail={selectedArtifactDetail}
						onClearArtifact={onClearArtifact}
						onExportArtifact={onExportArtifact}
						onPromoteArtifact={onPromoteArtifact}
					/>
				</>
			) : (
				<div style={{ color: "var(--c-text-muted)", textAlign: "center", padding: 48 }}>Waiting for connection…</div>
			)}
		</main>
	);
}

export function OperatorSidebar(props: {
	connected: boolean;
	selectedSessionId: string | null;
	state: AgentState | null;
	approvals: PendingApproval[];
	artifacts: ArtifactSummary[];
	alerts: OperatorAlert[];
	runtimes: RuntimeSummary[];
	sessionDetail: SessionDetail | null;
	onStartFresh(): void;
	onStartResumed(): void;
	onStopRuntime(runtimeId: string): void;
	onCopyRuntimeCommand(runtime: RuntimeSummary): void;
	onCopyRuntimeLog(runtime: RuntimeSummary): void;
	onCopyRuntimeCwd(runtime: RuntimeSummary): void;
	onApprove(id: string): void;
	onDeny(id: string): void;
	onSelectArtifact(artifactId: string): void;
	onAckAlert(id: string): void;
}) {
	const {
		connected,
		selectedSessionId,
		state,
		approvals,
		artifacts,
		alerts,
		runtimes,
		sessionDetail,
		onStartFresh,
		onStartResumed,
		onStopRuntime,
		onCopyRuntimeCommand,
		onCopyRuntimeLog,
		onCopyRuntimeCwd,
		onApprove,
		onDeny,
		onSelectArtifact,
		onAckAlert,
	} = props;
	return (
		<aside style={{ ...cardStyle, minHeight: 620 }}>
			<div style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text-secondary)", marginBottom: 8 }}>Operator Surface</div>
			<div style={{ ...cardStyle, background: "var(--c-bg)", marginBottom: 12 }}>
				<div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Launch Runtime</div>
				<div style={{ fontSize: 12, color: "var(--c-text-muted)", lineHeight: 1.5, marginBottom: 8 }}>Current desktop shell can broker new runtimes through an existing connected Takumi runtime.</div>
				<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
					<button type="button" onClick={onStartFresh} disabled={!connected} style={{ ...buttonStyle(true), opacity: connected ? 1 : 0.5 }}>Start fresh</button>
					<button type="button" onClick={onStartResumed} disabled={!connected || !selectedSessionId} style={{ ...buttonStyle(false), opacity: connected && selectedSessionId ? 1 : 0.5 }}>Start resumed</button>
				</div>
			</div>
			<div style={{ ...cardStyle, background: "var(--c-bg)", marginBottom: 12 }}>
				<div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Runtimes</div>
				{runtimes.length === 0 ? (
					<div style={{ fontSize: 12, color: "var(--c-text-muted)" }}>No locally tracked runtimes yet.</div>
				) : (
					<div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 280, overflow: "auto" }}>
						{runtimes.map((runtime) => {
							const commandText = runtime.command ? [runtime.command, ...(runtime.args ?? [])].join(" ") : null;
							return (
								<div key={runtime.runtimeId} style={{ border: "1px solid var(--c-border)", borderRadius: 8, padding: 10 }}>
									<div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
										<strong style={{ fontSize: 12, color: "var(--c-text)" }}>{runtime.runtimeId}</strong>
										<span style={{ fontSize: 11, color: runtime.state === "running" ? "#16a34a" : "#6b7280" }}>{runtime.state}</span>
									</div>
									<div style={{ fontSize: 11, color: "var(--c-text-muted)", marginTop: 4 }}>PID {runtime.pid} · {runtime.runtimeSource ?? "desktop"}</div>
									{runtime.sessionId && <div style={{ fontSize: 11, color: "var(--c-text-muted)", marginTop: 2 }}>Session: {runtime.sessionId}</div>}
									<div style={{ fontSize: 10, color: "var(--c-text-dim)", marginTop: 2 }}>{new Date(runtime.startedAt).toLocaleString()}</div>
									<div style={{ fontSize: 11, color: "var(--c-text-medium)", marginTop: 8, wordBreak: "break-all" }}>cwd: {runtime.cwd}</div>
									<div style={{ fontSize: 11, color: "var(--c-text-medium)", marginTop: 4, wordBreak: "break-all" }}>log: {runtime.logFile}</div>
									{commandText && <div style={{ fontSize: 11, color: "var(--c-text-medium)", marginTop: 4, wordBreak: "break-all" }}>cmd: {commandText}</div>}
									<div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
										<button type="button" onClick={() => onCopyRuntimeCwd(runtime)} style={buttonStyle(false)}>
											Copy cwd
										</button>
										<button type="button" onClick={() => onCopyRuntimeLog(runtime)} style={buttonStyle(false)}>
											Copy log
										</button>
										{commandText && (
											<button type="button" onClick={() => onCopyRuntimeCommand(runtime)} style={buttonStyle(false)}>
												Copy command
											</button>
										)}
										<button type="button" onClick={() => onStopRuntime(runtime.runtimeId)} style={buttonStyle(false)}>
											Stop
										</button>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
			<div style={{ ...cardStyle, background: "var(--c-bg)", marginBottom: 12 }}>
				<div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Approvals</div>
				{approvals.length === 0 ? <div style={{ fontSize: 12, color: "var(--c-text-muted)" }}>No pending approvals.</div> : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{approvals.map((approval) => <div key={approval.id} style={{ border: "1px solid var(--c-border)", borderRadius: 8, padding: 10 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}><span style={{ fontSize: 11, fontWeight: 700, color: approval.active ? "#2563eb" : "#6b7280", textTransform: "uppercase" }}>{approval.active ? "live" : approval.lane ?? "session"}</span><span style={{ fontSize: 10, color: "var(--c-text-dim)" }}>{new Date(approval.createdAt).toLocaleTimeString()}</span></div><div style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text)", marginBottom: 4 }}>{approval.tool}</div><div style={{ fontSize: 11, color: "var(--c-text-medium)", marginBottom: 8 }}>{approval.argsSummary}</div><div style={{ display: "flex", gap: 8 }}><button type="button" onClick={() => onApprove(approval.id)} style={buttonStyle(true)}>Approve</button><button type="button" onClick={() => onDeny(approval.id)} style={buttonStyle(false)}>Deny</button></div></div>)}</div>}
			</div>
			<div style={{ ...cardStyle, background: "var(--c-bg)", marginBottom: 12 }}>
				<div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Artifacts</div>
				{artifacts.length === 0 ? <div style={{ fontSize: 12, color: "var(--c-text-muted)" }}>No recorded artifacts for this session yet.</div> : <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflow: "auto" }}>{artifacts.map((artifact) => <button key={artifact.artifactId} type="button" onClick={() => onSelectArtifact(artifact.artifactId)} style={{ ...buttonStyle(false), textAlign: "left", padding: 10 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}><span style={{ fontSize: 11, fontWeight: 700, color: "#2563eb", textTransform: "uppercase" }}>{artifact.kind}</span><span style={{ fontSize: 10, color: "var(--c-text-dim)" }}>{new Date(artifact.createdAt).toLocaleTimeString()}</span></div><div style={{ fontSize: 12, color: "var(--c-text)" }}>{artifact.summary}</div><div style={{ fontSize: 10, color: "var(--c-text-muted)", marginTop: 4 }}>{artifact.producer}</div></button>)}</div>}
			</div>
			<div style={{ ...cardStyle, background: "var(--c-bg)", marginBottom: 12 }}>
				<div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Alerts</div>
				{alerts.length === 0 ? <div style={{ fontSize: 12, color: "var(--c-text-muted)" }}>No active operator alerts.</div> : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{alerts.map((alert) => <div key={alert.id} style={{ border: "1px solid var(--c-border)", borderRadius: 8, padding: 10 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}><span style={{ fontSize: 11, fontWeight: 700, color: toneMap[alert.severity] ?? "#374151", textTransform: "uppercase" }}>{alert.severity}</span><button type="button" onClick={() => onAckAlert(alert.id)} style={buttonStyle(false)}>Ack</button></div><div style={{ fontSize: 12, color: "var(--c-text)" }}>{alert.message}</div><div style={{ fontSize: 11, color: "var(--c-text-muted)", marginTop: 6 }}>{alert.kind}</div></div>)}</div>}
			</div>
			<div style={{ ...cardStyle, background: "var(--c-bg)" }}>
				<div style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text-secondary)", marginBottom: 8 }}>Session Detail</div>
				{sessionDetail ? <div style={{ display: "flex", flexDirection: "column", gap: 8 }}><div style={{ fontSize: 12, color: "var(--c-text)" }}>{sessionDetail.title}</div><div style={{ fontSize: 11, color: "var(--c-text-muted)" }}>{sessionDetail.turns.length} turns</div><div style={{ maxHeight: 320, overflow: "auto", display: "flex", flexDirection: "column", gap: 6 }}>{sessionDetail.turns.slice(-8).map((turn, index) => <div key={`${turn.timestamp}-${index}`} style={{ padding: 8, borderRadius: 6, background: "var(--c-bg-card)", border: "1px solid var(--c-border)" }}><div style={{ fontSize: 10, color: "var(--c-text-muted)", marginBottom: 4 }}>{turn.role}</div><div style={{ fontSize: 12, color: "#1f2937", whiteSpace: "pre-wrap" }}>{turn.content}</div></div>)}</div></div> : <div style={{ fontSize: 12, color: "var(--c-text-muted)" }}>{state?.sessionId ? "Loading session detail…" : "Select or attach a session from the rail."}</div>}
			</div>
		</aside>
	);
}
