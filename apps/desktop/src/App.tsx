import { type CSSProperties, type FormEvent, useCallback, useMemo, useRef, useState } from "react";
import { useAgentStream } from "./hooks/useAgentStream";

const cardStyle: CSSProperties = {
	background: "#f9fafb",
	border: "1px solid #e5e7eb",
	borderRadius: 10,
	padding: 14,
};

const toneMap: Record<string, string> = {
	critical: "#dc2626",
	warning: "#d97706",
	info: "#2563eb",
};

function ActivityBadge({ activity }: { activity: string }) {
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

export function App() {
	const {
		state,
		sessions,
		sessionDetail,
		fleet,
		alerts,
		connected,
		error,
		sendMessage,
		loadSessionDetail,
		attachSession,
		acknowledgeAlert,
	} = useAgentStream();
	const [input, setInput] = useState("");
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
	const [attachNotice, setAttachNotice] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const selectedSession = selectedSessionId ?? state?.sessionId ?? sessions[0]?.id ?? null;
	const healthItems = useMemo(
		() => [
			{
				label: "Daemon",
				value: state?.bridgeConnected ? "connected" : "degraded",
				accent: state?.bridgeConnected ? "#16a34a" : "#dc2626",
			},
			{
				label: "Context",
				value: state?.contextPercent != null ? `${Math.round(state.contextPercent)}% · ${state.contextPressure ?? "normal"}` : "unknown",
				accent: state?.contextPercent && state.contextPercent >= 85 ? "#dc2626" : "#2563eb",
			},
			{
				label: "Routing",
				value: state?.routing ? `${state.routing.authority} / ${state.routing.enforcement}` : "no lanes yet",
				accent: state?.routing?.degraded ? "#dc2626" : "#2563eb",
			},
			{
				label: "Alerts",
				value: fleet ? `${fleet.alertCounts.critical} critical · ${fleet.alertCounts.warning} warning` : "none",
				accent: alerts.length > 0 ? "#d97706" : "#16a34a",
			},
		],
		[alerts.length, fleet, state],
	);

	const handleSelectSession = useCallback(
		(sessionId: string) => {
			setSelectedSessionId(sessionId);
			setAttachNotice(null);
			void loadSessionDetail(sessionId);
		},
		[loadSessionDetail],
	);

	const handleAttachSession = useCallback(
		async (sessionId: string) => {
			const ok = await attachSession(sessionId);
			setSelectedSessionId(sessionId);
			setAttachNotice(ok ? `Attached Build Window to session ${sessionId}.` : `Could not attach session ${sessionId}.`);
			if (ok) {
				await loadSessionDetail(sessionId);
			}
		},
		[attachSession, loadSessionDetail],
	);

	const handleSubmit = useCallback(
		(e: FormEvent) => {
			e.preventDefault();
			const text = input.trim();
			if (!text) return;
			sendMessage(text);
			setInput("");
			inputRef.current?.focus();
		},
		[input, sendMessage],
	);

	return (
		<div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 1320, margin: "0 auto", padding: 24, color: "#111827" }}>
			<header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
				<div>
					<h1 style={{ margin: 0, fontSize: 24 }}>Takumi Build Window</h1>
					<div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
						Attachable operator shell for terminal-first and daemon-backed Takumi sessions
					</div>
				</div>
				<span style={{ fontSize: 12, color: connected ? "#22c55e" : "#ef4444" }}>
					{connected ? "Connected" : "Disconnected"}
				</span>
				{fleet && (
					<span style={{ fontSize: 12, color: "#6b7280" }}>
						{fleet.workingAgents}/{fleet.totalAgents} active · ${fleet.totalCostUsd.toFixed(4)}
					</span>
				)}
				{state?.runtimeSource && (
					<span style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280" }}>Source: {state.runtimeSource}</span>
				)}
			</header>

			{error && (
				<div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: 12, marginBottom: 16, color: "#991b1b" }}>
					{error}
				</div>
			)}

			{attachNotice && (
				<div style={{ ...cardStyle, marginBottom: 16, background: "#eff6ff", borderColor: "#bfdbfe", color: "#1d4ed8" }}>
					{attachNotice}
				</div>
			)}

			<div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 16 }}>
				{healthItems.map((item) => (
					<div key={item.label} style={cardStyle}>
						<div style={{ fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase", color: "#6b7280", marginBottom: 6 }}>
							{item.label}
						</div>
						<div style={{ color: item.accent, fontWeight: 700, fontSize: 14 }}>{item.value}</div>
					</div>
				))}
			</div>

			<div style={{ display: "grid", gridTemplateColumns: "300px minmax(0, 1fr) 320px", gap: 16, marginBottom: 16 }}>
				<aside style={{ ...cardStyle, minHeight: 620 }}>
					<div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 10 }}>Session Rail</div>
					<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
						{sessions.map((session) => {
							const selected = session.id === selectedSession;
							const live = session.id === state?.sessionId;
							return (
								<div
									key={session.id}
									style={{
										padding: 10,
										borderRadius: 8,
										border: selected ? "1px solid #2563eb" : "1px solid #e5e7eb",
										background: selected ? "#eff6ff" : "white",
									}}
								>
									<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
										{live && <ActivityBadge activity={state?.activity ?? "idle"} />}
										<strong style={{ fontSize: 12, color: "#111827" }}>{session.title || "Untitled"}</strong>
									</div>
									<div style={{ fontSize: 11, color: "#6b7280" }}>{session.turns} turns</div>
									<div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
										{live ? `${state?.provider ?? "unknown"} / ${state?.model ?? "unknown"}` : "daemon session"}
									</div>
									<div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
										{new Date(session.timestamp).toLocaleString()}
									</div>
									<div style={{ display: "flex", gap: 8, marginTop: 8 }}>
										<button type="button" onClick={() => handleSelectSession(session.id)} style={buttonStyle(false)}>
											Focus
										</button>
										<button type="button" onClick={() => void handleAttachSession(session.id)} style={buttonStyle(true)}>
											Attach
										</button>
									</div>
								</div>
							);
						})}
						{sessions.length === 0 && (
							<div style={{ fontSize: 12, color: "#6b7280" }}>No daemon-backed sessions available yet.</div>
						)}
					</div>
				</aside>

				<main style={{ ...cardStyle, minHeight: 620 }}>
					{state ? (
						<>
							<div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
								<ActivityBadge activity={state.activity} />
								<strong>{state.activity}</strong>
								<span style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280" }}>
									PID {state.pid} · {state.provider ?? "unknown"} / {state.model ?? "no model"}
								</span>
							</div>

							{state.routing && (
								<div style={{ ...cardStyle, background: "white", marginBottom: 12 }}>
									<div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>Lane & Routing Board</div>
									<div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, fontSize: 12 }}>
										<div>Capability: <strong>{state.routing.capability ?? "unknown"}</strong></div>
										<div>Lane count: <strong>{state.routing.laneCount}</strong></div>
										<div>Authority: <strong>{state.routing.authority}</strong></div>
										<div>Enforcement: <strong>{state.routing.enforcement}</strong></div>
										<div style={{ gridColumn: "1 / -1" }}>
											Selected: <strong>{state.routing.selectedId ?? "local fallback"}</strong>
											{state.routing.degraded && <span style={{ color: "#dc2626", marginLeft: 8 }}>degraded</span>}
										</div>
										{state.routing.fallbackChain.length > 0 && (
											<div style={{ gridColumn: "1 / -1", color: "#6b7280" }}>
												Fallback chain: {state.routing.fallbackChain.join(" → ")}
											</div>
										)}
										{state.routing.reason && (
											<div style={{ gridColumn: "1 / -1", color: "#6b7280" }}>Reason: {state.routing.reason}</div>
										)}
									</div>
								</div>
							)}

							{state.toolsInFlight.length > 0 && (
								<div style={{ fontSize: 13, color: "#374151", marginBottom: 8 }}>
									Tools: {state.toolsInFlight.join(", ")}
								</div>
							)}

							{state.contextPercent != null && (
								<div style={{ marginBottom: 12 }}>
									<div style={{ fontSize: 12, color: "#6b7280", marginBottom: 2 }}>
										Context: {Math.round(state.contextPercent)}%
									</div>
									<div style={{ height: 4, background: "#e5e7eb", borderRadius: 2 }}>
										<div
											style={{
												height: 4,
												borderRadius: 2,
												width: `${Math.min(100, state.contextPercent)}%`,
												background: state.contextPercent > 80 ? "#ef4444" : "#22c55e",
											}}
										/>
									</div>
								</div>
							)}

							<div>
									<div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>Live Output</div>
									{state.lastAssistantText ? (
										<pre style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "#1f2937", margin: 0, maxHeight: 360, overflow: "auto" }}>
											{state.lastAssistantText}
										</pre>
									) : (
										<div style={{ fontSize: 12, color: "#6b7280" }}>No live assistant output yet.</div>
									)}
							</div>
						</>
					) : (
						<div style={{ color: "#6b7280", textAlign: "center", padding: 48 }}>
							{connected ? "No agent running" : "Waiting for connection…"}
						</div>
					)}
				</main>

				<aside style={{ ...cardStyle, minHeight: 620 }}>
					<div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>Operator Surface</div>

					<div style={{ ...cardStyle, background: "white", marginBottom: 12 }}>
						<div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Attach / Start Flow</div>
						<div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>
							<div>1. Start Takumi in terminal with the daemon connected.</div>
							<div>2. This Build Window discovers sessions from the local bridge and daemon.</div>
							<div>3. Use <strong>Attach</strong> from the session rail to inspect or resume the operator view.</div>
						</div>
						<pre style={{ whiteSpace: "pre-wrap", fontSize: 11, margin: "10px 0 0", color: "#1f2937" }}>
pnpm takumi
pnpm --dir apps/desktop dev
						</pre>
					</div>

					<div style={{ ...cardStyle, background: "white", marginBottom: 12 }}>
						<div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Alerts</div>
						{alerts.length === 0 ? (
							<div style={{ fontSize: 12, color: "#6b7280" }}>No active operator alerts.</div>
						) : (
							<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
								{alerts.map((alert) => (
									<div key={alert.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>
										<div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
											<span style={{ fontSize: 11, fontWeight: 700, color: toneMap[alert.severity] ?? "#374151", textTransform: "uppercase" }}>
												{alert.severity}
											</span>
											<button type="button" onClick={() => void acknowledgeAlert(alert.id)} style={buttonStyle(false)}>
												Ack
											</button>
										</div>
										<div style={{ fontSize: 12, color: "#111827" }}>{alert.message}</div>
										<div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>{alert.kind}</div>
									</div>
								))}
							</div>
						)}
					</div>

					<div style={{ ...cardStyle, background: "white" }}>
						<div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>Session Detail</div>
						{sessionDetail ? (
							<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
								<div style={{ fontSize: 12, color: "#111827" }}>{sessionDetail.title}</div>
								<div style={{ fontSize: 11, color: "#6b7280" }}>{sessionDetail.turns.length} turns</div>
								<div style={{ maxHeight: 320, overflow: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
									{sessionDetail.turns.slice(-8).map((turn, index) => (
										<div key={`${turn.timestamp}-${index}`} style={{ padding: 8, borderRadius: 6, background: "#f9fafb", border: "1px solid #e5e7eb" }}>
											<div style={{ fontSize: 10, color: "#6b7280", marginBottom: 4 }}>{turn.role}</div>
											<div style={{ fontSize: 12, color: "#1f2937", whiteSpace: "pre-wrap" }}>{turn.content}</div>
										</div>
									))}
								</div>
							</div>
						) : (
							<div style={{ fontSize: 12, color: "#6b7280" }}>
								{selectedSession ? "Loading session detail…" : "Select or attach a session from the rail."}
							</div>
						)}
					</div>
				</aside>
			</div>

			<form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
				<input
					ref={inputRef}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					placeholder="Send a message to the agent…"
					disabled={!connected || state?.activity === "working"}
					style={{
						flex: 1,
						padding: "8px 12px",
						borderRadius: 6,
						border: "1px solid #d1d5db",
						fontSize: 14,
						outline: "none",
					}}
				/>
				<button
					type="submit"
					disabled={!connected || !input.trim() || state?.activity === "working"}
					style={{
						padding: "8px 16px",
						borderRadius: 6,
						border: "none",
						background: "#2563eb",
						color: "white",
						fontSize: 14,
						cursor: "pointer",
						opacity: !connected || !input.trim() ? 0.5 : 1,
					}}
				>
					Send
				</button>
			</form>
		</div>
	);
}

function buttonStyle(primary: boolean): CSSProperties {
	return {
		padding: "6px 10px",
		borderRadius: 6,
		border: primary ? "none" : "1px solid #d1d5db",
		background: primary ? "#2563eb" : "white",
		color: primary ? "white" : "#111827",
		fontSize: 12,
		cursor: "pointer",
	};
}
