const counts = {
	reconnaissance: 0,
	mutation: 0,
	validation: 0,
	docs: 0,
};
const recentTools = [];
const MAX_RECENT_TOOLS = 10;

function noteTool(toolName) {
	recentTools.push(toolName);
	if (recentTools.length > MAX_RECENT_TOOLS) {
		recentTools.shift();
	}
}

function markSignals(toolName, args) {
	if (/read|grep|search|list|semantic/i.test(toolName)) counts.reconnaissance += 1;
	if (/write|edit|patch|create/i.test(toolName)) counts.mutation += 1;
	if (/test|check|lint|doctor|build|get_errors/i.test(toolName)) counts.validation += 1;
	const fileSignals = [args?.filePath, args?.path, args?.target, args?.includePattern]
		.filter((value) => typeof value === "string")
		.join(" ");
	if (/\.md\b|README|docs\//i.test(fileSignals)) counts.docs += 1;
}

function repeatedTool() {
	if (recentTools.length < 3) return null;
	const last = recentTools[recentTools.length - 1];
	const streak = recentTools.slice(-3).every((toolName) => toolName === last);
	return streak ? last : null;
}

function blindSpots() {
	const missing = [];
	if (counts.mutation > 0 && counts.reconnaissance === 0) {
		missing.push("changes started without any visible reconnaissance");
	}
	if (counts.mutation > 0 && counts.validation === 0) {
		missing.push("changes exist without validation or health checks");
	}
	if (counts.mutation > 0 && counts.docs === 0) {
		missing.push("implementation drift may not be documented");
	}
	const repeated = repeatedTool();
	if (repeated) {
		missing.push(`single-tool tunnel vision detected around ${repeated}`);
	}
	return missing;
}

function buildReport() {
	const gaps = blindSpots();
	return [
		"Negative Space Radar report",
		"",
		`Reconnaissance moves: ${counts.reconnaissance}`,
		`Mutation moves:      ${counts.mutation}`,
		`Validation moves:    ${counts.validation}`,
		`Docs touches:        ${counts.docs}`,
		"",
		"Blind spots:",
		...(gaps.length > 0 ? gaps.map((gap) => `- ${gap}`) : ["- no major omissions detected"]),
	].join("\n");
}

export default function activate(api) {
	api.on("tool_call", async (event) => {
		noteTool(event.toolName);
		markSignals(event.toolName, event.args ?? {});
		return undefined;
	});

	api.on("before_agent_start", async () => {
		const gaps = blindSpots();
		if (gaps.length === 0) return undefined;
		return {
			injectMessage: {
				content: `Negative Space Radar sees unfinished space: ${gaps.slice(0, 2).join("; ")}.`,
			},
		};
	});

	api.registerTool({
		name: "negative_space_radar",
		description: "Report the meaningful workflow surfaces the run has not touched yet.",
		inputSchema: {
			type: "object",
			properties: {},
		},
		requiresPermission: false,
		category: "read",
		promptSnippet: "Use negative_space_radar when you want to know what the workflow is forgetting.",
		promptGuidelines: [
			"Call this before declaring a task done.",
			"Prefer it after a burst of edits or repeated validation loops.",
		],
		async execute() {
			return { output: buildReport(), isError: false };
		},
	});

	api.registerCommand("blindspot:show", {
		description: "Print the current Negative Space Radar report.",
		handler: async () => {
			console.log(buildReport());
		},
	});
}
