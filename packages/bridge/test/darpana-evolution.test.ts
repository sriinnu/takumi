/**
 * Tests for DarpanaEvolution — Phase 54
 */

import { describe, expect, it } from "vitest";
import {
	DarpanaEvolution,
	type ReflectionEntry,
	type RequestTransform,
	type TransformContext,
} from "../src/darpana-evolution.js";

function makeCtx(overrides: Partial<TransformContext> = {}): TransformContext {
	return {
		systemPrompt: "You are an expert coder.",
		messages: [{ role: "user", content: "hello" }],
		model: "sonnet",
		sessionId: "s1",
		...overrides,
	};
}

function makeTransform(overrides: Partial<RequestTransform> = {}): RequestTransform {
	return {
		id: "test-transform",
		description: "Test transform",
		priority: 0,
		enabled: true,
		source: "manual",
		apply: () => ({ appendSystem: ["Be concise."] }),
		...overrides,
	};
}

function makeReflection(overrides: Partial<ReflectionEntry> = {}): ReflectionEntry {
	return {
		sessionId: "s1",
		turnIndex: 0,
		timestamp: Date.now(),
		prediction: "will use edit tool",
		predictionConfidence: 0.9,
		actualSummary: "used edit tool",
		matched: true,
		model: "sonnet",
		...overrides,
	};
}

describe("DarpanaEvolution", () => {
	// ── Request Transforms ─────────────────────────────────────────────────────

	describe("Request Transforms", () => {
		it("applies a single transform", () => {
			const evo = new DarpanaEvolution();
			evo.addTransform(makeTransform());

			const result = evo.applyTransforms(makeCtx());
			expect(result.systemPrompt).toContain("Be concise.");
			expect(result.systemPrompt).toContain("You are an expert coder.");
		});

		it("applies transforms in priority order", () => {
			const evo = new DarpanaEvolution();
			const order: string[] = [];

			evo.addTransform(
				makeTransform({
					id: "second",
					priority: 10,
					apply: () => {
						order.push("second");
						return null;
					},
				}),
			);
			evo.addTransform(
				makeTransform({
					id: "first",
					priority: 1,
					apply: () => {
						order.push("first");
						return null;
					},
				}),
			);

			evo.applyTransforms(makeCtx());
			expect(order).toEqual(["first", "second"]);
		});

		it("skips disabled transforms", () => {
			const evo = new DarpanaEvolution();
			evo.addTransform(makeTransform({ enabled: false }));

			const result = evo.applyTransforms(makeCtx());
			expect(result.systemPrompt).toBe("You are an expert coder.");
		});

		it("handles transform errors gracefully", () => {
			const evo = new DarpanaEvolution();
			evo.addTransform(
				makeTransform({
					apply: () => {
						throw new Error("boom");
					},
				}),
			);

			// Should not throw
			const result = evo.applyTransforms(makeCtx());
			expect(result.systemPrompt).toBe("You are an expert coder.");
		});

		it("supports prependSystem", () => {
			const evo = new DarpanaEvolution();
			evo.addTransform(
				makeTransform({
					apply: () => ({ prependSystem: ["IMPORTANT:"] }),
				}),
			);

			const result = evo.applyTransforms(makeCtx());
			expect(result.systemPrompt).toMatch(/^IMPORTANT:/);
		});

		it("supports injectContext", () => {
			const evo = new DarpanaEvolution();
			evo.addTransform(
				makeTransform({
					apply: () => ({ injectContext: "User prefers TypeScript" }),
				}),
			);

			const result = evo.applyTransforms(makeCtx());
			expect(result.injectedContext).toBe("User prefers TypeScript");
		});

		it("chains injectContext from multiple transforms", () => {
			const evo = new DarpanaEvolution();
			evo.addTransform(
				makeTransform({
					id: "a",
					priority: 1,
					apply: () => ({ injectContext: "Line 1" }),
				}),
			);
			evo.addTransform(
				makeTransform({
					id: "b",
					priority: 2,
					apply: () => ({ injectContext: "Line 2" }),
				}),
			);

			const result = evo.applyTransforms(makeCtx());
			expect(result.injectedContext).toBe("Line 1\nLine 2");
		});

		it("removeTransform works", () => {
			const evo = new DarpanaEvolution();
			evo.addTransform(makeTransform({ id: "rm-me" }));
			expect(evo.getTransforms()).toHaveLength(1);

			expect(evo.removeTransform("rm-me")).toBe(true);
			expect(evo.getTransforms()).toHaveLength(0);
		});

		it("removeTransform returns false for unknown id", () => {
			const evo = new DarpanaEvolution();
			expect(evo.removeTransform("nope")).toBe(false);
		});

		it("setTransformEnabled toggles", () => {
			const evo = new DarpanaEvolution();
			evo.addTransform(makeTransform({ id: "toggle" }));

			expect(evo.setTransformEnabled("toggle", false)).toBe(true);
			const t = evo.getTransforms().find((t) => t.id === "toggle");
			expect(t!.enabled).toBe(false);
		});

		it("no transforms when evolution disabled", () => {
			const evo = new DarpanaEvolution();
			evo.addTransform(makeTransform());
			evo.enabled = false;

			const result = evo.applyTransforms(makeCtx());
			expect(result.systemPrompt).toBe("You are an expert coder.");
		});
	});

	// ── Response Reflection ────────────────────────────────────────────────────

	describe("Response Reflection", () => {
		it("records reflections", () => {
			const evo = new DarpanaEvolution();
			evo.recordReflection(makeReflection());
			evo.recordReflection(makeReflection({ matched: false }));

			expect(evo.getReflections()).toHaveLength(2);
		});

		it("computes accuracy", () => {
			const evo = new DarpanaEvolution();
			evo.recordReflection(makeReflection({ matched: true }));
			evo.recordReflection(makeReflection({ matched: true }));
			evo.recordReflection(makeReflection({ matched: false }));

			const { accuracy, total } = evo.reflectionAccuracy();
			expect(total).toBe(3);
			expect(accuracy).toBeCloseTo(2 / 3);
		});

		it("computes accuracy per model", () => {
			const evo = new DarpanaEvolution();
			evo.recordReflection(makeReflection({ model: "opus", matched: true }));
			evo.recordReflection(makeReflection({ model: "opus", matched: false }));
			evo.recordReflection(makeReflection({ model: "sonnet", matched: true }));

			expect(evo.reflectionAccuracy("opus").accuracy).toBeCloseTo(0.5);
			expect(evo.reflectionAccuracy("sonnet").accuracy).toBe(1);
		});

		it("returns 0 accuracy with no reflections", () => {
			const evo = new DarpanaEvolution();
			expect(evo.reflectionAccuracy().accuracy).toBe(0);
		});

		it("caps reflections at 500", () => {
			const evo = new DarpanaEvolution();
			for (let i = 0; i < 600; i++) {
				evo.recordReflection(makeReflection({ turnIndex: i }));
			}
			expect(evo.getReflections().length).toBe(500);
		});

		it("getReflections returns most recent first", () => {
			const evo = new DarpanaEvolution();
			evo.recordReflection(makeReflection({ turnIndex: 0, timestamp: 100 }));
			evo.recordReflection(makeReflection({ turnIndex: 1, timestamp: 200 }));

			const refs = evo.getReflections();
			expect(refs[0].turnIndex).toBe(1);
		});

		it("getReflections respects limit", () => {
			const evo = new DarpanaEvolution();
			for (let i = 0; i < 10; i++) {
				evo.recordReflection(makeReflection({ turnIndex: i }));
			}
			expect(evo.getReflections(3)).toHaveLength(3);
		});
	});

	// ── Cost Routing ───────────────────────────────────────────────────────────

	describe("Cost Routing", () => {
		it("returns null with insufficient reflections", () => {
			const evo = new DarpanaEvolution({ minReflections: 10 });
			// Only 2 reflections
			evo.recordReflection(makeReflection());
			evo.recordReflection(makeReflection());

			const advice = evo.getCostAdvice("sonnet", 0.9);
			expect(advice).toBeNull();
		});

		it("returns null with low reflection accuracy", () => {
			const evo = new DarpanaEvolution({
				minReflections: 3,
				minReflectionAccuracy: 0.7,
			});
			// 1/3 = 33% accuracy
			evo.recordReflection(makeReflection({ matched: true }));
			evo.recordReflection(makeReflection({ matched: false }));
			evo.recordReflection(makeReflection({ matched: false }));

			const advice = evo.getCostAdvice("sonnet", 0.9);
			expect(advice).toBeNull();
		});

		it("returns null with low prediction confidence", () => {
			const evo = new DarpanaEvolution({
				minReflections: 2,
				downgradeThreshold: 0.85,
			});
			evo.recordReflection(makeReflection({ matched: true }));
			evo.recordReflection(makeReflection({ matched: true }));

			const advice = evo.getCostAdvice("sonnet", 0.5); // below threshold
			expect(advice).toBeNull();
		});

		it("returns advice when all conditions met", () => {
			const evo = new DarpanaEvolution({
				minReflections: 2,
				downgradeThreshold: 0.8,
				minReflectionAccuracy: 0.5,
				downgradePaths: { sonnet: "haiku" },
				modelCosts: { sonnet: 0.2, haiku: 0.04 },
			});
			evo.recordReflection(makeReflection({ matched: true }));
			evo.recordReflection(makeReflection({ matched: true }));

			const advice = evo.getCostAdvice("sonnet", 0.9);
			expect(advice).not.toBeNull();
			expect(advice!.recommendedModel).toBe("haiku");
			expect(advice!.costRatio).toBeCloseTo(0.04 / 0.2);
			expect(advice!.reason).toContain("cost saving");
		});

		it("returns null when no downgrade path exists", () => {
			const evo = new DarpanaEvolution({
				minReflections: 2,
				downgradeThreshold: 0.8,
				downgradePaths: {},
			});
			evo.recordReflection(makeReflection({ matched: true }));
			evo.recordReflection(makeReflection({ matched: true }));

			const advice = evo.getCostAdvice("sonnet", 0.9);
			expect(advice).toBeNull();
		});

		it("returns null when evolution disabled", () => {
			const evo = new DarpanaEvolution({ minReflections: 1 });
			evo.recordReflection(makeReflection({ matched: true }));
			evo.enabled = false;

			const advice = evo.getCostAdvice("sonnet", 0.95);
			expect(advice).toBeNull();
		});
	});

	// ── Stats ──────────────────────────────────────────────────────────────────

	describe("Stats", () => {
		it("returns summary stats", () => {
			const evo = new DarpanaEvolution();
			evo.addTransform(makeTransform({ id: "a", enabled: true }));
			evo.addTransform(makeTransform({ id: "b", enabled: false }));
			evo.recordReflection(makeReflection({ matched: true }));
			evo.recordReflection(makeReflection({ matched: false }));

			const s = evo.stats();
			expect(s.transformCount).toBe(2);
			expect(s.enabledTransforms).toBe(1);
			expect(s.reflectionCount).toBe(2);
			expect(s.reflectionAccuracy).toBeCloseTo(0.5);
		});
	});

	// ── Enable/Disable ─────────────────────────────────────────────────────────

	describe("Enable/Disable", () => {
		it("enabled property toggles", () => {
			const evo = new DarpanaEvolution();
			expect(evo.enabled).toBe(true);
			evo.enabled = false;
			expect(evo.enabled).toBe(false);
		});
	});
});
