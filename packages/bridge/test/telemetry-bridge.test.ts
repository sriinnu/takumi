import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChitraguptaBridge } from "../src/chitragupta.js";
import type { AgentTelemetry } from "../src/chitragupta-types.js";

describe("ChitraguptaBridge — Telemetry (Phase 20.2)", () => {
	let bridge: ChitraguptaBridge;
	let tempDir: string;
	let originalTelemetryDir: string | undefined;

	beforeEach(async () => {
		// Use a temporary directory for testing
		tempDir = path.join(os.tmpdir(), `takumi-test-${Date.now()}`);
		originalTelemetryDir = process.env.TAKUMI_TELEMETRY_DIR;
		process.env.TAKUMI_TELEMETRY_DIR = tempDir;

		bridge = new ChitraguptaBridge({ transport: "stdio" });
	});

	afterEach(async () => {
		// Cleanup temp directory
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}

		// Restore original env
		if (originalTelemetryDir !== undefined) {
			process.env.TAKUMI_TELEMETRY_DIR = originalTelemetryDir;
		} else {
			delete process.env.TAKUMI_TELEMETRY_DIR;
		}
	});

	describe("telemetryHeartbeat", () => {
		it("creates telemetry file with correct structure", async () => {
			const data: Partial<AgentTelemetry> = {
				process: {
					pid: process.pid,
					ppid: process.ppid || 0,
					uptime: 123,
					heartbeatAt: Date.now(),
					startedAt: Date.now() - 123000,
				},
				state: {
					activity: "working",
					idle: false,
					idleSince: null,
				},
			};

			await bridge.telemetryHeartbeat(data, tempDir);

			const telemetryFile = path.join(tempDir, `${process.pid}.json`);
			const content = await fs.readFile(telemetryFile, "utf-8");
			const parsed = JSON.parse(content);

			expect(parsed.schemaVersion).toBe(2);
			expect(parsed.process.pid).toBe(process.pid);
			expect(parsed.state.activity).toBe("working");
		});

		it("persists cognition payloads when provided", async () => {
			await bridge.telemetryHeartbeat(
				{
					process: {
						pid: process.pid,
						ppid: process.ppid || 0,
						uptime: 123,
						heartbeatAt: Date.now(),
						startedAt: Date.now() - 123000,
					},
					state: {
						activity: "working",
						idle: false,
						idleSince: null,
					},
					cognition: {
						stance: "watchful",
						workspaceMode: "stabilize",
						dominantSignal: "prediction",
						dominantSummary: "predicted failure risk around edit router",
						directiveBacklog: 2,
						signalCount: 3,
					},
				},
				tempDir,
			);

			const telemetryFile = path.join(tempDir, `${process.pid}.json`);
			const content = await fs.readFile(telemetryFile, "utf-8");
			const parsed = JSON.parse(content);

			expect(parsed.cognition).toMatchObject({
				stance: "watchful",
				workspaceMode: "stabilize",
				directiveBacklog: 2,
				signalCount: 3,
			});
		});

		it("merges multiple heartbeats correctly", async () => {
			await bridge.telemetryHeartbeat(
				{
					process: {
						pid: process.pid,
						ppid: 0,
						uptime: 100,
						heartbeatAt: 1000,
						startedAt: 0,
					},
				},
				tempDir,
			);

			await bridge.telemetryHeartbeat(
				{
					state: {
						activity: "idle",
						idle: true,
						idleSince: 1500,
					},
				},
				tempDir,
			);

			const telemetryFile = path.join(tempDir, `${process.pid}.json`);
			const content = await fs.readFile(telemetryFile, "utf-8");
			const parsed = JSON.parse(content);

			// Both fields should be present
			expect(parsed.process.pid).toBe(process.pid);
			expect(parsed.state.activity).toBe("idle");
		});

		it("ensures directory is created", async () => {
			// Directory doesn't exist yet
			await expect(fs.access(tempDir)).rejects.toThrow();

			await bridge.telemetryHeartbeat(
				{
					process: {
						pid: process.pid,
						ppid: 0,
						uptime: 0,
						heartbeatAt: Date.now(),
						startedAt: Date.now(),
					},
				},
				tempDir,
			);

			// Directory should now exist
			await expect(fs.access(tempDir)).resolves.not.toThrow();
		});
	});

	describe("telemetryCleanup", () => {
		it("removes existing telemetry file", async () => {
			const testPid = 99999;
			const telemetryFile = path.join(tempDir, `${testPid}.json`);

			// Create telemetry file
			await fs.mkdir(tempDir, { recursive: true });
			await fs.writeFile(telemetryFile, JSON.stringify({ pid: testPid }));

			// Verify file exists
			await expect(fs.access(telemetryFile)).resolves.not.toThrow();

			// Cleanup
			await bridge.telemetryCleanup(testPid, tempDir);

			// File should be gone
			await expect(fs.access(telemetryFile)).rejects.toThrow();
		});

		it("handles missing file gracefully (ENOENT)", async () => {
			const testPid = 88888;
			// File doesn't exist, but should not throw
			await expect(bridge.telemetryCleanup(testPid, tempDir)).resolves.not.toThrow();
		});
	});

	describe("telemetrySnapshot", () => {
		it("returns empty snapshot when no instances exist", async () => {
			const snapshot = await bridge.telemetrySnapshot(10000, tempDir);

			expect(snapshot.schemaVersion).toBe(2);
			expect(snapshot.counts.total).toBe(0);
			expect(snapshot.instances).toEqual([]);
		});

		it("aggregates multiple instances correctly", async () => {
			await fs.mkdir(tempDir, { recursive: true });

			const now = Date.now();

			// Create 3 telemetry files
			await fs.writeFile(
				path.join(tempDir, "1000.json"),
				JSON.stringify({
					schemaVersion: 2,
					process: { pid: 1000, ppid: 1, uptime: 100, heartbeatAt: now, startedAt: now - 100 },
					state: { activity: "working", idle: false, idleSince: null },
					context: { tokens: 5000, contextWindow: 10000, percent: 50, pressure: "normal" },
					session: { id: "session-1", file: "/path/1", name: "Test 1" },
				} as AgentTelemetry),
			);

			await fs.writeFile(
				path.join(tempDir, "1001.json"),
				JSON.stringify({
					schemaVersion: 2,
					process: { pid: 1001, ppid: 1, uptime: 100, heartbeatAt: now, startedAt: now - 100 },
					state: { activity: "waiting_input", idle: false, idleSince: null },
					context: { tokens: 9000, contextWindow: 10000, percent: 90, pressure: "approaching_limit" },
					session: { id: "session-1", file: "/path/1", name: "Test 1" },
				} as AgentTelemetry),
			);

			await fs.writeFile(
				path.join(tempDir, "1002.json"),
				JSON.stringify({
					schemaVersion: 2,
					process: { pid: 1002, ppid: 1, uptime: 100, heartbeatAt: now, startedAt: now - 100 },
					state: { activity: "idle", idle: true, idleSince: now - 50 },
					context: { tokens: 9700, contextWindow: 10000, percent: 97, pressure: "near_limit" },
					session: { id: "session-2", file: "/path/2", name: "Test 2" },
				} as AgentTelemetry),
			);

			const snapshot = await bridge.telemetrySnapshot(10000, tempDir);

			expect(snapshot.counts.total).toBe(3);
			expect(snapshot.counts.working).toBe(1);
			expect(snapshot.counts.waiting_input).toBe(1);
			expect(snapshot.counts.idle).toBe(1);

			expect(snapshot.context.normal).toBe(1);
			expect(snapshot.context.approachingLimit).toBe(1);
			expect(snapshot.context.nearLimit).toBe(1);

			expect(snapshot.sessions["session-1"].instances).toBe(2);
			expect(snapshot.sessions["session-2"].instances).toBe(1);
		});

		it("filters stale instances", async () => {
			await fs.mkdir(tempDir, { recursive: true });

			const now = Date.now();

			// Fresh instance (heartbeat 1s ago)
			await fs.writeFile(
				path.join(tempDir, "2000.json"),
				JSON.stringify({
					schemaVersion: 2,
					process: { pid: 2000, ppid: 1, uptime: 100, heartbeatAt: now - 1000, startedAt: now - 100000 },
					state: { activity: "working", idle: false, idleSince: null },
					context: { tokens: 5000, contextWindow: 10000, percent: 50, pressure: "normal" },
					session: { id: "session-1", file: "/path/1", name: "Test" },
				} as AgentTelemetry),
			);

			// Stale instance (heartbeat 15s ago, default staleMs=10s)
			await fs.writeFile(
				path.join(tempDir, "2001.json"),
				JSON.stringify({
					schemaVersion: 2,
					process: { pid: 2001, ppid: 1, uptime: 100, heartbeatAt: now - 15000, startedAt: now - 100000 },
					state: { activity: "working", idle: false, idleSince: null },
					context: { tokens: 5000, contextWindow: 10000, percent: 50, pressure: "normal" },
					session: { id: "session-1", file: "/path/1", name: "Test" },
				} as AgentTelemetry),
			);

			const snapshot = await bridge.telemetrySnapshot(10000, tempDir);

			// Only fresh instance should be included
			expect(snapshot.counts.total).toBe(1);
			expect(snapshot.instances[0].process.pid).toBe(2000);
		});

		it("handles custom staleMs threshold", async () => {
			await fs.mkdir(tempDir, { recursive: true });

			const now = Date.now();

			// Instance with heartbeat 8s ago
			await fs.writeFile(
				path.join(tempDir, "3000.json"),
				JSON.stringify({
					schemaVersion: 2,
					process: { pid: 3000, ppid: 1, uptime: 100, heartbeatAt: now - 8000, startedAt: now - 100000 },
					state: { activity: "working", idle: false, idleSince: null },
					context: { tokens: 5000, contextWindow: 10000, percent: 50, pressure: "normal" },
					session: { id: "session-1", file: "/path/1", name: "Test" },
				} as AgentTelemetry),
			);

			// With staleMs=5000, this instance should be stale
			const snapshot1 = await bridge.telemetrySnapshot(5000, tempDir);
			expect(snapshot1.counts.total).toBe(0);

			// With staleMs=10000, this instance should be fresh
			const snapshot2 = await bridge.telemetrySnapshot(10000, tempDir);
			expect(snapshot2.counts.total).toBe(1);
		});

		it("determines aggregate activity correctly", async () => {
			await fs.mkdir(tempDir, { recursive: true });
			const now = Date.now();

			// Mixed: working + waiting_input
			await fs.writeFile(
				path.join(tempDir, "4000.json"),
				JSON.stringify({
					schemaVersion: 2,
					process: { pid: 4000, ppid: 1, uptime: 100, heartbeatAt: now, startedAt: now - 100 },
					state: { activity: "working", idle: false, idleSince: null },
					context: { tokens: 5000, contextWindow: 10000, percent: 50, pressure: "normal" },
					session: { id: "session-1", file: "/path/1", name: "Test" },
				} as AgentTelemetry),
			);

			await fs.writeFile(
				path.join(tempDir, "4001.json"),
				JSON.stringify({
					schemaVersion: 2,
					process: { pid: 4001, ppid: 1, uptime: 100, heartbeatAt: now, startedAt: now - 100 },
					state: { activity: "waiting_input", idle: false, idleSince: null },
					context: { tokens: 5000, contextWindow: 10000, percent: 50, pressure: "normal" },
					session: { id: "session-1", file: "/path/1", name: "Test" },
				} as AgentTelemetry),
			);

			const snapshot = await bridge.telemetrySnapshot(10000, tempDir);
			expect(snapshot.aggregate).toBe("mixed");
		});

		it("skips corrupted JSON files", async () => {
			await fs.mkdir(tempDir, { recursive: true });
			const now = Date.now();

			// Valid file
			await fs.writeFile(
				path.join(tempDir, "5000.json"),
				JSON.stringify({
					schemaVersion: 2,
					process: { pid: 5000, ppid: 1, uptime: 100, heartbeatAt: now, startedAt: now - 100 },
					state: { activity: "working", idle: false, idleSince: null },
					context: { tokens: 5000, contextWindow: 10000, percent: 50, pressure: "normal" },
					session: { id: "session-1", file: "/path/1", name: "Test" },
				} as AgentTelemetry),
			);

			// Corrupted file
			await fs.writeFile(path.join(tempDir, "5001.json"), "{ invalid json");

			const snapshot = await bridge.telemetrySnapshot(10000, tempDir);

			// Should only include valid file
			expect(snapshot.counts.total).toBe(1);
			expect(snapshot.instances[0].process.pid).toBe(5000);
		});
	});
});
