import { type CSSProperties, useEffect, useMemo, useState } from "react";
import type { ArtifactDetail, RepoDiffSnapshot } from "../hooks/useAgentStream";

function actionButtonStyle(active = false): CSSProperties {
	return {
		padding: "6px 10px",
		borderRadius: 6,
		border: active ? "none" : "1px solid #d1d5db",
		background: active ? "#2563eb" : "white",
		color: active ? "white" : "#111827",
		fontSize: 12,
		cursor: "pointer",
	};
}

function DiffPreview({ title, diff }: { title: string; diff: string }) {
	if (!diff.trim()) {
		return <div style={{ fontSize: 12, color: "#6b7280" }}>No diff content available.</div>;
	}
	const lines = diff.split("\n").slice(0, 160);
	return (
		<div>
			<div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>{title}</div>
			<pre
				style={{
					whiteSpace: "pre-wrap",
					fontSize: 11,
					background: "#111827",
					color: "#e5e7eb",
					padding: 12,
					borderRadius: 8,
					maxHeight: 240,
					overflow: "auto",
					margin: 0,
				}}
			>
				{lines.map((line, index) => (
					<span
						key={`${title}-${index}-${line.slice(0, 8)}`}
						style={{
							color:
								line.startsWith("+") && !line.startsWith("+++")
									? "#86efac"
									: line.startsWith("-") && !line.startsWith("---")
										? "#fca5a5"
										: line.startsWith("@@")
											? "#93c5fd"
											: "#e5e7eb",
							display: "block",
						}}
					>
						{line}
					</span>
				))}
			</pre>
		</div>
	);
}

interface DiffSection {
	key: string;
	label: string;
	source: "staged" | "working";
	diff: string;
}

function parseDiffSections(diff: string, source: "staged" | "working"): DiffSection[] {
	if (!diff.trim()) return [];
	const lines = diff.split("\n");
	const sections: DiffSection[] = [];
	let currentLabel = source === "staged" ? "staged changes" : "working changes";
	let currentLines: string[] = [];

	const pushCurrent = () => {
		if (currentLines.length === 0) return;
		sections.push({
			key: `${source}:${currentLabel}:${sections.length}`,
			label: currentLabel,
			source,
			diff: currentLines.join("\n").trim(),
		});
	};

	for (const line of lines) {
		if (line.startsWith("diff --git ")) {
			pushCurrent();
			const match = / b\/(.+)$/.exec(line);
			currentLabel = match?.[1] ?? line.replace("diff --git ", "");
			currentLines = [line];
			continue;
		}
		currentLines.push(line);
	}
	pushCurrent();
	return sections;
}

function isDiffLike(text: string): boolean {
	return text.includes("diff --git") || text.includes("@@ ") || text.split("\n").some((line) => line.startsWith("+") || line.startsWith("-"));
}

export function ReviewSurface(props: {
	repoDiff: RepoDiffSnapshot | null;
	selectedArtifactDetail: ArtifactDetail | null;
	onClearArtifact(): void;
	onExportArtifact(): void;
	onPromoteArtifact(): void;
}) {
	const { repoDiff, selectedArtifactDetail, onClearArtifact, onExportArtifact, onPromoteArtifact } = props;
	const diffSections = useMemo(() => {
		if (!repoDiff) return [];
		return [...parseDiffSections(repoDiff.stagedDiff, "staged"), ...parseDiffSections(repoDiff.workingDiff, "working")];
	}, [repoDiff]);
	const [selectedDiffKey, setSelectedDiffKey] = useState<string | null>(null);
	useEffect(() => {
		setSelectedDiffKey(diffSections[0]?.key ?? null);
	}, [diffSections]);
	const selectedDiff = diffSections.find((section) => section.key === selectedDiffKey) ?? diffSections[0] ?? null;

	return (
		<div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
				<div style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>Review Surface</div>
				<div style={{ display: "flex", gap: 8 }}>
					{selectedArtifactDetail && (
						<>
							<button type="button" onClick={onPromoteArtifact} style={actionButtonStyle(false)}>
								{selectedArtifactDetail.promoted ? "Promoted" : "Promote"}
							</button>
							<button type="button" onClick={onExportArtifact} style={actionButtonStyle(false)}>
								Export artifact
							</button>
							<button type="button" onClick={onClearArtifact} style={actionButtonStyle(false)}>
								Show repo diff
							</button>
						</>
					)}
				</div>
			</div>
			{selectedArtifactDetail ? (
				<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
					<div style={{ fontSize: 12, color: "#6b7280" }}>
						{selectedArtifactDetail.kind} · {selectedArtifactDetail.producer} · {new Date(selectedArtifactDetail.createdAt).toLocaleString()}
						{selectedArtifactDetail.promoted ? " · promoted" : ""}
					</div>
					<div style={{ fontSize: 13, color: "#111827", fontWeight: 700 }}>{selectedArtifactDetail.summary}</div>
					{selectedArtifactDetail.body && isDiffLike(selectedArtifactDetail.body) ? (
						<DiffPreview title="Artifact diff" diff={selectedArtifactDetail.body} />
					) : selectedArtifactDetail.body ? (
						<pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#f9fafb", padding: 12, borderRadius: 8, margin: 0, maxHeight: 240, overflow: "auto" }}>
							{selectedArtifactDetail.body}
						</pre>
					) : (
						<div style={{ fontSize: 12, color: "#6b7280" }}>This artifact has summary metadata only.</div>
					)}
				</div>
			) : repoDiff ? (
				<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
					<div style={{ fontSize: 12, color: "#6b7280" }}>
						Branch: {repoDiff.branch ?? "unknown"} · {repoDiff.stagedFiles.length} staged · {repoDiff.modifiedFiles.length} modified · {repoDiff.untrackedFiles.length} untracked
					</div>
					{diffSections.length > 0 ? (
						<>
							<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
								{diffSections.map((section) => (
									<button
										key={section.key}
										type="button"
										onClick={() => setSelectedDiffKey(section.key)}
										style={{ ...actionButtonStyle(selectedDiffKey === section.key), textTransform: "none" }}
									>
										{section.label} · {section.source}
									</button>
								))}
							</div>
							{selectedDiff && <DiffPreview title={`${selectedDiff.label} (${selectedDiff.source})`} diff={selectedDiff.diff} />}
						</>
					) : (
						<DiffPreview title="Repo diff" diff={repoDiff.stagedDiff || repoDiff.workingDiff} />
					)}
					{repoDiff.untrackedFiles.length > 0 && <div style={{ fontSize: 12, color: "#6b7280" }}>Untracked: {repoDiff.untrackedFiles.join(", ")}</div>}
				</div>
			) : (
				<div style={{ fontSize: 12, color: "#6b7280" }}>Review state unavailable.</div>
			)}
		</div>
	);
}
