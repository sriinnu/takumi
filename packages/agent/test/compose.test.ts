/**
 * Tests for Tool Compose Pipelines (Phase 31).
 */

import { describe, expect, it, vi } from "vitest";
import { executePipeline, type PipelineSpec } from "../src/tools/compose.js";
import { ToolRegistry } from "../src/tools/registry.js";

function createTestRegistry(): ToolRegistry {
	const registry = new ToolRegistry();

	registry.register(
		{
			name: "echo",
			description: "Echoes input back",
			inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
			requiresPermission: false,
			category: "read",
		},
		async (input) => ({ output: String(input.text), isError: false }),
	);

	registry.register(
		{
			name: "upper",
			description: "Uppercases input",
			inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
			requiresPermission: false,
			category: "read",
		},
		async (input) => ({ output: String(input.text).toUpperCase(), isError: false }),
	);

	registry.register(
		{
			name: "fail_tool",
			description: "Always fails",
			inputSchema: { type: "object", properties: {}, required: [] },
			requiresPermission: false,
			category: "read",
		},
		async () => ({ output: "Something went wrong", isError: true }),
	);

	return registry;
}

describe("executePipeline", () => {
	it("runs a single-step pipeline", async () => {
		const registry = createTestRegistry();
		const spec: PipelineSpec = {
			name: "single",
			steps: [{ tool: "echo", input: { text: "hello" } }],
		};

		const result = await executePipeline(spec, registry);
		expect(result.success).toBe(true);
		expect(result.finalOutput).toBe("hello");
		expect(result.steps).toHaveLength(1);
	});

	it("pipes output via $prev", async () => {
		const registry = createTestRegistry();
		const spec: PipelineSpec = {
			name: "pipe-test",
			steps: [
				{ tool: "echo", input: { text: "hello world" } },
				{ tool: "upper", input: { text: "$prev" } },
			],
		};

		const result = await executePipeline(spec, registry);
		expect(result.success).toBe(true);
		expect(result.finalOutput).toBe("HELLO WORLD");
	});

	it("aborts on error by default", async () => {
		const registry = createTestRegistry();
		const spec: PipelineSpec = {
			name: "abort-test",
			steps: [
				{ tool: "fail_tool", input: {} },
				{ tool: "echo", input: { text: "should not run" } },
			],
		};

		const result = await executePipeline(spec, registry);
		expect(result.success).toBe(false);
		expect(result.steps).toHaveLength(1);
	});

	it("continues on error when abortOnError is false", async () => {
		const registry = createTestRegistry();
		const spec: PipelineSpec = {
			name: "continue-test",
			steps: [
				{ tool: "fail_tool", input: {} },
				{ tool: "echo", input: { text: "still running" } },
			],
			abortOnError: false,
		};

		const result = await executePipeline(spec, registry);
		expect(result.success).toBe(false);
		expect(result.steps).toHaveLength(2);
		expect(result.finalOutput).toBe("still running");
	});

	it("handles unknown tool gracefully", async () => {
		const registry = createTestRegistry();
		const spec: PipelineSpec = {
			name: "unknown",
			steps: [{ tool: "nonexistent", input: {} }],
		};

		const result = await executePipeline(spec, registry);
		expect(result.success).toBe(false);
		expect(result.steps[0].isError).toBe(true);
		expect(result.steps[0].output).toContain("nonexistent");
	});

	it("tracks timing for each step", async () => {
		const registry = createTestRegistry();
		const spec: PipelineSpec = {
			name: "timing",
			steps: [
				{ tool: "echo", input: { text: "a" } },
				{ tool: "upper", input: { text: "$prev" } },
			],
		};

		const result = await executePipeline(spec, registry);
		expect(result.totalMs).toBeGreaterThanOrEqual(0);
		for (const step of result.steps) {
			expect(step.durationMs).toBeGreaterThanOrEqual(0);
		}
	});

	it("resolves $prev in nested objects", async () => {
		const registry = createTestRegistry();
		const spec: PipelineSpec = {
			name: "nested",
			steps: [
				{ tool: "echo", input: { text: "data" } },
				{ tool: "echo", input: { text: "got: $prev" } },
			],
		};

		const result = await executePipeline(spec, registry);
		expect(result.finalOutput).toBe("got: data");
	});

	it("does not allow permission-required steps to bypass the registry gate", async () => {
		const registry = createTestRegistry();
		const writer = vi.fn(async (input: Record<string, unknown>) => ({
			output: `wrote ${input.path}`,
			isError: false,
		}));
		registry.register(
			{
				name: "write_file",
				description: "Writes to disk",
				inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
				requiresPermission: true,
				category: "write",
			},
			writer,
		);

		const spec: PipelineSpec = {
			name: "guarded-write",
			steps: [{ tool: "write_file", input: { path: "/tmp/guarded.txt" } }],
		};

		const result = await executePipeline(spec, registry);
		expect(result.success).toBe(false);
		expect(writer).not.toHaveBeenCalled();
		expect(result.steps[0]?.output).toContain("Permission required");
	});
});
