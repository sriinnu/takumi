import type { ToolDefinition, ToolResult } from "@takumi/core";
import { describe, expect, it, vi } from "vitest";
import { type ToolHandler, ToolRegistry } from "../src/tools/registry.js";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function makeDef(name: string, overrides?: Partial<ToolDefinition>): ToolDefinition {
	return {
		name,
		description: `Description for ${name}`,
		inputSchema: { type: "object", properties: {} },
		requiresPermission: false,
		category: "read",
		...overrides,
	};
}

function okHandler(output = "ok"): ToolHandler {
	return async () => ({ output, isError: false });
}

/* ── Tests ──────────────────────────────────────────────────────────────────── */

describe("ToolRegistry", () => {
	/* ---- register -------------------------------------------------------- */

	describe("register", () => {
		it("adds a tool and increases size", () => {
			const reg = new ToolRegistry();
			expect(reg.size).toBe(0);

			reg.register(makeDef("read_file"), okHandler());
			expect(reg.size).toBe(1);
			expect(reg.has("read_file")).toBe(true);
		});

		it("registers multiple distinct tools", () => {
			const reg = new ToolRegistry();
			reg.register(makeDef("read_file"), okHandler());
			reg.register(makeDef("write_file"), okHandler());
			reg.register(makeDef("exec"), okHandler());
			expect(reg.size).toBe(3);
		});

		it("overwrites an existing tool with the same name", () => {
			const reg = new ToolRegistry();
			const firstDef = makeDef("read_file", { description: "v1" });
			const secondDef = makeDef("read_file", { description: "v2" });

			reg.register(firstDef, okHandler("first"));
			reg.register(secondDef, okHandler("second"));

			expect(reg.size).toBe(1);
			expect(reg.getDefinition("read_file")?.description).toBe("v2");
		});

		it("overwrites the handler when re-registering", async () => {
			const reg = new ToolRegistry();
			reg.register(makeDef("tool"), okHandler("first"));
			reg.register(makeDef("tool"), okHandler("second"));

			const result = await reg.execute("tool", {});
			expect(result.output).toBe("second");
		});
	});

	/* ---- unregister ------------------------------------------------------ */

	describe("unregister", () => {
		it("removes a registered tool and decreases size", () => {
			const reg = new ToolRegistry();
			reg.register(makeDef("read_file"), okHandler());
			expect(reg.size).toBe(1);

			const removed = reg.unregister("read_file");
			expect(removed).toBe(true);
			expect(reg.size).toBe(0);
			expect(reg.has("read_file")).toBe(false);
		});

		it("returns false when unregistering an unknown tool", () => {
			const reg = new ToolRegistry();
			expect(reg.unregister("nonexistent")).toBe(false);
		});

		it("returns false when unregistering the same tool twice", () => {
			const reg = new ToolRegistry();
			reg.register(makeDef("tool"), okHandler());
			reg.unregister("tool");
			expect(reg.unregister("tool")).toBe(false);
		});
	});

	/* ---- has ------------------------------------------------------------- */

	describe("has", () => {
		it("returns true for a registered tool", () => {
			const reg = new ToolRegistry();
			reg.register(makeDef("read_file"), okHandler());
			expect(reg.has("read_file")).toBe(true);
		});

		it("returns false for an unregistered tool", () => {
			const reg = new ToolRegistry();
			expect(reg.has("nonexistent")).toBe(false);
		});

		it("returns false after a tool is unregistered", () => {
			const reg = new ToolRegistry();
			reg.register(makeDef("tool"), okHandler());
			reg.unregister("tool");
			expect(reg.has("tool")).toBe(false);
		});
	});

	/* ---- getDefinition --------------------------------------------------- */

	describe("getDefinition", () => {
		it("returns the definition for a registered tool", () => {
			const reg = new ToolRegistry();
			const def = makeDef("read_file", { category: "write", requiresPermission: true });
			reg.register(def, okHandler());

			const retrieved = reg.getDefinition("read_file");
			expect(retrieved).toBeDefined();
			expect(retrieved!.name).toBe("read_file");
			expect(retrieved!.category).toBe("write");
			expect(retrieved!.requiresPermission).toBe(true);
		});

		it("returns undefined for an unknown tool", () => {
			const reg = new ToolRegistry();
			expect(reg.getDefinition("nonexistent")).toBeUndefined();
		});

		it("returns the updated definition after overwrite", () => {
			const reg = new ToolRegistry();
			reg.register(makeDef("tool", { description: "v1" }), okHandler());
			reg.register(makeDef("tool", { description: "v2" }), okHandler());
			expect(reg.getDefinition("tool")?.description).toBe("v2");
		});
	});

	/* ---- getDefinitions -------------------------------------------------- */

	describe("getDefinitions", () => {
		it("returns all registered definitions", () => {
			const reg = new ToolRegistry();
			reg.register(makeDef("a"), okHandler());
			reg.register(makeDef("b"), okHandler());
			reg.register(makeDef("c"), okHandler());

			const defs = reg.getDefinitions();
			expect(defs).toHaveLength(3);
			expect(defs.map((d) => d.name).sort()).toEqual(["a", "b", "c"]);
		});

		it("returns an empty array when no tools are registered", () => {
			const reg = new ToolRegistry();
			expect(reg.getDefinitions()).toEqual([]);
		});

		it("returns a new array on each call (no shared reference)", () => {
			const reg = new ToolRegistry();
			reg.register(makeDef("tool"), okHandler());
			const first = reg.getDefinitions();
			const second = reg.getDefinitions();
			expect(first).not.toBe(second);
			expect(first).toEqual(second);
		});
	});

	/* ---- listNames ------------------------------------------------------- */

	describe("listNames", () => {
		it("returns names of all registered tools", () => {
			const reg = new ToolRegistry();
			reg.register(makeDef("alpha"), okHandler());
			reg.register(makeDef("beta"), okHandler());

			const names = reg.listNames();
			expect(names).toContain("alpha");
			expect(names).toContain("beta");
			expect(names).toHaveLength(2);
		});

		it("returns an empty array when no tools are registered", () => {
			const reg = new ToolRegistry();
			expect(reg.listNames()).toEqual([]);
		});

		it("reflects removals", () => {
			const reg = new ToolRegistry();
			reg.register(makeDef("a"), okHandler());
			reg.register(makeDef("b"), okHandler());
			reg.unregister("a");
			expect(reg.listNames()).toEqual(["b"]);
		});
	});

	/* ---- execute --------------------------------------------------------- */

	describe("execute", () => {
		it("calls the handler with the provided input and returns the result", async () => {
			const reg = new ToolRegistry();
			const handler = vi.fn(async (input: Record<string, unknown>) => ({
				output: `read ${input.path}`,
				isError: false,
			}));

			reg.register(makeDef("read_file"), handler);
			const result = await reg.execute("read_file", { path: "/tmp/file.txt" });

			expect(handler).toHaveBeenCalledOnce();
			expect(handler).toHaveBeenCalledWith({ path: "/tmp/file.txt" }, undefined);
			expect(result.output).toBe("read /tmp/file.txt");
			expect(result.isError).toBe(false);
		});

		it("returns an error result for an unknown tool", async () => {
			const reg = new ToolRegistry();
			reg.register(makeDef("read_file"), okHandler());
			reg.register(makeDef("write_file"), okHandler());

			const result = await reg.execute("nonexistent", {});

			expect(result.isError).toBe(true);
			expect(result.output).toContain("Unknown tool: nonexistent");
			expect(result.output).toContain("read_file");
			expect(result.output).toContain("write_file");
		});

		it("lists all available tool names in the error for an unknown tool", async () => {
			const reg = new ToolRegistry();
			reg.register(makeDef("aaa"), okHandler());
			reg.register(makeDef("bbb"), okHandler());
			reg.register(makeDef("ccc"), okHandler());

			const result = await reg.execute("unknown_tool", {});
			expect(result.isError).toBe(true);
			expect(result.output).toContain("aaa");
			expect(result.output).toContain("bbb");
			expect(result.output).toContain("ccc");
		});

		it("returns an error result when the handler throws an Error", async () => {
			const reg = new ToolRegistry();
			const handler: ToolHandler = async () => {
				throw new Error("disk full");
			};

			reg.register(makeDef("write_file"), handler);
			const result = await reg.execute("write_file", { content: "data" });

			expect(result.isError).toBe(true);
			expect(result.output).toContain("disk full");
			expect(result.output).toContain("Tool execution error");
		});

		it("returns an error result when the handler throws a non-Error value", async () => {
			const reg = new ToolRegistry();
			const handler: ToolHandler = async () => {
				throw "string error";
			};

			reg.register(makeDef("tool"), handler);
			const result = await reg.execute("tool", {});

			expect(result.isError).toBe(true);
			expect(result.output).toContain("string error");
		});

		it("passes the abort signal to the handler", async () => {
			const reg = new ToolRegistry();
			let receivedSignal: AbortSignal | undefined;

			const handler: ToolHandler = async (_input, signal) => {
				receivedSignal = signal;
				return { output: "done", isError: false };
			};

			reg.register(makeDef("long_task"), handler);

			const controller = new AbortController();
			await reg.execute("long_task", {}, controller.signal);

			expect(receivedSignal).toBe(controller.signal);
			expect(receivedSignal!.aborted).toBe(false);
		});

		it("passes undefined signal when none is provided", async () => {
			const reg = new ToolRegistry();
			let receivedSignal: AbortSignal | undefined;
			let signalWasPassed = false;

			const handler: ToolHandler = async (_input, signal) => {
				signalWasPassed = true;
				receivedSignal = signal;
				return { output: "done", isError: false };
			};

			reg.register(makeDef("tool"), handler);
			await reg.execute("tool", {});

			expect(signalWasPassed).toBe(true);
			expect(receivedSignal).toBeUndefined();
		});

		it("returns the exact ToolResult from the handler", async () => {
			const reg = new ToolRegistry();
			const expected: ToolResult = {
				output: "some output",
				isError: false,
				metadata: { lines: 42 },
			};
			const handler: ToolHandler = async () => expected;

			reg.register(makeDef("tool"), handler);
			const result = await reg.execute("tool", {});

			expect(result).toBe(expected);
		});
	});

	/* ---- size ------------------------------------------------------------ */

	describe("size", () => {
		it("is 0 for a fresh registry", () => {
			expect(new ToolRegistry().size).toBe(0);
		});

		it("reflects the number of registered tools", () => {
			const reg = new ToolRegistry();
			reg.register(makeDef("a"), okHandler());
			expect(reg.size).toBe(1);
			reg.register(makeDef("b"), okHandler());
			expect(reg.size).toBe(2);
		});

		it("decreases after unregister", () => {
			const reg = new ToolRegistry();
			reg.register(makeDef("a"), okHandler());
			reg.register(makeDef("b"), okHandler());
			reg.unregister("a");
			expect(reg.size).toBe(1);
		});

		it("does not double-count an overwritten tool", () => {
			const reg = new ToolRegistry();
			reg.register(makeDef("tool"), okHandler());
			reg.register(makeDef("tool"), okHandler());
			expect(reg.size).toBe(1);
		});
	});
});
