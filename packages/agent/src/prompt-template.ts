/**
 * @file prompt-template.ts
 * @module prompt-template
 *
 * Lightweight parameterised prompt template engine.
 *
 * Supports `{{param}}` placeholders, conditional blocks `{{#if key}}...{{/if}}`,
 * and `{{#each list}}...{{/each}}` iteration.  No external dependencies.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single template parameter value. */
export type TemplateValue = string | number | boolean | string[] | undefined;

/** Parameter map supplied when rendering a template. */
export type TemplateParams = Record<string, TemplateValue>;

/** A compiled prompt template ready for repeated rendering. */
export interface PromptTemplate {
	/** The raw template source. */
	readonly source: string;
	/** Parameter names discovered in the template. */
	readonly params: ReadonlySet<string>;
	/** Render the template with the given parameters. */
	render(params: TemplateParams): string;
}

// ─── Regex ───────────────────────────────────────────────────────────────────

const VAR_RE = /\{\{([a-zA-Z_]\w*)\}\}/g;
const IF_RE = /\{\{#if\s+([a-zA-Z_]\w*)\}\}([\s\S]*?)\{\{\/if\}\}/g;
const EACH_RE = /\{\{#each\s+([a-zA-Z_]\w*)\}\}([\s\S]*?)\{\{\/each\}\}/g;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isTruthy(v: TemplateValue): boolean {
	if (v === undefined || v === false || v === "") return false;
	if (Array.isArray(v)) return v.length > 0;
	return true;
}

function stringify(v: TemplateValue): string {
	if (v === undefined) return "";
	if (Array.isArray(v)) return v.join(", ");
	return String(v);
}

/** Collect all distinct `{{param}}` names from source (includes block keys). */
function extractParams(source: string): Set<string> {
	const names = new Set<string>();
	for (const m of source.matchAll(VAR_RE)) names.add(m[1]);
	for (const m of source.matchAll(IF_RE)) names.add(m[1]);
	for (const m of source.matchAll(EACH_RE)) names.add(m[1]);
	return names;
}

// ─── Core render ─────────────────────────────────────────────────────────────

function renderSource(source: string, params: TemplateParams): string {
	let out = source;

	// 1. {{#each list}}...{{/each}}
	out = out.replace(EACH_RE, (_full, key: string, body: string) => {
		const val = params[key];
		if (!Array.isArray(val) || val.length === 0) return "";
		return val.map((item) => body.replace(/\{\{item\}\}/g, item)).join("");
	});

	// 2. {{#if key}}...{{/if}}
	out = out.replace(IF_RE, (_full, key: string, body: string) => {
		return isTruthy(params[key]) ? body : "";
	});

	// 3. {{var}}
	out = out.replace(VAR_RE, (_full, key: string) => stringify(params[key]));

	return out;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Compile a template string into a reusable {@link PromptTemplate}.
 *
 * ```ts
 * const t = compileTemplate("Review {{file}} for {{focus}}.");
 * t.render({ file: "main.ts", focus: "security" });
 * ```
 */
export function compileTemplate(source: string): PromptTemplate {
	const params = extractParams(source);
	return {
		source,
		params,
		render: (p: TemplateParams) => renderSource(source, p),
	};
}

/**
 * One-shot render: compile + render in a single call.
 *
 * Prefer {@link compileTemplate} when the same template is rendered many times.
 */
export function renderTemplate(source: string, params: TemplateParams): string {
	return renderSource(source, params);
}
