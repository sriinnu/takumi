/**
 * Tests for Extension Self-Authoring — Phase 53
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type ExtensionSpec,
	generateExtensionSource,
	SelfAuthor,
	validateExtensionSource,
} from "../src/extensions/self-author.js";

// ── Validation ───────────────────────────────────────────────────────────────

describe("validateExtensionSource", () => {
	it("passes valid extension source", () => {
		const source = `
import type { ExtensionFactory } from "@takumi/agent";

const activate: ExtensionFactory = (api) => {
	api.on("agent_start", async () => {
		console.log("started");
	});
};

export default activate;
`;
		const result = validateExtensionSource(source);
		expect(result.valid).toBe(true);
		expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
	});

	it("rejects source without default export", () => {
		const source = `const x = 1;`;
		const result = validateExtensionSource(source);
		expect(result.valid).toBe(false);
		expect(result.issues.some((i) => i.message.includes("default export"))).toBe(true);
	});

	it("rejects source with eval", () => {
		const source = `
import type { ExtensionFactory } from "@takumi/agent";
const activate: ExtensionFactory = (api) => { eval("alert(1)"); };
export default activate;
`;
		const result = validateExtensionSource(source);
		expect(result.valid).toBe(false);
		expect(result.issues.some((i) => i.message.includes("eval"))).toBe(true);
	});

	it("rejects source with process.exit", () => {
		const source = `
import type { ExtensionFactory } from "@takumi/agent";
const activate: ExtensionFactory = (api) => { process.exit(1); };
export default activate;
`;
		const result = validateExtensionSource(source);
		expect(result.valid).toBe(false);
		expect(result.issues.some((i) => i.message.includes("process.exit"))).toBe(true);
	});

	it("rejects source with child_process", () => {
		const source = `
import { exec } from "child_process";
import type { ExtensionFactory } from "@takumi/agent";
const activate: ExtensionFactory = (api) => { exec("rm -rf /"); };
export default activate;
`;
		const result = validateExtensionSource(source);
		expect(result.valid).toBe(false);
		expect(result.issues.some((i) => i.message.includes("child_process"))).toBe(true);
	});

	it("warns on missing @takumi/agent import", () => {
		const source = `
const activate = (api) => { api.on("agent_start", () => {}); };
export default activate;
`;
		const result = validateExtensionSource(source);
		expect(result.valid).toBe(true); // warnings don't invalidate
		expect(result.issues.some((i) => i.severity === "warning" && i.message.includes("@takumi/agent"))).toBe(true);
	});

	it("warns when no handlers registered", () => {
		const source = `
import type { ExtensionFactory } from "@takumi/agent";
const activate: ExtensionFactory = () => {};
export default activate;
`;
		const result = validateExtensionSource(source);
		expect(result.valid).toBe(true);
		expect(result.issues.some((i) => i.message.includes("No event handlers"))).toBe(true);
	});

	it("rejects source with new Function", () => {
		const source = `
import type { ExtensionFactory } from "@takumi/agent";
const activate: ExtensionFactory = (api) => { new Function("return 1")(); };
export default activate;
`;
		const result = validateExtensionSource(source);
		expect(result.valid).toBe(false);
	});
});

// ── Source Generation ────────────────────────────────────────────────────────

describe("generateExtensionSource", () => {
	it("generates source with event handler", () => {
		const spec: ExtensionSpec = {
			name: "test-ext",
			description: "A test extension",
			events: [{ eventType: "agent_start", handlerBody: 'console.log("hello");' }],
		};
		const source = generateExtensionSource(spec);
		expect(source).toContain("export default activate;");
		expect(source).toContain("@takumi/agent");
		expect(source).toContain('api.on("agent_start"');
		expect(source).toContain('console.log("hello");');
	});

	it("generates source with tool registration", () => {
		const spec: ExtensionSpec = {
			name: "tool-ext",
			description: "Tool extension",
			events: [],
			tools: [
				{
					name: "my_tool",
					description: "Does stuff",
					parameters: { query: { type: "string", description: "Search query" } },
					handlerBody: 'return { content: "ok" };',
				},
			],
		};
		const source = generateExtensionSource(spec);
		expect(source).toContain("api.registerTool(");
		expect(source).toContain('"my_tool"');
		expect(source).toContain('"Does stuff"');
	});

	it("generates source with command registration", () => {
		const spec: ExtensionSpec = {
			name: "cmd-ext",
			description: "Command extension",
			events: [],
			commands: [
				{
					name: "greet",
					description: "Say hello",
					handlerBody: 'console.log("hi");',
				},
			],
		};
		const source = generateExtensionSource(spec);
		expect(source).toContain("api.registerCommand(");
		expect(source).toContain('"greet"');
	});

	it("includes provenance metadata in JSDoc", () => {
		const spec: ExtensionSpec = {
			name: "provenance-ext",
			description: "Tracked",
			events: [],
			sourcePattern: "read→edit→bash",
			confidence: 0.92,
		};
		const source = generateExtensionSource(spec);
		expect(source).toContain("Source pattern: read→edit→bash");
		expect(source).toContain("Confidence: 92%");
	});

	it("generated source passes validation", () => {
		const spec: ExtensionSpec = {
			name: "valid-gen",
			description: "Auto-generated",
			events: [{ eventType: "turn_start", handlerBody: "// no-op" }],
		};
		const source = generateExtensionSource(spec);
		const result = validateExtensionSource(source);
		expect(result.valid).toBe(true);
	});
});

// ── SelfAuthor class ─────────────────────────────────────────────────────────

describe("SelfAuthor", () => {
	const testDir = join(tmpdir(), `takumi-test-selfauthor-${Date.now()}`);

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
	});

	it("generates and writes extension to disk", () => {
		const author = new SelfAuthor(testDir);
		const result = author.generate({
			name: "disk-ext",
			description: "Written to disk",
			events: [{ eventType: "agent_start", handlerBody: "// noop" }],
		});

		expect(result.success).toBe(true);
		expect(result.extensionPath).not.toBeNull();
		expect(existsSync(result.extensionPath!)).toBe(true);

		// Manifest written too
		const manifestPath = join(author.directory, "disk-ext.manifest.json");
		expect(existsSync(manifestPath)).toBe(true);
		const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
		expect(manifest.name).toBe("disk-ext");
		expect(manifest.version).toBe(1);
		expect(manifest.status).toBe("active");
	});

	it("fails generation for invalid spec (eval in body)", () => {
		const author = new SelfAuthor(testDir);
		const result = author.generate({
			name: "evil-ext",
			description: "Evil",
			events: [{ eventType: "agent_start", handlerBody: 'eval("bad")' }],
		});
		// NOTE: eval is in handler body but still detected by regex scan of full source
		expect(result.success).toBe(false);
		expect(result.error).toContain("eval");
	});

	it("rolls back a generated extension", () => {
		const author = new SelfAuthor(testDir);
		author.generate({
			name: "rollback-ext",
			description: "Will be rolled back",
			events: [{ eventType: "agent_start", handlerBody: "// noop" }],
		});

		const result = author.rollback("rollback-ext");
		expect(result).toBe(true);

		const filePath = join(author.directory, "rollback-ext.ts");
		expect(existsSync(filePath)).toBe(false);

		const manifest = author.getManifest("rollback-ext");
		expect(manifest!.status).toBe("rolled_back");
	});

	it("rollback returns false for unknown extension", () => {
		const author = new SelfAuthor(testDir);
		expect(author.rollback("nonexistent")).toBe(false);
	});

	it("bumps version on re-generation", () => {
		const author = new SelfAuthor(testDir);
		const spec: ExtensionSpec = {
			name: "versioned",
			description: "v1",
			events: [{ eventType: "agent_start", handlerBody: "// v1" }],
		};

		author.generate(spec);
		expect(author.getManifest("versioned")!.version).toBe(1);

		author.generate({ ...spec, description: "v2" });
		expect(author.getManifest("versioned")!.version).toBe(2);
	});

	it("getManifests returns all generated", () => {
		const author = new SelfAuthor(testDir);
		author.generate({
			name: "ext-a",
			description: "A",
			events: [{ eventType: "agent_start", handlerBody: "// a" }],
		});
		author.generate({
			name: "ext-b",
			description: "B",
			events: [{ eventType: "agent_start", handlerBody: "// b" }],
		});

		expect(author.getManifests()).toHaveLength(2);
	});

	it("directory getter returns correct path", () => {
		const author = new SelfAuthor("/tmp/test-cwd");
		expect(author.directory).toBe(join("/tmp/test-cwd", ".takumi", "extensions", "_generated"));
	});
});
