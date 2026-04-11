import type { SideAgentDispatchKind } from "@takumi/core";

export const SIDE_AGENT_READY_MARKER = "TAKUMI_SIDE_AGENT_READY";
export const SIDE_AGENT_DISPATCH_MARKER = "TAKUMI_SIDE_AGENT_DISPATCH";
export const SIDE_AGENT_DISPATCH_CLOSE_MARKER = "[/TAKUMI_SIDE_AGENT_DISPATCH]";
export const SIDE_AGENT_RUN_MARKER = "TAKUMI_SIDE_AGENT_RUN";

export interface SideAgentDispatchHeader {
	id: string;
	seq: number;
	kind: SideAgentDispatchKind;
	requestId: string | null;
	format: string | null;
}

export interface SideAgentDispatchEnvelope extends SideAgentDispatchHeader {
	prompt: string;
}

export interface SideAgentReadyMarker {
	id: string;
	ts: number | null;
}

export interface SideAgentRunMarker {
	id: string;
	seq: number;
	kind: SideAgentDispatchKind;
	requestId: string | null;
	status: "begin" | "exit";
	code: number | null;
	ts: number | null;
	line: string;
}

export interface SideAgentRunSummary {
	latestSequence: number;
	latestBegin: SideAgentRunMarker | null;
	latestExit: SideAgentRunMarker | null;
	lastCompleted: SideAgentRunMarker | null;
	busy: boolean;
}

const DISPATCH_HEADER_PATTERN = new RegExp(
	`^\\[${SIDE_AGENT_DISPATCH_MARKER} id=([^\\s\\]]+) seq=(\\d+) kind=(start|send|query)(?: request=([^\\s\\]]+))?(?: format=([^\\s\\]]+))?\\]$`,
);
const READY_MARKER_PATTERN = new RegExp(`\\[${SIDE_AGENT_READY_MARKER} id=([^\\s\\]]+)(?: ts=(\\d+))?\\]`, "g");
const RUN_MARKER_PATTERN = new RegExp(
	`^\\[${SIDE_AGENT_RUN_MARKER} id=([^\\s\\]]+) seq=(\\d+) kind=(start|send|query)(?: request=([^\\s\\]]+))? status=(begin|exit)(?: code=(-?\\d+))?(?: ts=(\\d+))?\\]$`,
	"gm",
);

/**
 * I keep the worker envelope line-oriented so tmux/process orchestrators can
 * deliver multi-line prompts without inventing a second transport.
 */
export function buildSideAgentDispatchEnvelope(input: SideAgentDispatchEnvelope): string {
	const header = `${[
		`[${SIDE_AGENT_DISPATCH_MARKER}`,
		`id=${input.id}`,
		`seq=${input.seq}`,
		`kind=${input.kind}`,
		...(input.requestId ? [`request=${input.requestId}`] : []),
		...(input.format ? [`format=${input.format}`] : []),
	].join(" ")}]`;
	const prompt = input.prompt.replace(/\r\n/g, "\n").trimEnd();
	return [header, prompt, SIDE_AGENT_DISPATCH_CLOSE_MARKER].join("\n");
}

export function parseSideAgentDispatchHeader(line: string): SideAgentDispatchHeader | null {
	const match = line.trim().match(DISPATCH_HEADER_PATTERN);
	if (!match) {
		return null;
	}
	const sequence = Number.parseInt(match[2], 10);
	if (!Number.isFinite(sequence)) {
		return null;
	}
	return {
		id: match[1],
		seq: sequence,
		kind: match[3] as SideAgentDispatchKind,
		requestId: match[4] ?? null,
		format: match[5] ?? null,
	};
}

export function formatSideAgentReadyMarker(input: { id: string; ts?: number }): string {
	return `[${SIDE_AGENT_READY_MARKER} id=${input.id} ts=${input.ts ?? Date.now()}]`;
}

export function findSideAgentReadyMarker(output: string, id?: string): SideAgentReadyMarker | null {
	const matches = [...output.matchAll(READY_MARKER_PATTERN)];
	for (let index = matches.length - 1; index >= 0; index -= 1) {
		const match = matches[index];
		if (id && match[1] !== id) {
			continue;
		}
		return {
			id: match[1],
			ts: match[2] ? Number.parseInt(match[2], 10) : null,
		};
	}
	return null;
}

export function formatSideAgentRunMarker(input: {
	id: string;
	seq: number;
	kind: SideAgentDispatchKind;
	status: "begin" | "exit";
	requestId?: string | null;
	code?: number | null;
	ts?: number;
}): string {
	const parts = [
		`[${SIDE_AGENT_RUN_MARKER}`,
		`id=${input.id}`,
		`seq=${input.seq}`,
		`kind=${input.kind}`,
		...(input.requestId ? [`request=${input.requestId}`] : []),
		`status=${input.status}`,
		...(typeof input.code === "number" ? [`code=${input.code}`] : []),
		`ts=${input.ts ?? Date.now()}`,
	];
	return `${parts.join(" ")}]`;
}

export function extractSideAgentRunMarkers(output: string, id?: string): SideAgentRunMarker[] {
	const markers: SideAgentRunMarker[] = [];
	for (const match of output.matchAll(RUN_MARKER_PATTERN)) {
		if (id && match[1] !== id) {
			continue;
		}
		markers.push({
			id: match[1],
			seq: Number.parseInt(match[2], 10),
			kind: match[3] as SideAgentDispatchKind,
			requestId: match[4] ?? null,
			status: match[5] as "begin" | "exit",
			code: match[6] ? Number.parseInt(match[6], 10) : null,
			ts: match[7] ? Number.parseInt(match[7], 10) : null,
			line: match[0],
		});
	}
	return markers;
}

export function summarizeSideAgentRuns(output: string, id?: string): SideAgentRunSummary {
	const markers = extractSideAgentRunMarkers(output, id);
	if (markers.length === 0) {
		return {
			latestSequence: 0,
			latestBegin: null,
			latestExit: null,
			lastCompleted: null,
			busy: false,
		};
	}

	const bySequence = new Map<number, { begin: SideAgentRunMarker | null; exit: SideAgentRunMarker | null }>();
	let latestSequence = 0;
	for (const marker of markers) {
		latestSequence = Math.max(latestSequence, marker.seq);
		const current = bySequence.get(marker.seq) ?? { begin: null, exit: null };
		if (marker.status === "begin") {
			current.begin = marker;
		} else {
			current.exit = marker;
		}
		bySequence.set(marker.seq, current);
	}

	const latest = bySequence.get(latestSequence) ?? { begin: null, exit: null };
	const completed = [...bySequence.entries()]
		.map((entry) => entry[1].exit)
		.filter((marker): marker is SideAgentRunMarker => Boolean(marker))
		.sort((left, right) => (left.seq === right.seq ? (left.ts ?? 0) - (right.ts ?? 0) : left.seq - right.seq));
	const latestBeginTs = latest.begin?.ts ?? 0;
	const latestExitTs = latest.exit?.ts ?? -1;

	return {
		latestSequence,
		latestBegin: latest.begin,
		latestExit: latest.exit,
		lastCompleted: completed.at(-1) ?? null,
		busy: Boolean(latest.begin && latestExitTs < latestBeginTs),
	};
}
