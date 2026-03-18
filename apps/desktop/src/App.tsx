import { type FormEvent, useCallback, useMemo, useRef, useState } from "react";
import { ActivityPane, OperatorSidebar, SessionRail, cardStyle } from "./components/build-window-panels";
import { useAgentStream } from "./hooks/useAgentStream";

export function App() {
	const {
		state,
		sessions,
		sessionDetail,
		fleet,
		alerts,
		approvals,
		artifacts,
		connected,
		decideApproval,
		error,
		fetchArtifactDetail,
		promoteArtifact,
		repoDiff,
		refreshAgent,
		runtimes,
		sendMessage,
		startRuntime,
		stopRuntime,
		interruptAgent,
		loadSessionDetail,
		attachSession,
		acknowledgeAlert,
	} = useAgentStream();
	const [input, setInput] = useState("");
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
	const [attachNotice, setAttachNotice] = useState<string | null>(null);
	const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
	const [selectedArtifactDetail, setSelectedArtifactDetail] = useState<Awaited<ReturnType<typeof fetchArtifactDetail>>>(null);
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
			{
				label: "Approvals",
				value: approvals.length > 0 ? `${approvals.length} pending` : "clear",
				accent: approvals.length > 0 ? "#d97706" : "#16a34a",
			},
		],
		[alerts.length, approvals.length, fleet, state],
	);
	const canContinue = approvals.length > 0;

	const handleSelectSession = useCallback(
		(sessionId: string) => {
			setSelectedSessionId(sessionId);
			setAttachNotice(null);
			setSelectedArtifactId(null);
			setSelectedArtifactDetail(null);
			void loadSessionDetail(sessionId);
		},
		[loadSessionDetail],
	);

	const handleAttachSession = useCallback(
		async (sessionId: string) => {
			const ok = await attachSession(sessionId);
			setSelectedSessionId(sessionId);
			setSelectedArtifactId(null);
			setSelectedArtifactDetail(null);
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

	const handleSelectArtifact = useCallback(
		async (artifactId: string) => {
			setSelectedArtifactId(artifactId);
			const detail = await fetchArtifactDetail(artifactId);
			setSelectedArtifactDetail(detail);
		},
		[fetchArtifactDetail],
	);

	const handleStartRuntime = useCallback(
		async (resume: boolean) => {
			const runtime = await startRuntime(resume && selectedSession ? { sessionId: selectedSession } : undefined);
			if (!runtime) {
				setAttachNotice("Could not start a new local runtime.");
				return;
			}
			setAttachNotice(`Started runtime ${runtime.runtimeId} (${runtime.pid}).`);
		},
		[selectedSession, startRuntime],
	);

	const handleInterrupt = useCallback(async () => {
		if (!state) return;
		const ok = await interruptAgent(state.pid);
		setAttachNotice(ok ? `Interrupted agent PID ${state.pid}.` : `Could not interrupt agent PID ${state.pid}.`);
	}, [interruptAgent, state]);

	const handleRefresh = useCallback(async () => {
		if (!state) return;
		const ok = await refreshAgent(state.pid);
		setAttachNotice(ok ? `Refreshed agent PID ${state.pid}.` : `Could not refresh agent PID ${state.pid}.`);
	}, [refreshAgent, state]);

	const handleContinue = useCallback(async () => {
		const approval = approvals[0];
		if (!approval) return;
		const ok = await decideApproval(approval.id, "approve");
		setAttachNotice(ok ? `Approved ${approval.tool} and resumed flow.` : `Could not continue approval ${approval.id}.`);
	}, [approvals, decideApproval]);

	const handleExportArtifact = useCallback(() => {
		if (!selectedArtifactDetail) {
			setAttachNotice("No artifact selected to export.");
			return;
		}
		try {
			const blob = new Blob([JSON.stringify(selectedArtifactDetail, null, 2)], { type: "application/json" });
			const url = window.URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `${selectedArtifactDetail.artifactId}.json`;
			document.body.append(link);
			link.click();
			link.remove();
			window.URL.revokeObjectURL(url);
			setAttachNotice(`Exported artifact ${selectedArtifactDetail.artifactId}.`);
		} catch {
			setAttachNotice(`Could not export artifact ${selectedArtifactDetail.artifactId}.`);
		}
	}, [selectedArtifactDetail]);

	const handlePromoteArtifact = useCallback(async () => {
		if (!selectedArtifactDetail) {
			setAttachNotice("No artifact selected to promote.");
			return;
		}
		const ok = await promoteArtifact(selectedArtifactDetail.artifactId, true);
		if (!ok) {
			setAttachNotice(`Could not promote artifact ${selectedArtifactDetail.artifactId}.`);
			return;
		}
		setSelectedArtifactDetail((current) => (current ? { ...current, promoted: true } : current));
		setAttachNotice(`Promoted artifact ${selectedArtifactDetail.artifactId}.`);
	}, [promoteArtifact, selectedArtifactDetail]);

	const handleCopyText = useCallback(async (label: string, value?: string | null) => {
		if (!value) {
			setAttachNotice(`No ${label} available to copy.`);
			return;
		}
		try {
			await navigator.clipboard.writeText(value);
			setAttachNotice(`Copied ${label}.`);
		} catch {
			setAttachNotice(`Could not copy ${label}.`);
		}
	}, []);

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

			<div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12, marginBottom: 16 }}>
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
				<SessionRail
					sessions={sessions}
					selectedSessionId={selectedSession}
					liveSessionId={state?.sessionId}
					liveActivity={state?.activity}
					liveRuntimeSource={state?.runtimeSource}
					provider={state?.provider}
					model={state?.model}
					onSelect={handleSelectSession}
					onAttach={(sessionId) => void handleAttachSession(sessionId)}
				/>

				<ActivityPane
					state={state}
					repoDiff={repoDiff}
					selectedArtifactDetail={selectedArtifactDetail}
					onClearArtifact={() => {
						setSelectedArtifactId(null);
						setSelectedArtifactDetail(null);
					}}
					onExportArtifact={handleExportArtifact}
					onPromoteArtifact={() => void handlePromoteArtifact()}
					onInterrupt={() => void handleInterrupt()}
					onRefresh={() => void handleRefresh()}
					onContinue={() => void handleContinue()}
					canContinue={canContinue}
				/>

				<OperatorSidebar
					connected={connected}
					selectedSessionId={selectedSession}
					state={state}
					approvals={approvals}
					artifacts={artifacts}
					alerts={alerts}
					runtimes={runtimes}
					sessionDetail={sessionDetail}
					onStartFresh={() => void handleStartRuntime(false)}
					onStartResumed={() => void handleStartRuntime(true)}
					onStopRuntime={(runtimeId) => void stopRuntime(runtimeId)}
					onCopyRuntimeCommand={(runtime) => void handleCopyText("runtime command", runtime.command ? [runtime.command, ...(runtime.args ?? [])].join(" ") : null)}
					onCopyRuntimeLog={(runtime) => void handleCopyText("runtime log path", runtime.logFile)}
					onCopyRuntimeCwd={(runtime) => void handleCopyText("runtime working directory", runtime.cwd)}
					onApprove={(approvalId) => void decideApproval(approvalId, "approve")}
					onDeny={(approvalId) => void decideApproval(approvalId, "deny")}
					onSelectArtifact={(artifactId) => void handleSelectArtifact(artifactId)}
					onAckAlert={(alertId) => void acknowledgeAlert(alertId)}
				/>
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
