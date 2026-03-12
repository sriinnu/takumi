import { describe, expect, it } from "vitest";
import {
	AIDER_CLI_CAPABILITY,
	buildCliCapability,
	buildCliCapabilityHealth,
	CLAUDE_CLI_CAPABILITY,
	CLAUDE_CLI_CONTRACT,
	CODEX_CLI_CAPABILITY,
	DEFAULT_CLI_CAPABILITIES,
	getDefaultLocalCodingCapabilities,
} from "../src/cli-capabilities.js";
import { TAKUMI_CAPABILITY } from "../src/takumi-capability.js";

describe("cli capability presets", () => {
	it("exports concrete presets for common coding CLIs", () => {
		expect(CLAUDE_CLI_CAPABILITY.id).toBe("cli.claude");
		expect(CODEX_CLI_CAPABILITY.id).toBe("cli.codex");
		expect(AIDER_CLI_CAPABILITY.id).toBe("cli.aider");
		expect(DEFAULT_CLI_CAPABILITIES).toHaveLength(3);
	});

	it("builds a cli capability from a generic contract", () => {
		const capability = buildCliCapability({
			id: "cli.custom",
			label: "Custom CLI",
			providerFamily: "custom",
			capabilities: ["agent.delegate.cli-custom"],
			costClass: "low",
			contract: CLAUDE_CLI_CONTRACT,
		});

		expect(capability.kind).toBe("cli");
		expect(capability.invocation.transport).toBe("local-process");
		expect(capability.metadata?.contractId).toBe("agent.delegate.cli-claude");
	});

	it("builds health snapshots for cli capabilities", () => {
		const snapshot = buildCliCapabilityHealth({
			capabilityId: "cli.codex",
			state: "degraded",
			reason: "rate limited",
		});

		expect(snapshot.capabilityId).toBe("cli.codex");
		expect(snapshot.state).toBe("degraded");
		expect(snapshot.errorRate).toBe(0.25);
		expect(snapshot.reason).toBe("rate limited");
	});

	it("bundles the default local coding capabilities with Takumi first", () => {
		const capabilities = getDefaultLocalCodingCapabilities();

		expect(capabilities[0]?.id).toBe(TAKUMI_CAPABILITY.id);
		expect(capabilities.map((capability) => capability.id)).toEqual([
			TAKUMI_CAPABILITY.id,
			CLAUDE_CLI_CAPABILITY.id,
			CODEX_CLI_CAPABILITY.id,
			AIDER_CLI_CAPABILITY.id,
		]);
	});

	it("supports disabling bundled presets and dedupes extra capabilities", () => {
		const capabilities = getDefaultLocalCodingCapabilities({
			includeCliPresets: false,
			extraCapabilities: [TAKUMI_CAPABILITY, CLAUDE_CLI_CAPABILITY],
		});

		expect(capabilities.map((capability) => capability.id)).toEqual([TAKUMI_CAPABILITY.id, CLAUDE_CLI_CAPABILITY.id]);
	});
});
