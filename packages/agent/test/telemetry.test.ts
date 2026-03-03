/**
 * Phase 20.1: Telemetry helper function tests
 */

import { describe, expect, it } from "vitest";
import { calculateContextPressure, estimateMessagesTokens, renderLastAssistantHtml } from "../src/telemetry.js";

describe("Telemetry", () => {
	describe("calculateContextPressure", () => {
		it("should calculate normal pressure", () => {
			const messages = [{ role: "user", content: "Hello" }];
			const result = calculateContextPressure(messages, 10000);

			expect(result.pressure).toBe("normal");
			expect(result.closeToLimit).toBe(false);
			expect(result.nearLimit).toBe(false);
			expect(result.percent).toBeLessThan(85);
		});

		it("should calculate approaching_limit pressure", () => {
			const content = "x".repeat(34000); // ~8500 tokens
			const messages = [{ role: "user", content }];
			const result = calculateContextPressure(messages, 10000);

			expect(result.pressure).toBe("approaching_limit");
			expect(result.closeToLimit).toBe(true);
			expect(result.nearLimit).toBe(false);
			expect(result.percent).toBeGreaterThanOrEqual(85);
			expect(result.percent).toBeLessThan(95);
		});

		it("should calculate near_limit pressure", () => {
			const content = "x".repeat(38000); // ~9500 tokens
			const messages = [{ role: "user", content }];
			const result = calculateContextPressure(messages, 10000);

			expect(result.pressure).toBe("near_limit");
			expect(result.closeToLimit).toBe(true);
			expect(result.nearLimit).toBe(true);
			expect(result.percent).toBeGreaterThanOrEqual(95);
			expect(result.percent).toBeLessThan(100);
		});

		it("should calculate at_limit pressure", () => {
			const content = "x".repeat(40000); // ~10000 tokens
			const messages = [{ role: "user", content }];
			const result = calculateContextPressure(messages, 10000);

			expect(result.pressure).toBe("at_limit");
			expect(result.nearLimit).toBe(true);
			expect(result.percent).toBeGreaterThanOrEqual(100);
		});

		it("should handle empty messages", () => {
			const result = calculateContextPressure([], 10000);

			expect(result.pressure).toBe("normal");
			expect(result.tokens).toBe(0);
			expect(result.percent).toBe(0);
		});
	});

	describe("estimateMessagesTokens", () => {
		it("should estimate tokens for simple message", () => {
			const messages = [{ role: "user", content: "Hello world!" }];
			const tokens = estimateMessagesTokens(messages);

			expect(tokens).toBeGreaterThan(0);
			expect(tokens).toBeLessThan(10);
		});

		it("should handle array content", () => {
			const messages = [
				{
					role: "user",
					content: [
						{ type: "text", text: "Hello" },
						{ type: "text", text: "world" },
					],
				},
			];
			const tokens = estimateMessagesTokens(messages);

			expect(tokens).toBeGreaterThan(0);
			expect(tokens).toBeLessThan(10);
		});

		it("should handle mixed content types", () => {
			const messages = [
				{ role: "user", content: "Plain text" },
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Array text" },
						{ type: "image", url: "ignored" },
					],
				},
			];
			const tokens = estimateMessagesTokens(messages);

			expect(tokens).toBeGreaterThan(0);
		});

		it("should return 0 for empty messages", () => {
			expect(estimateMessagesTokens([])).toBe(0);
		});
	});

	describe("renderLastAssistantHtml", () => {
		it("should escape HTML characters", () => {
			const result = renderLastAssistantHtml("<script>alert('xss')</script>");
			expect(result).not.toContain("<script>");
			expect(result).toContain("&lt;script&gt;");
		});

		it("should convert newlines to <br>", () => {
			const result = renderLastAssistantHtml("Line 1\nLine 2\nLine 3");
			expect(result).toContain("<br>");
			expect(result.split("<br>")).toHaveLength(3);
		});

		it("should handle empty string", () => {
			expect(renderLastAssistantHtml("")).toBe("");
		});
	});
});
