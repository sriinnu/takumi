import { describe, expect, it } from "vitest";
import { buildTakumiCapabilityHealth, TAKUMI_CAPABILITY } from "../src/takumi-capability.js";

describe("takumi capability", () => {
	it("exports the Takumi executor descriptor", () => {
		expect(TAKUMI_CAPABILITY.id).toBe("adapter.takumi.executor");
		expect(TAKUMI_CAPABILITY.capabilities).toContain("coding.patch-and-validate");
		expect(TAKUMI_CAPABILITY.providerFamily).toBe("takumi");
	});

	it("builds healthy snapshots with sensible defaults", () => {
		const snapshot = buildTakumiCapabilityHealth({ state: "healthy", reason: "all green" });
		expect(snapshot.capabilityId).toBe(TAKUMI_CAPABILITY.id);
		expect(snapshot.state).toBe("healthy");
		expect(snapshot.errorRate).toBe(0);
		expect(snapshot.reason).toBe("all green");
	});

	it("uses degraded defaults when no explicit error rate is provided", () => {
		const snapshot = buildTakumiCapabilityHealth({ state: "degraded" });
		expect(snapshot.errorRate).toBe(0.25);
	});
});
