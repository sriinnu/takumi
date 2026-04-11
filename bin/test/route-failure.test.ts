import { describe, expect, it } from "vitest";
import { formatRouteIncompatibleFailureMessage, formatStartupAccessFailureMessage } from "../cli/route-failure.js";

describe("startup access formatter", () => {
	it("gives operator-facing next steps instead of a dead-end generic failure", () => {
		const message = formatStartupAccessFailureMessage(new Error("Cannot create provider \"anthropic\": missing API key."));

		expect(message).toContain("could not establish an executable startup route");
		expect(message).toContain("run `takumi doctor`");
		expect(message).toContain("takumi config open");
		expect(message).toContain("Cannot create provider \"anthropic\"");
	});
});

describe("route incompatibility formatter", () => {
	it("explains fail-closed route authority without calling it a generic config issue", () => {
		const message = formatRouteIncompatibleFailureMessage(
			new Error("Chitragupta assigned gemini / gemini-2.5-pro, but Takumi cannot initialize it locally."),
		);

		expect(message).toContain("Route incompatibility:");
		expect(message).toContain("failed closed instead of silently rerouting");
		expect(message).toContain("gemini / gemini-2.5-pro");
	});
});