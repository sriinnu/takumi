import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPIActions, ExtensionContextActions } from "../src/extensions/extension-runner.js";
import { ExtensionRunner } from "../src/extensions/extension-runner.js";
import type { LoadedExtension } from "../src/extensions/extension-types.js";
import {
	buildPackageRuntimeSnapshotFromPaths,
	discoverAndLoadExtensions,
	discoverTakumiPackages,
} from "../src/index.js";

function mockContextActions(): ExtensionContextActions {
	return {
		getModel: () => "claude-sonnet-4-20250514",
		getSessionId: () => "sess-example",
		getCwd: () => process.cwd(),
		isIdle: () => true,
		abort: vi.fn(),
		getContextUsage: () => ({ tokens: 200, contextWindow: 1000, percent: 20 }),
		getSystemPrompt: () => "Base prompt",
		compact: vi.fn(),
		shutdown: vi.fn(),
	};
}

function mockApiActions(): ExtensionAPIActions {
	return {
		sendUserMessage: vi.fn(),
		getActiveTools: () => ["read_file", "apply_patch"],
		setActiveTools: vi.fn(),
		exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
	};
}

function bindRunner(extensions: LoadedExtension[]): ExtensionRunner {
	const runner = new ExtensionRunner(extensions);
	runner.bindActions(mockContextActions(), mockApiActions());
	return runner;
}

describe("example Takumi packages", () => {
	it("discovers the novel example packages from the examples directory", () => {
		const result = discoverTakumiPackages(["./examples/packages"], process.cwd());
		expect(result.errors).toEqual([]);
		expect(result.packages.map((pkg) => pkg.packageName)).toEqual(
			expect.arrayContaining([
				"@takumi/counterfactual-scout",
				"@takumi/invariant-loom",
				"@takumi/negative-space-radar",
			]),
		);
		expect(result.packages.every((pkg) => pkg.warnings.length === 0)).toBe(true);
	});

	it("loads the example package extensions and exposes their tools", async () => {
		const result = await discoverAndLoadExtensions([], process.cwd(), ["./examples/packages"]);
		expect(result.errors).toEqual([]);
		const runner = bindRunner(result.extensions);
		const tools = runner.getAllTools();
		expect(tools.has("counterfactual_scout")).toBe(true);
		expect(tools.has("invariant_loom")).toBe(true);
		expect(tools.has("negative_space_radar")).toBe(true);
	});

	it("builds a clean snapshot for configured example package roots", () => {
		const snapshot = buildPackageRuntimeSnapshotFromPaths(process.cwd(), ["./examples/packages"]);
		expect(snapshot.configuredPackagePaths).toEqual(["./examples/packages"]);
		expect(snapshot.report.errors).toEqual([]);
		expect(snapshot.report.packages.map((pkg) => pkg.packageName)).toEqual(
			expect.arrayContaining([
				"@takumi/counterfactual-scout",
				"@takumi/invariant-loom",
				"@takumi/negative-space-radar",
			]),
		);
	});

	it("counterfactual scout blocks a third identical failed move", async () => {
		const result = await discoverAndLoadExtensions([], process.cwd(), ["./examples/packages"]);
		const runner = bindRunner(result.extensions);

		await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "tc-1",
			toolName: "apply_patch",
			args: { filePath: "src/app.ts" },
		});
		await runner.emitToolResult({
			type: "tool_result",
			toolCallId: "tc-1",
			toolName: "apply_patch",
			result: { output: "patch failed", isError: true },
			isError: true,
		});
		await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "tc-2",
			toolName: "apply_patch",
			args: { filePath: "src/app.ts" },
		});
		await runner.emitToolResult({
			type: "tool_result",
			toolCallId: "tc-2",
			toolName: "apply_patch",
			result: { output: "patch failed again", isError: true },
			isError: true,
		});

		const blocked = await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "tc-3",
			toolName: "apply_patch",
			args: { filePath: "src/app.ts" },
		});
		expect(blocked?.block).toBe(true);
		expect(blocked?.reason).toContain("Counterfactual Scout blocked");
	});

	it("invariant loom weaves non-negotiables into the system prompt", async () => {
		const result = await discoverAndLoadExtensions([], process.cwd(), ["./examples/packages"]);
		const runner = bindRunner(result.extensions);
		const beforeStart = await runner.emitBeforeAgentStart(
			"Must preserve the public API. Do not rename exported functions. Keep tests compatible.",
			"Base prompt",
		);
		expect(beforeStart?.systemPrompt).toContain("[Invariant Loom]");
		expect(beforeStart?.systemPrompt).toContain("Must preserve the public API");
		expect(beforeStart?.systemPrompt).toContain("Do not rename exported functions");
	});

	it("negative space radar reports missing validation after mutation-heavy work", async () => {
		const result = await discoverAndLoadExtensions([], process.cwd(), ["./examples/packages"]);
		const runner = bindRunner(result.extensions);
		await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "tc-write",
			toolName: "apply_patch",
			args: { filePath: "packages/agent/src/loop.ts" },
		});

		const tool = runner.getAllTools().get("negative_space_radar")?.tool;
		const report = await tool?.execute({}, undefined, runner.createContext());
		expect(report?.output).toContain("changes exist without validation or health checks");
	});
});
