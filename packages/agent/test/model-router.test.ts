import { describe, expect, it } from "vitest";
import { ModelRouter, recommendRouteClass } from "../src/model-router.js";

describe("ModelRouter", () => {
	it("maps planner work to deep reasoning lanes", () => {
		expect(recommendRouteClass("STANDARD", "PLANNER")).toBe("coding.deep-reasoning");
	});

	it("maps validator roles to review/trust lanes", () => {
		expect(recommendRouteClass("STANDARD", "VALIDATOR_CODE")).toBe("coding.review.strict");
		expect(recommendRouteClass("STANDARD", "VALIDATOR_SECURITY")).toBe("coding.validation-high-trust");
	});

	it("returns a route class plus same-provider fallback model", () => {
		const router = new ModelRouter("anthropic");
		const recommendation = router.recommend("CRITICAL", "WORKER");

		expect(recommendation.routeClass).toBe("coding.deep-reasoning");
		expect(recommendation.provider).toBe("anthropic");
		expect(recommendation.model).toBeTruthy();
		expect(recommendation.rationale).toContain("routeClass=coding.deep-reasoning");
	});

	it("uses a local-fast lane for classifier passes", () => {
		const router = new ModelRouter("anthropic");
		const recommendation = router.recommend("TRIVIAL", "CLASSIFIER");

		expect(recommendation.routeClass).toBe("classification.local-fast");
		expect(recommendation.tier).toBe("fast");
	});
});
