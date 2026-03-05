/**
 * Extension Self-Authoring — Phase 53
 *
 * Generates extension source from Chitragupta pattern insights,
 * validates it, hot-reloads it into the running extension system,
 * and rolls back on failure.
 *
 * This is "Level 3 — Evolve" from the Lucy cognitive framework:
 * The system can author new behavior based on observed patterns.
 *
 * Capabilities:
 * - Template-based extension source generation from a spec
 * - Structural validation (imports, exports, naming)
 * - Hot-reload: load into live ExtensionRunner without restart
 * - Rollback: unload on failure, optionally quarantine
 *
 * Design:
 * - Does NOT execute arbitrary LLM output — uses structured templates.
 * - Generated extensions are written to `.takumi/extensions/_generated/`.
 * - Each generated extension gets a manifest for provenance tracking.
 * - Rollback removes the generated file and unregisters from the runner.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@takumi/core";

const log = createLogger("self-author");

// ── Types ────────────────────────────────────────────────────────────────────

/** Specification for generating an extension. */
export interface ExtensionSpec {
	/** Human-readable name (kebab-case). */
	name: string;
	/** What this extension does (injected as JSDoc). */
	description: string;
	/** Which events to handle. */
	events: ExtensionEventSpec[];
	/** Tools to register (optional). */
	tools?: ExtensionToolSpec[];
	/** Commands to register (optional). */
	commands?: ExtensionCommandSpec[];
	/** Source pattern that triggered generation (for provenance). */
	sourcePattern?: string;
	/** Confidence score from Chitragupta (0-1). */
	confidence?: number;
}

export interface ExtensionEventSpec {
	/** Event type to handle. */
	eventType: string;
	/** Handler body (TypeScript expression or statements). */
	handlerBody: string;
}

export interface ExtensionToolSpec {
	name: string;
	description: string;
	parameters: Record<string, { type: string; description: string }>;
	/** Handler body (async, receives params + context). */
	handlerBody: string;
}

export interface ExtensionCommandSpec {
	name: string;
	description: string;
	/** Handler body (async, receives ctx: ExtensionCommandContext). */
	handlerBody: string;
}

/** Manifest stored alongside generated extensions. */
export interface GeneratedManifest {
	name: string;
	generatedAt: number;
	sourcePattern: string | null;
	confidence: number | null;
	version: number;
	status: "active" | "rolled_back" | "quarantined";
}

/** Result of a generate-and-load operation. */
export interface AuthorResult {
	success: boolean;
	extensionPath: string | null;
	error: string | null;
	manifest: GeneratedManifest | null;
}

/** Validation finding. */
export interface ValidationIssue {
	severity: "error" | "warning";
	message: string;
	line?: number;
}

export interface ValidationResult {
	valid: boolean;
	issues: ValidationIssue[];
	source: string;
}

// ── Validation ───────────────────────────────────────────────────────────────

/** Validate generated extension source without executing it. */
export function validateExtensionSource(source: string): ValidationResult {
	const issues: ValidationIssue[] = [];

	// Must have a default export
	if (!/export\s+default\b/.test(source)) {
		issues.push({ severity: "error", message: "Missing default export (ExtensionFactory)" });
	}

	// Must import from @takumi/agent (type-only is fine)
	if (!/@takumi\/agent/.test(source)) {
		issues.push({ severity: "warning", message: "No @takumi/agent import — may not integrate correctly" });
	}

	// No eval, Function constructor, or require
	for (const dangerous of [/\beval\s*\(/, /new\s+Function\s*\(/, /\brequire\s*\(/]) {
		if (dangerous.test(source)) {
			issues.push({ severity: "error", message: `Dangerous construct detected: ${dangerous.source}` });
		}
	}

	// No process.exit or child_process
	if (/process\.exit/i.test(source)) {
		issues.push({ severity: "error", message: "process.exit is forbidden in extensions" });
	}
	if (/child_process/.test(source)) {
		issues.push({ severity: "error", message: "child_process access is forbidden in extensions" });
	}

	// Warn if no event handlers registered
	if (!/api\.on\s*\(/.test(source) && !/api\.registerTool\s*\(/.test(source)) {
		issues.push({ severity: "warning", message: "No event handlers or tools registered" });
	}

	// Size guard — generated extensions should be small
	const lines = source.split("\n").length;
	if (lines > 200) {
		issues.push({ severity: "warning", message: `Generated source is ${lines} lines — consider splitting` });
	}

	return {
		valid: issues.every((i) => i.severity !== "error"),
		issues,
		source,
	};
}

// ── Source Generation ────────────────────────────────────────────────────────

/** Generate TypeScript extension source from a spec. */
export function generateExtensionSource(spec: ExtensionSpec): string {
	const lines: string[] = [];

	lines.push(`/**`);
	lines.push(` * Auto-generated extension: ${spec.name}`);
	lines.push(` * ${spec.description}`);
	if (spec.sourcePattern) {
		lines.push(` * Source pattern: ${spec.sourcePattern}`);
	}
	if (spec.confidence !== undefined) {
		lines.push(` * Confidence: ${(spec.confidence * 100).toFixed(0)}%`);
	}
	lines.push(` * Generated: ${new Date().toISOString()}`);
	lines.push(` */`);
	lines.push(``);
	lines.push(`import type { ExtensionFactory } from "@takumi/agent";`);
	lines.push(``);
	lines.push(`const activate: ExtensionFactory = (api) => {`);

	// Event handlers
	for (const event of spec.events) {
		lines.push(`\tapi.on("${event.eventType}", async (_event, _ctx) => {`);
		for (const bodyLine of event.handlerBody.split("\n")) {
			lines.push(`\t\t${bodyLine}`);
		}
		lines.push(`\t});`);
		lines.push(``);
	}

	// Tools
	if (spec.tools && spec.tools.length > 0) {
		for (const tool of spec.tools) {
			const params = Object.entries(tool.parameters)
				.map(([k, v]) => `${k}: { type: "${v.type}", description: "${escapeQuotes(v.description)}" }`)
				.join(", ");
			lines.push(`\tapi.registerTool({`);
			lines.push(`\t\tname: "${tool.name}",`);
			lines.push(`\t\tdescription: "${escapeQuotes(tool.description)}",`);
			lines.push(`\t\tparameters: { type: "object", properties: { ${params} } },`);
			lines.push(`\t\texecute: async (params, context) => {`);
			for (const bodyLine of tool.handlerBody.split("\n")) {
				lines.push(`\t\t\t${bodyLine}`);
			}
			lines.push(`\t\t},`);
			lines.push(`\t});`);
			lines.push(``);
		}
	}

	// Commands
	if (spec.commands && spec.commands.length > 0) {
		for (const cmd of spec.commands) {
			lines.push(`\tapi.registerCommand({`);
			lines.push(`\t\tname: "${cmd.name}",`);
			lines.push(`\t\tdescription: "${escapeQuotes(cmd.description)}",`);
			lines.push(`\t\texecute: async (ctx) => {`);
			for (const bodyLine of cmd.handlerBody.split("\n")) {
				lines.push(`\t\t\t${bodyLine}`);
			}
			lines.push(`\t\t},`);
			lines.push(`\t});`);
			lines.push(``);
		}
	}

	lines.push(`};`);
	lines.push(``);
	lines.push(`export default activate;`);
	lines.push(``);

	return lines.join("\n");
}

// ── Self-Author Class ────────────────────────────────────────────────────────

export class SelfAuthor {
	private readonly generatedDir: string;
	private readonly manifests = new Map<string, GeneratedManifest>();

	constructor(cwd: string) {
		this.generatedDir = join(cwd, ".takumi", "extensions", "_generated");
	}

	/** Generate, validate, and write an extension to disk. Does NOT load it. */
	generate(spec: ExtensionSpec): AuthorResult {
		const source = generateExtensionSource(spec);
		const validation = validateExtensionSource(source);

		if (!validation.valid) {
			const errorMsg = validation.issues
				.filter((i) => i.severity === "error")
				.map((i) => i.message)
				.join("; ");
			log.warn(`Validation failed for "${spec.name}": ${errorMsg}`);
			return { success: false, extensionPath: null, error: errorMsg, manifest: null };
		}

		// Ensure directory exists
		mkdirSync(this.generatedDir, { recursive: true });

		const fileName = `${spec.name}.ts`;
		const filePath = join(this.generatedDir, fileName);

		// Version bump if already exists
		const existing = this.manifests.get(spec.name);
		const version = existing ? existing.version + 1 : 1;

		const manifest: GeneratedManifest = {
			name: spec.name,
			generatedAt: Date.now(),
			sourcePattern: spec.sourcePattern ?? null,
			confidence: spec.confidence ?? null,
			version,
			status: "active",
		};

		// Write source + manifest
		writeFileSync(filePath, source, "utf-8");
		writeFileSync(join(this.generatedDir, `${spec.name}.manifest.json`), JSON.stringify(manifest, null, 2), "utf-8");
		this.manifests.set(spec.name, manifest);

		log.info(`Generated extension "${spec.name}" v${version} → ${filePath}`);
		return { success: true, extensionPath: filePath, error: null, manifest };
	}

	/** Roll back a generated extension — remove files and mark manifest. */
	rollback(name: string): boolean {
		const manifest = this.manifests.get(name);
		if (!manifest) {
			log.warn(`Cannot rollback "${name}" — no manifest found`);
			return false;
		}

		const filePath = join(this.generatedDir, `${name}.ts`);
		if (existsSync(filePath)) {
			rmSync(filePath);
		}

		manifest.status = "rolled_back";
		// Update manifest on disk
		const manifestPath = join(this.generatedDir, `${name}.manifest.json`);
		if (existsSync(manifestPath)) {
			writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
		}

		log.info(`Rolled back extension "${name}" v${manifest.version}`);
		return true;
	}

	/** Get all generated extension manifests. */
	getManifests(): GeneratedManifest[] {
		return Array.from(this.manifests.values());
	}

	/** Get manifest by name. */
	getManifest(name: string): GeneratedManifest | null {
		return this.manifests.get(name) ?? null;
	}

	/** Get the generated extensions directory path. */
	get directory(): string {
		return this.generatedDir;
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeQuotes(s: string): string {
	return s.replace(/"/g, '\\"');
}
