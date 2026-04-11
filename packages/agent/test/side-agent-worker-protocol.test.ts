import { describe, expect, it } from "vitest";
import {
	buildSideAgentDispatchEnvelope,
	findSideAgentReadyMarker,
	formatSideAgentReadyMarker,
	formatSideAgentRunMarker,
	parseSideAgentDispatchHeader,
	summarizeSideAgentRuns,
} from "../src/tools/side-agent-worker-protocol.js";

describe("side-agent-worker-protocol", () => {
	it("builds and parses line-oriented dispatch envelopes", () => {
		const envelope = buildSideAgentDispatchEnvelope({
			id: "side-9",
			seq: 4,
			kind: "query",
			requestId: "req-4",
			format: "json",
			prompt: "line one\nline two",
		});
		const [header] = envelope.split("\n", 1);

		expect(header).toBe("[TAKUMI_SIDE_AGENT_DISPATCH id=side-9 seq=4 kind=query request=req-4 format=json]");
		expect(parseSideAgentDispatchHeader(header)).toEqual({
			id: "side-9",
			seq: 4,
			kind: "query",
			requestId: "req-4",
			format: "json",
		});
		expect(envelope).toContain("line one\nline two");
	});

	it("finds the latest ready marker for the requested lane", () => {
		const output = [
			formatSideAgentReadyMarker({ id: "side-1", ts: 10 }),
			formatSideAgentReadyMarker({ id: "side-2", ts: 20 }),
			formatSideAgentReadyMarker({ id: "side-1", ts: 30 }),
		].join("\n");

		expect(findSideAgentReadyMarker(output, "side-1")).toEqual({ id: "side-1", ts: 30 });
		expect(findSideAgentReadyMarker(output, "side-2")).toEqual({ id: "side-2", ts: 20 });
	});

	it("summarizes busy and completed runs from marker output", () => {
		const completedOutput = [
			formatSideAgentRunMarker({ id: "side-3", seq: 1, kind: "start", status: "begin", ts: 100 }),
			formatSideAgentRunMarker({ id: "side-3", seq: 1, kind: "start", status: "exit", code: 0, ts: 200 }),
		].join("\n");
		const busyOutput = [
			completedOutput,
			formatSideAgentRunMarker({ id: "side-3", seq: 2, kind: "query", requestId: "req-2", status: "begin", ts: 300 }),
		].join("\n");

		expect(summarizeSideAgentRuns(completedOutput, "side-3")).toMatchObject({
			latestSequence: 1,
			busy: false,
			lastCompleted: expect.objectContaining({ seq: 1, code: 0 }),
		});
		expect(summarizeSideAgentRuns(busyOutput, "side-3")).toMatchObject({
			latestSequence: 2,
			busy: true,
			latestBegin: expect.objectContaining({ seq: 2, requestId: "req-2" }),
			lastCompleted: expect.objectContaining({ seq: 1, code: 0 }),
		});
	});
});
