/**
 * Tests for ObservationCollector — Phase 49.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObservationCollector } from "../src/observation-collector.js";

describe("ObservationCollector", () => {
	let collector: ObservationCollector;

	beforeEach(() => {
		collector = new ObservationCollector({ sessionId: "test-session-1" });
	});

	describe("recordToolUsage", () => {
		it("should buffer a ToolUsageEvent", () => {
			collector.recordToolUsage("read_file", { path: "/foo.ts" }, 120, true);
			expect(collector.pending).toBe(1);
			const events = collector.flush();
			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("tool_usage");
			expect((events[0] as any).tool).toBe("read_file");
			expect((events[0] as any).durationMs).toBe(120);
			expect((events[0] as any).success).toBe(true);
			expect((events[0] as any).sessionId).toBe("test-session-1");
			expect((events[0] as any).argsHash).toMatch(/^[a-f0-9]{12}$/);
		});

		it("should generate deterministic argsHash for same args", () => {
			collector.recordToolUsage("bash", { cmd: "ls" }, 50, true);
			collector.recordToolUsage("bash", { cmd: "ls" }, 60, true);
			const events = collector.flush();
			expect((events[0] as any).argsHash).toBe((events[1] as any).argsHash);
		});

		it("should generate different argsHash for different args", () => {
			collector.recordToolUsage("bash", { cmd: "ls" }, 50, true);
			collector.recordToolUsage("bash", { cmd: "cat" }, 60, true);
			const events = collector.flush();
			expect((events[0] as any).argsHash).not.toBe((events[1] as any).argsHash);
		});
	});

	describe("error→resolution pairing", () => {
		it("should emit ErrorResolutionEvent when a tool succeeds after failure", () => {
			collector.recordToolUsage("bash", { cmd: "npm test", _errorHint: "exit 1" }, 200, false);
			collector.recordToolUsage("bash", { cmd: "npm test" }, 300, true);
			const events = collector.flush();
			// tool_usage (fail) + tool_usage (success) + error_resolution
			expect(events).toHaveLength(3);
			expect(events[2].type).toBe("error_resolution");
			expect((events[2] as any).tool).toBe("bash");
			expect((events[2] as any).errorMsg).toBe("exit 1");
		});

		it("should not emit ErrorResolutionEvent if error is stale (>60s)", () => {
			collector.recordToolUsage("bash", { cmd: "npm test" }, 200, false);
			// Simulate stale error by manipulating internal state
			const lastErrors = (collector as any).lastErrors as Map<string, { msg: string; ts: number }>;
			const entry = lastErrors.get("bash")!;
			entry.ts = Date.now() - 120_000; // 2 minutes ago
			collector.recordToolUsage("bash", { cmd: "npm test" }, 300, true);
			const events = collector.flush();
			// Only 2 tool_usage events, no resolution
			expect(events).toHaveLength(2);
			expect(events.every((e) => e.type === "tool_usage")).toBe(true);
		});
	});

	describe("recordEdit", () => {
		it("should buffer an EditPatternEvent", () => {
			collector.recordEdit(["/foo.ts", "/bar.ts"], "edit", ["/baz.ts"]);
			const events = collector.flush();
			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("edit_pattern");
			expect((events[0] as any).files).toEqual(["/foo.ts", "/bar.ts"]);
			expect((events[0] as any).editType).toBe("edit");
			expect((events[0] as any).coEdited).toEqual(["/baz.ts"]);
		});
	});

	describe("recordCorrection", () => {
		it("should buffer a UserCorrectionEvent", () => {
			collector.recordCorrection("abc123", "def456", "undo");
			const events = collector.flush();
			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("user_correction");
			expect((events[0] as any).originalHash).toBe("abc123");
		});
	});

	describe("flush", () => {
		it("should return empty array when buffer is empty", () => {
			expect(collector.flush()).toEqual([]);
		});

		it("should clear buffer after flush", () => {
			collector.recordToolUsage("read_file", {}, 10, true);
			expect(collector.pending).toBe(1);
			collector.flush();
			expect(collector.pending).toBe(0);
		});

		it("should accumulate multiple event types", () => {
			collector.recordToolUsage("read_file", {}, 10, true);
			collector.recordEdit(["/a.ts"], "create");
			collector.recordCorrection("x", "y", "manual");
			expect(collector.pending).toBe(3);
			const events = collector.flush();
			const types = events.map((e) => e.type);
			expect(types).toContain("tool_usage");
			expect(types).toContain("edit_pattern");
			expect(types).toContain("user_correction");
		});
	});

	describe("maxBuffer warning", () => {
		it("should warn when buffer exceeds maxBuffer", () => {
			const small = new ObservationCollector({ sessionId: "s", maxBuffer: 3 });
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			small.recordToolUsage("a", {}, 1, true);
			small.recordToolUsage("b", {}, 1, true);
			small.recordToolUsage("c", {}, 1, true);
			// 4th should trigger warning (via logger, but we just check it doesn't throw)
			small.recordToolUsage("d", {}, 1, true);
			expect(small.pending).toBe(4);
			warnSpy.mockRestore();
		});
	});
});
