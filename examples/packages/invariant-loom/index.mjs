const invariants = [];
const touchedSurfaces = [];
const MAX_INVARIANTS = 10;
const MAX_SURFACES = 12;
const LOOM_MARKER = "[Invariant Loom]";

function splitClauses(text) {
	return String(text)
		.split(/[.!?\n]/)
		.map((clause) => clause.trim())
		.filter(Boolean);
}

function looksInvariant(clause) {
	return /\b(must|never|always|keep|preserve|without|avoid|do not|don't|required|cannot)\b/i.test(clause);
}

function pushUnique(target, value, maxSize) {
	if (!value || target.includes(value)) return;
	target.unshift(value);
	if (target.length > maxSize) {
		target.length = maxSize;
	}
}

function extractInvariants(text) {
	return splitClauses(text)
		.filter(looksInvariant)
		.map((clause) => clause.replace(/^[-*\s]+/, ""))
		.slice(0, 6);
}

function fileLikeValues(args) {
	const values = [];
	for (const key of ["filePath", "path", "target", "file", "includePattern"]) {
		if (typeof args?.[key] === "string" && args[key].trim()) {
			values.push(args[key].trim());
		}
	}
	return values;
}

function weavePrompt(systemPrompt) {
	const clean = systemPrompt.includes(LOOM_MARKER)
		? systemPrompt.split(`\n\n${LOOM_MARKER}`)[0]
		: systemPrompt;
	if (invariants.length === 0) return clean;
	return `${clean}\n\n${LOOM_MARKER}\nActive non-negotiables:\n${invariants.map((item) => `- ${item}`).join("\n")}`;
}

function buildReport() {
	const invariantLines = invariants.length > 0 ? invariants.map((item) => `- ${item}`) : ["- none captured yet"];
	const surfaceLines = touchedSurfaces.length > 0 ? touchedSurfaces.map((item) => `- ${item}`) : ["- no file-like surfaces observed yet"];
	return [
		"Invariant Loom report",
		"",
		"Active invariants:",
		...invariantLines,
		"",
		"Touched surfaces:",
		...surfaceLines,
	].join("\n");
}

export default function activate(api) {
	api.on("before_agent_start", async (event) => {
		for (const invariant of extractInvariants(event.prompt)) {
			pushUnique(invariants, invariant, MAX_INVARIANTS);
		}
		if (invariants.length === 0) return undefined;
		return {
			systemPrompt: weavePrompt(event.systemPrompt),
		};
	});

	api.on("tool_call", async (event) => {
		for (const value of fileLikeValues(event.args)) {
			pushUnique(touchedSurfaces, value, MAX_SURFACES);
		}
		return undefined;
	});

	api.registerTool({
		name: "invariant_loom",
		description: "Return the active non-negotiables and touched surfaces for the current run.",
		inputSchema: {
			type: "object",
			properties: {},
		},
		requiresPermission: false,
		category: "read",
		promptSnippet: "Use invariant_loom to recover the real constraints hidden inside a messy task.",
		promptGuidelines: [
			"Call this after long prompts or after compaction-sensitive work.",
			"Use it before editing when you need the hard constraints, not just the latest wording.",
		],
		async execute() {
			return { output: buildReport(), isError: false };
		},
	});

	api.registerCommand("invariant:show", {
		description: "Print the current invariant weave.",
		handler: async () => {
			console.log(buildReport());
		},
	});
}
