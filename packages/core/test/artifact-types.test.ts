import { createArtifactContentHash, createArtifactId, createHubArtifact, resetArtifactCounter } from "@takumi/core";
import { beforeEach, describe, expect, it } from "vitest";

describe("artifact-types", () => {
	beforeEach(() => {
		resetArtifactCounter();
	});

	describe("createArtifactId", () => {
		it("returns a unique string with art- prefix", () => {
			const id = createArtifactId(1000);
			expect(id).toMatch(/^art-/);
			expect(typeof id).toBe("string");
		});

		it("increments counter across calls", () => {
			const a = createArtifactId(1000);
			const b = createArtifactId(1000);
			expect(a).not.toBe(b);
		});

		it("encodes timestamp in base 36", () => {
			const id = createArtifactId(1000);
			expect(id).toMatch(new RegExp(`^art-${(1000).toString(36)}-[a-z0-9]{4}-001$`));
		});

		it("pads counter to 3 chars", () => {
			const id = createArtifactId(0);
			expect(id.endsWith("-001")).toBe(true);
		});
	});

	describe("createHubArtifact", () => {
		it("creates artifact with required fields", () => {
			const artifact = createHubArtifact({
				kind: "assistant_response",
				producer: "takumi.exec",
				summary: "Test artifact",
			});

			expect(artifact.artifactId).toMatch(/^art-/);
			expect(artifact.kind).toBe("assistant_response");
			expect(artifact.producer).toBe("takumi.exec");
			expect(artifact.summary).toBe("Test artifact");
			expect(artifact.promoted).toBe(false);
			expect(artifact.contentHash).toMatch(/^[a-f0-9]{64}$/);
			expect(artifact.createdAt).toBeTruthy();
		});

		it("truncates summary to 240 chars", () => {
			const long = "x".repeat(300);
			const artifact = createHubArtifact({
				kind: "plan",
				producer: "takumi.tui",
				summary: long,
			});

			expect(artifact.summary.length).toBe(240);
		});

		it("includes optional fields when provided", () => {
			const artifact = createHubArtifact({
				kind: "validation",
				producer: "takumi.cluster.validator",
				summary: "Validation passed",
				body: "All checks green",
				path: "src/index.ts",
				confidence: 0.95,
				taskId: "task-1",
				runId: "run-1",
				laneId: "lane-abc",
				localSessionId: "local-session",
				canonicalSessionId: "canon-session",
				importStatus: "failed",
				lastImportAt: 1234,
				lastImportError: "boom",
				canonicalArtifactId: "cart-123",
				metadata: { checks: 3 },
			});

			expect(artifact.body).toBe("All checks green");
			expect(artifact.path).toBe("src/index.ts");
			expect(artifact.confidence).toBe(0.95);
			expect(artifact.taskId).toBe("task-1");
			expect(artifact.runId).toBe("run-1");
			expect(artifact.laneId).toBe("lane-abc");
			expect(artifact.localSessionId).toBe("local-session");
			expect(artifact.canonicalSessionId).toBe("canon-session");
			expect(artifact.importStatus).toBe("failed");
			expect(artifact.lastImportAt).toBe(1234);
			expect(artifact.lastImportError).toBe("boom");
			expect(artifact.canonicalArtifactId).toBe("cart-123");
			expect(artifact.metadata).toEqual({ checks: 3 });
		});

		it("leaves optional fields undefined when not provided", () => {
			const artifact = createHubArtifact({
				kind: "exec_result",
				producer: "takumi.exec",
				summary: "Done",
			});

			expect(artifact.body).toBeUndefined();
			expect(artifact.path).toBeUndefined();
			expect(artifact.confidence).toBeUndefined();
			expect(artifact.taskId).toBeUndefined();
			expect(artifact.runId).toBeUndefined();
			expect(artifact.laneId).toBeUndefined();
			expect(artifact.localSessionId).toBeUndefined();
			expect(artifact.canonicalSessionId).toBeUndefined();
			expect(artifact.importStatus).toBeUndefined();
			expect(artifact.canonicalArtifactId).toBeUndefined();
			expect(artifact.metadata).toBeUndefined();
		});

		it("generates unique IDs for each artifact", () => {
			const a = createHubArtifact({ kind: "plan", producer: "takumi.exec", summary: "A" });
			const b = createHubArtifact({ kind: "plan", producer: "takumi.exec", summary: "B" });
			expect(a.artifactId).not.toBe(b.artifactId);
		});

		it("sets createdAt to a valid ISO 8601 timestamp", () => {
			const before = new Date().toISOString();
			const artifact = createHubArtifact({
				kind: "reflection",
				producer: "takumi.exec",
				summary: "Reflected",
			});
			const after = new Date().toISOString();

			expect(artifact.createdAt >= before).toBe(true);
			expect(artifact.createdAt <= after).toBe(true);
		});

		it("supports all artifact kinds", () => {
			const kinds = [
				"plan",
				"design_review",
				"implementation",
				"validation",
				"postmortem",
				"handoff",
				"assistant_response",
				"exec_result",
				"reflection",
				"summary",
			] as const;

			for (const kind of kinds) {
				const artifact = createHubArtifact({
					kind,
					producer: "takumi.exec",
					summary: `Kind: ${kind}`,
				});
				expect(artifact.kind).toBe(kind);
			}
		});

		it("supports all producer types", () => {
			const producers = [
				"takumi.exec",
				"takumi.tui",
				"takumi.cluster.planner",
				"takumi.cluster.worker",
				"takumi.cluster.validator",
				"takumi.cluster.adversarial",
				"chitragupta",
				"scarlett",
			] as const;

			for (const producer of producers) {
				const artifact = createHubArtifact({
					kind: "exec_result",
					producer,
					summary: `Producer: ${producer}`,
				});
				expect(artifact.producer).toBe(producer);
			}
		});
	});

	describe("resetArtifactCounter", () => {
		it("resets the counter so IDs restart", () => {
			createArtifactId(1000);
			createArtifactId(1000);
			resetArtifactCounter();
			const id = createArtifactId(1000);
			expect(id).toMatch(new RegExp(`^art-${(1000).toString(36)}-[a-z0-9]{4}-001$`));
		});
	});

	describe("sanitizeMetadata (via createHubArtifact)", () => {
		it("strips __proto__ key from metadata", () => {
			const artifact = createHubArtifact({
				kind: "exec_result",
				producer: "takumi.exec",
				summary: "Test",
				metadata: { safe: 1, __proto__: { injected: true } } as Record<string, unknown>,
			});
			expect(artifact.metadata).toBeDefined();
			expect(Object.keys(artifact.metadata!)).toEqual(["safe"]);
		});

		it("strips constructor and prototype keys", () => {
			const artifact = createHubArtifact({
				kind: "exec_result",
				producer: "takumi.exec",
				summary: "Test",
				metadata: { ok: true, constructor: "bad", prototype: "bad" },
			});
			expect(Object.keys(artifact.metadata!)).toEqual(["ok"]);
		});

		it("returns undefined for undefined metadata", () => {
			const artifact = createHubArtifact({
				kind: "exec_result",
				producer: "takumi.exec",
				summary: "Test",
			});
			expect(artifact.metadata).toBeUndefined();
		});

		it("preserves safe metadata keys", () => {
			const artifact = createHubArtifact({
				kind: "validation",
				producer: "takumi.cluster.validator",
				summary: "Test",
				metadata: { checks: 3, passed: true, failureReasons: ["a"] },
			});
			expect(artifact.metadata).toEqual({ checks: 3, passed: true, failureReasons: ["a"] });
		});
	});

	describe("createArtifactContentHash", () => {
		it("returns the same digest for the same artifact content", () => {
			const first = createArtifactContentHash({
				kind: "summary",
				producer: "takumi.exec",
				summary: "Stable summary",
				body: "Stable body",
				path: "src/index.ts",
				createdAt: "2026-04-03T09:00:00.000Z",
				taskId: "task-1",
				laneId: "lane-1",
			});
			const second = createArtifactContentHash({
				kind: "summary",
				producer: "takumi.exec",
				summary: "Stable summary",
				body: "Stable body",
				path: "src/index.ts",
				createdAt: "2026-04-03T09:00:00.000Z",
				taskId: "task-1",
				laneId: "lane-1",
			});

			expect(first).toBe(second);
		});
	});

	describe("edge cases", () => {
		it("handles empty string summary", () => {
			const artifact = createHubArtifact({
				kind: "exec_result",
				producer: "takumi.exec",
				summary: "",
			});
			expect(artifact.summary).toBe("");
		});

		it("handles summary at exactly 240 chars (no truncation)", () => {
			const exact = "x".repeat(240);
			const artifact = createHubArtifact({
				kind: "exec_result",
				producer: "takumi.exec",
				summary: exact,
			});
			expect(artifact.summary).toBe(exact);
			expect(artifact.summary.length).toBe(240);
		});

		it("handles summary at 241 chars (truncated)", () => {
			const long = "y".repeat(241);
			const artifact = createHubArtifact({
				kind: "exec_result",
				producer: "takumi.exec",
				summary: long,
			});
			expect(artifact.summary.length).toBe(240);
		});

		it("artifact IDs include instanceSuffix segment", () => {
			const id = createArtifactId(42);
			const parts = id.split("-");
			expect(parts.length).toBe(4);
			expect(parts[0]).toBe("art");
			expect(parts[2]).toMatch(/^[a-z0-9]{4}$/);
		});
	});
});
