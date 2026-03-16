import { compileTemplate, renderTemplate, type TemplateParams } from "@takumi/agent";

export interface BuiltInPromptTemplate {
	id: string;
	summary: string;
	source: string;
	params: string[];
}

const BUILT_IN_PROMPT_TEMPLATES: BuiltInPromptTemplate[] = [
	{
		id: "review",
		summary: "Request a code review with a specific focus.",
		source:
			"Review {{file}} with focus on {{focus}}. Call out concrete risks, missing tests, and the smallest safe fix.",
		params: ["file", "focus"],
	},
	{
		id: "bugfix",
		summary: "Frame a bug fix request with constraints.",
		source: "Fix {{issue}} in {{area}}. Preserve existing behavior where possible and validate with {{validation}}.",
		params: ["issue", "area", "validation"],
	},
	{
		id: "refactor",
		summary: "Ask for a refactor with guardrails.",
		source:
			"Refactor {{target}} to improve {{goal}}. Keep public APIs stable{{#if constraints}} and respect these constraints: {{constraints}}{{/if}}.",
		params: ["target", "goal", "constraints"],
	},
	{
		id: "tests",
		summary: "Generate a testing plan or tests for a target surface.",
		source:
			"Write or improve tests for {{target}}. Prioritize {{priority}} and cover edge cases around {{edge_cases}}.",
		params: ["target", "priority", "edge_cases"],
	},
	{
		id: "docs",
		summary: "Draft documentation for a surface or workflow.",
		source: "Draft concise documentation for {{topic}} aimed at {{audience}}. Include setup, usage, and pitfalls.",
		params: ["topic", "audience"],
	},
];

const ARG_RE = /(\w+)=((?:"[^"]*")|(?:'[^']*')|\S+)/g;

function stripQuotes(value: string): string {
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	return value;
}

export function listBuiltInPromptTemplates(): BuiltInPromptTemplate[] {
	return [...BUILT_IN_PROMPT_TEMPLATES];
}

export function getBuiltInPromptTemplate(id: string): BuiltInPromptTemplate | null {
	return BUILT_IN_PROMPT_TEMPLATES.find((template) => template.id === id) ?? null;
}

export function parseTemplateParams(raw: string): TemplateParams {
	const params: TemplateParams = {};
	for (const match of raw.matchAll(ARG_RE)) {
		params[match[1]] = stripQuotes(match[2]);
	}
	return params;
}

export function findMissingTemplateParams(template: BuiltInPromptTemplate, params: TemplateParams): string[] {
	const compiled = compileTemplate(template.source);
	return [...compiled.params].filter((name) => {
		const value = params[name];
		return value === undefined || value === "";
	});
}

export function renderBuiltInPromptTemplate(id: string, params: TemplateParams): string | null {
	const template = getBuiltInPromptTemplate(id);
	if (!template) return null;
	return renderTemplate(template.source, params).trim();
}
