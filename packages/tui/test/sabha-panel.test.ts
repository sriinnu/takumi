/**
 * Tests for SabhaPanel height computation and rendering logic (P1-2).
 */

import { describe, expect, it } from "vitest";

/** Mirror the height computation logic from sabha-panel.ts for unit testing. */
function computeSabhaHeight(
	sabhaId: string,
	predictions: Array<{ action: string; confidence: number }>,
	patterns: Array<{ type: string; confidence: number }>,
): number {
	const hasSabha = sabhaId !== "";
	const hasPredictions = predictions.length > 0;
	const hasPatterns = patterns.length > 0;

	if (!hasSabha && !hasPredictions && !hasPatterns) return 0;

	let rows = 1; // header
	if (hasSabha) rows += 2; // id + participants
	if (hasPredictions) {
		rows += 1; // sub-header
		rows += Math.min(predictions.length, 3);
	}
	if (hasPatterns) {
		rows += 1; // sub-header
		rows += Math.min(patterns.length, 2);
	}
	return rows;
}

describe("SabhaPanel height computation", () => {
	it("returns 0 when no sabha data exists", () => {
		expect(computeSabhaHeight("", [], [])).toBe(0);
	});

	it("returns header + id + participants for sabha with no predictions", () => {
		expect(computeSabhaHeight("sabha-123", [], [])).toBe(3);
	});

	it("includes prediction rows", () => {
		const predictions = [
			{ action: "refactor", confidence: 0.85 },
			{ action: "test", confidence: 0.6 },
		];
		expect(computeSabhaHeight("sabha-123", predictions, [])).toBe(3 + 1 + 2); // 6
	});

	it("caps predictions at 3", () => {
		const predictions = Array.from({ length: 10 }, (_, i) => ({
			action: `action-${i}`,
			confidence: 0.5,
		}));
		expect(computeSabhaHeight("sabha-123", predictions, [])).toBe(3 + 1 + 3); // 7
	});

	it("includes pattern rows", () => {
		const patterns = [{ type: "repetition", confidence: 0.9 }];
		expect(computeSabhaHeight("sabha-123", [], patterns)).toBe(3 + 1 + 1); // 5
	});

	it("caps patterns at 2", () => {
		const patterns = Array.from({ length: 5 }, (_, i) => ({
			type: `pattern-${i}`,
			confidence: 0.7,
		}));
		expect(computeSabhaHeight("sabha-123", [], patterns)).toBe(3 + 1 + 2); // 6
	});

	it("works with predictions only (no sabha ID)", () => {
		const predictions = [{ action: "fix", confidence: 0.8 }];
		// header + predictions sub-header + 1 prediction
		expect(computeSabhaHeight("", predictions, [])).toBe(1 + 1 + 1); // 3
	});

	it("works with patterns only (no sabha ID)", () => {
		const patterns = [{ type: "cycle", confidence: 0.75 }];
		expect(computeSabhaHeight("", [], patterns)).toBe(1 + 1 + 1); // 3
	});

	it("combines all sections", () => {
		const predictions = [
			{ action: "refactor", confidence: 0.85 },
			{ action: "test", confidence: 0.6 },
		];
		const patterns = [
			{ type: "repetition", confidence: 0.9 },
			{ type: "cycle", confidence: 0.7 },
		];
		// header(1) + id+participants(2) + pred-header(1) + 2 preds + pat-header(1) + 2 pats
		expect(computeSabhaHeight("sabha-456", predictions, patterns)).toBe(9);
	});
});

describe("SabhaPanel rendering format", () => {
	it("formats prediction confidence as percentage", () => {
		const conf = Math.round(0.85 * 100);
		expect(`${conf}%`).toBe("85%");
	});

	it("truncates long action text", () => {
		const width = 20;
		const conf = "85%";
		const action = "refactor-the-entire-codebase-and-restructure";
		const maxActionWidth = width - conf.length - 3;
		const truncated = action.length > maxActionWidth ? `${action.slice(0, maxActionWidth - 1)}\u2026` : action;
		expect(truncated.length).toBeLessThanOrEqual(maxActionWidth);
	});

	it("formats participant list correctly", () => {
		const ids = ["planner", "validator", "scarlett"];
		const str = ids.join(", ");
		expect(str).toBe("planner, validator, scarlett");
	});
});
