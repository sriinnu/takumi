import { describe, expect, it } from "vitest";
import { bootstrapChitraguptaForExec } from "../src/exec-bootstrap.js";

describe("exec bootstrap", () => {
	it("returns connected daemon bootstrap metadata and memory context", async () => {
		const result = await bootstrapChitraguptaForExec({
			cwd: "/repo/takumi",
			createBridge: () => ({
				isConnected: true,
				isSocketMode: true,
				connect: async () => undefined,
				disconnect: async () => undefined,
				unifiedRecall: async () => [{ content: "Prefer NodeNext", score: 0.98, source: "memory", type: "fact" }],
				vasanaTendencies: async () => [
					{
						tendency: "prefers-tight-feedback",
						valence: "positive",
						strength: 0.91,
						stability: 0.88,
						predictiveAccuracy: 0.8,
						reinforcementCount: 4,
						description: "Runs focused tests after edits",
					},
				],
				healthStatus: async () => ({
					state: { sattva: 0.7, rajas: 0.2, tamas: 0.1 },
					dominant: "sattva",
					trend: { sattva: "stable", rajas: "falling", tamas: "falling" },
					alerts: [],
					history: [],
				}),
			}),
		});

		expect(result.connected).toBe(true);
		expect(result.transport).toBe("daemon-socket");
		expect(result.memoryEntries).toBe(1);
		expect(result.vasanaCount).toBe(1);
		expect(result.hasHealth).toBe(true);
		expect(result.memoryContext).toContain("Prefer NodeNext");
		expect(result.memoryContext).toContain("prefers-tight-feedback");
	});

	it("degrades gracefully when the bridge cannot connect", async () => {
		const result = await bootstrapChitraguptaForExec({
			cwd: "/repo/takumi",
			createBridge: () => ({
				isConnected: false,
				isSocketMode: false,
				connect: async () => {
					throw new Error("spawn chitragupta-mcp ENOENT");
				},
				disconnect: async () => undefined,
				unifiedRecall: async () => [],
				vasanaTendencies: async () => [],
				healthStatus: async () => null,
			}),
		});

		expect(result.connected).toBe(false);
		expect(result.degraded).toBe(true);
		expect(result.transport).toBe("unavailable");
		expect(result.summary).toContain("unavailable");
		expect(result.error?.message).toContain("ENOENT");
	});
});
