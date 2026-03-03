import { describe, expect, it } from "vitest";
import { ChitraguptaBridge } from "@takumi/bridge";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("takumi-telemetry-snapshot CLI (Phase 20.3)", () => {
	it("returns valid TelemetrySnapshot JSON", async () => {
		// Create temporary telemetry directory with test data
		const tempDir = path.join(os.tmpdir(), `takumi-cli-test-${Date.now()}`);
		await fs.mkdir(tempDir, { recursive: true });

		try {
			const now = Date.now();

			// Create test telemetry file
			await fs.writeFile(
				path.join(tempDir, "12345.json"),
				JSON.stringify({
					schemaVersion: 2,
					process: {
						pid: 12345,
						ppid: 1,
						uptime: 100,
						heartbeatAt: now,
						startedAt: now - 100000,
					},
					state: {
						activity: "working",
						idle: false,
						idleSince: null,
					},
					context: {
						tokens: 5000,
						contextWindow: 10000,
						percent: 50,
						pressure: "normal",
					},
					session: {
						id: "test-session",
						file: "/tmp/test",
						name: "Test Session",
					},
				}),
			);

			// Test CLI logic (using ChitraguptaBridge directly)
			const bridge = new ChitraguptaBridge({ transport: "stdio" });
			const snapshot = await bridge.telemetrySnapshot(10000, tempDir);

			// Validate output structure
			expect(snapshot.schemaVersion).toBe(2);
			expect(snapshot.timestamp).toBeGreaterThan(0);
			expect(snapshot.counts.total).toBe(1);
			expect(snapshot.counts.working).toBe(1);
			expect(snapshot.instances).toHaveLength(1);
			expect(snapshot.instances[0].process.pid).toBe(12345);

			// Validate JSON serialization (what CLI outputs)
			const compactJson = JSON.stringify(snapshot);
			expect(compactJson).toBeTruthy();
			expect(JSON.parse(compactJson)).toEqual(snapshot);

			const prettyJson = JSON.stringify(snapshot, null, 2);
			expect(prettyJson).toContain("\n");
			expect(JSON.parse(prettyJson)).toEqual(snapshot);
		} finally {
			// Cleanup
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("handles empty telemetry directory", async () => {
		const tempDir = path.join(os.tmpdir(), `takumi-cli-test-empty-${Date.now()}`);
		await fs.mkdir(tempDir, { recursive: true });

		try {
			const bridge = new ChitraguptaBridge({ transport: "stdio" });
			const snapshot = await bridge.telemetrySnapshot(10000, tempDir);

			expect(snapshot.schemaVersion).toBe(2);
			expect(snapshot.counts.total).toBe(0);
			expect(snapshot.instances).toEqual([]);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("filters stale instances based on --stale-ms", async () => {
		const tempDir = path.join(os.tmpdir(), `takumi-cli-test-stale-${Date.now()}`);
		await fs.mkdir(tempDir, { recursive: true });

		try {
			const now = Date.now();

			// Fresh instance (1s old)
			await fs.writeFile(
				path.join(tempDir, "11111.json"),
				JSON.stringify({
					schemaVersion: 2,
					process: {
						pid: 11111,
						ppid: 1,
						uptime: 1000,
						heartbeatAt: now - 1000,
						startedAt: now - 100000,
					},
					state: { activity: "working", idle: false, idleSince: null },
					context: { tokens: 5000, contextWindow: 10000, percent: 50, pressure: "normal" },
					session: { id: "s1", file: "/tmp/1", name: "S1" },
				}),
			);

			// Stale instance (20s old)
			await fs.writeFile(
				path.join(tempDir, "22222.json"),
				JSON.stringify({
					schemaVersion: 2,
					process: {
						pid: 22222,
						ppid: 1,
						uptime: 20000,
						heartbeatAt: now - 20000,
						startedAt: now - 100000,
					},
					state: { activity: "idle", idle: true, idleSince: now - 5000 },
					context: { tokens: 2000, contextWindow: 10000, percent: 20, pressure: "normal" },
					session: { id: "s2", file: "/tmp/2", name: "S2" },
				}),
			);

			const bridge = new ChitraguptaBridge({ transport: "stdio" });

			// With default staleMs=10000, only fresh instance included
			const snapshot1 = await bridge.telemetrySnapshot(10000, tempDir);
			expect(snapshot1.counts.total).toBe(1);
			expect(snapshot1.instances[0].process.pid).toBe(11111);

			// With staleMs=30000, both included
			const snapshot2 = await bridge.telemetrySnapshot(30000, tempDir);
			expect(snapshot2.counts.total).toBe(2);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});
