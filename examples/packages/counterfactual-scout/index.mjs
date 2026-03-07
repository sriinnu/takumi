const pendingCalls = new Map();
const failureCounts = new Map();
const failureLog = [];
const MAX_FAILURE_LOG = 8;

function stableStringify(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return JSON.stringify(value ?? {});
	}
	const sorted = Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
	return JSON.stringify(sorted);
}

function keyFor(toolName, args) {
	return `${toolName}:${stableStringify(args ?? {})}`;
}

function rememberFailure(entry) {
	failureLog.unshift(entry);
	if (failureLog.length > MAX_FAILURE_LOG) {
		failureLog.length = MAX_FAILURE_LOG;
	}
}

function counterfactualMove(toolName) {
	if (/write|edit|patch|create/i.test(toolName)) return "re-read the target surface and shrink the change";
	if (/test|check|lint|doctor|build/i.test(toolName)) return "inspect the failing artifact before re-running validation";
	if (/grep|search|read|list/i.test(toolName)) return "change the query or widen the search surface instead of repeating it";
	return "change one assumption before repeating the same move";
}

function buildReport() {
	if (failureLog.length === 0) {
		return [
			"Counterfactual Scout has not observed any recent failures.",
			"Current stance: keep exploring, but change assumptions before retrying identical actions.",
		].join("\n");
	}

	const topFailures = failureLog.slice(0, 5).map((entry, index) => {
		const repetitions = failureCounts.get(entry.key) ?? 1;
		return `${index + 1}. ${entry.toolName} failed ${repetitions} time(s) → counterfactual: ${counterfactualMove(entry.toolName)}`;
	});

	return [
		"Counterfactual Scout report",
		"",
		"Recent failure motifs:",
		...topFailures,
		"",
		"Operating rule: if the same move failed twice, do not run it a third time without changing the plan.",
	].join("\n");
}

export default function activate(api) {
	api.on("tool_call", async (event) => {
		const key = keyFor(event.toolName, event.args);
		pendingCalls.set(event.toolCallId, { toolName: event.toolName, args: event.args, key });
		if ((failureCounts.get(key) ?? 0) < 2) return undefined;
		return {
			block: true,
			reason: `Counterfactual Scout blocked a likely retry loop for ${event.toolName}. Change the plan before retrying.`,
		};
	});

	api.on("tool_result", async (event) => {
		const pending = pendingCalls.get(event.toolCallId) ?? {
			toolName: event.toolName,
			args: {},
			key: keyFor(event.toolName, {}),
		};
		pendingCalls.delete(event.toolCallId);
		if (!event.isError) return undefined;
		failureCounts.set(pending.key, (failureCounts.get(pending.key) ?? 0) + 1);
		rememberFailure({ key: pending.key, toolName: pending.toolName, output: event.result.output });
		return undefined;
	});

	api.on("before_agent_start", async () => {
		if (failureLog.length === 0) return undefined;
		return {
			injectMessage: {
				content: `Counterfactual Scout reminder: avoid repeating recent failed moves. ${counterfactualMove(failureLog[0].toolName)}.`,
			},
		};
	});

	api.registerTool({
		name: "counterfactual_scout",
		description: "Summarize recent failures as counterfactual next moves.",
		inputSchema: {
			type: "object",
			properties: {},
		},
		requiresPermission: false,
		category: "read",
		promptSnippet: "Use counterfactual_scout when the run feels stuck or repetitive.",
		promptGuidelines: [
			"Call this before repeating a failed tool action.",
			"Prefer it when you need the opposite move instead of the same move again.",
		],
		async execute() {
			return { output: buildReport(), isError: false };
		},
	});

	api.registerCommand("counterfactual:report", {
		description: "Print the current Counterfactual Scout report.",
		handler: async () => {
			console.log(buildReport());
		},
	});
}
