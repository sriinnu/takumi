/**
 * Shared command-palette taxonomy.
 *
 * I keep palette grouping and `/help` output on the same categorisation rules
 * so Takumi stops teaching two different mental models for the same command
 * surface. That way lies operator distrust, and honestly we already have enough
 * exciting problems.
 */

export type CommandPaletteGroupId =
	| "recent"
	| "runtime"
	| "sessions"
	| "workflow"
	| "review"
	| "lanes"
	| "files"
	| "extensions"
	| "diagnostics"
	| "other";

export interface CommandPaletteGroupableItem {
	id?: string;
	name: string;
	description: string;
	type: "command" | "keybind";
	aliases?: string[];
	source?: "builtin" | "external";
	originLabel?: string;
}

export interface CommandPaletteGroup<T extends CommandPaletteGroupableItem = CommandPaletteGroupableItem> {
	id: CommandPaletteGroupId;
	label: string;
	items: T[];
}

const GROUP_ORDER: readonly CommandPaletteGroupId[] = [
	"recent",
	"runtime",
	"sessions",
	"workflow",
	"review",
	"lanes",
	"files",
	"extensions",
	"diagnostics",
	"other",
];

const GROUP_LABELS: Record<CommandPaletteGroupId, string> = {
	recent: "Recent",
	runtime: "Runtime",
	sessions: "Sessions",
	workflow: "Workflow",
	review: "Review",
	lanes: "Lanes",
	files: "Files",
	extensions: "Extensions",
	diagnostics: "Diagnostics",
	other: "Other",
};

const RUNTIME_COMMANDS = new Set([
	"/budget",
	"/clear",
	"/compact",
	"/config",
	"/help",
	"/keybindings",
	"/model",
	"/permission",
	"/provider",
	"/quit",
	"/status",
	"/theme",
	"/think",
]);

const SESSION_COMMANDS = new Set([
	"/branch",
	"/fork",
	"/handoffs",
	"/parent",
	"/reattach",
	"/replay",
	"/resume",
	"/session",
	"/session-tree",
	"/sessions",
	"/siblings",
	"/switch",
]);

const WORKFLOW_COMMANDS = new Set([
	"/article",
	"/build",
	"/co-plan",
	"/commit-msg",
	"/context-prune",
	"/design",
	"/doc-refactor",
	"/env-audit",
	"/memory",
	"/plan",
	"/pr-desc",
	"/question-chain",
	"/q-chain",
	"/questions",
	"/reflect",
	"/route-plan",
	"/security-scan",
	"/staff-plan",
	"/team",
	"/team-plan",
	"/test",
	"/worktree-spin",
]);

const REVIEW_COMMANDS = new Set([
	"/approvals",
	"/checkpoint",
	"/cluster",
	"/co-validate",
	"/context",
	"/cost",
	"/diff",
	"/eval-gate",
	"/fleet",
	"/review",
	"/validate",
]);

const FILE_COMMANDS = new Set([
	"/editor",
	"/export",
	"/files",
	"/image",
	"/import",
	"/index",
	"/share",
	"/tree",
	"/undo",
]);

const EXTENSION_COMMANDS = new Set([
	"/conventions",
	"/extensions",
	"/ide",
	"/init",
	"/packages",
	"/skills",
	"/template",
	"/tools",
]);

/**
 * I return a stable synthetic key for recent-item tracking and grouped display.
 */
export function getCommandPaletteItemKey(item: CommandPaletteGroupableItem): string {
	return `${item.type}:${(item.id || item.name).toLowerCase()}`;
}

/**
 * I expose group labels so the overlay and `/help` speak the same language.
 */
export function getCommandPaletteGroupLabel(groupId: CommandPaletteGroupId): string {
	return GROUP_LABELS[groupId];
}

/**
 * I categorise one palette item using explicit operator-facing intent first,
 * then a couple of safe fallbacks for unknown extension or future commands.
 */
export function getCommandPaletteGroupId(item: CommandPaletteGroupableItem): CommandPaletteGroupId {
	if (item.type === "keybind") {
		return classifyKeybinding(item);
	}

	const name = item.name.toLowerCase();
	if (RUNTIME_COMMANDS.has(name)) return "runtime";
	if (SESSION_COMMANDS.has(name)) return "sessions";
	if (WORKFLOW_COMMANDS.has(name)) return "workflow";
	if (REVIEW_COMMANDS.has(name)) return "review";
	if (FILE_COMMANDS.has(name)) return "files";
	if (EXTENSION_COMMANDS.has(name)) return "extensions";
	if (item.source === "external") return "extensions";
	if (isLaneCommand(name)) return "lanes";
	if (isDiagnosticCommand(name)) return "diagnostics";
	return "other";
}

/**
 * I group items into stable operator sections. When recent actions are
 * available, I pull them into their own leading section and remove duplicates
 * from the later groups.
 */
export function groupCommandPaletteItems<T extends CommandPaletteGroupableItem>(
	items: readonly T[],
	recentItemKeys: readonly string[] = [],
): CommandPaletteGroup<T>[] {
	const itemByKey = new Map(items.map((item) => [getCommandPaletteItemKey(item), item]));
	const consumed = new Set<string>();
	const groups = new Map<CommandPaletteGroupId, T[]>();

	const recentItems = recentItemKeys.map((key) => itemByKey.get(key)).filter((item): item is T => Boolean(item));
	if (recentItems.length > 0) {
		groups.set("recent", recentItems);
		for (const item of recentItems) {
			consumed.add(getCommandPaletteItemKey(item));
		}
	}

	for (const item of items) {
		const key = getCommandPaletteItemKey(item);
		if (consumed.has(key)) continue;
		const groupId = getCommandPaletteGroupId(item);
		const bucket = groups.get(groupId) ?? [];
		bucket.push(item);
		groups.set(groupId, bucket);
	}

	return GROUP_ORDER.flatMap((groupId) => {
		const bucket = groups.get(groupId);
		if (!bucket || bucket.length === 0) return [];
		return [{ id: groupId, label: GROUP_LABELS[groupId], items: bucket } satisfies CommandPaletteGroup<T>];
	});
}

/**
 * I render `/help` as grouped text instead of one giant undifferentiated wall.
 */
export function formatGroupedCommandHelp(items: readonly CommandPaletteGroupableItem[]): string {
	const groups = groupCommandPaletteItems(items);
	const sections = groups.map((group) => {
		const lines = group.items.map((item) => {
			const originSuffix = item.originLabel ? ` [${item.originLabel}]` : "";
			return `  ${item.name.padEnd(18)} ${item.description}${originSuffix}`;
		});
		return `${group.label}\n${lines.join("\n")}`;
	});

	return [
		"Available commands:",
		"",
		...sections.flatMap((section, index) => (index === 0 ? [section] : ["", section])),
		"",
		"Tip: Ctrl+K opens the command palette. Type to filter, Enter to execute.",
	].join("\n");
}

function classifyKeybinding(item: CommandPaletteGroupableItem): CommandPaletteGroupId {
	const key = (item.id ?? "").toLowerCase();
	const name = item.name.toLowerCase();
	const description = item.description.toLowerCase();
	if (
		key === "app.command-palette.toggle" ||
		key === "app.model-picker.toggle" ||
		key === "app.model.cycle" ||
		key === "app.preview.toggle" ||
		key === "app.sidebar.toggle" ||
		key === "app.thinking.cycle" ||
		name === "ctrl+k" ||
		description.includes("command palette")
	) {
		return "runtime";
	}
	if (key === "app.sessions.list" || key === "app.sessions.tree" || description.includes("session")) {
		return "sessions";
	}
	if (key === "app.cluster-status.toggle") {
		return "lanes";
	}
	if (key === "app.editor.external") {
		return "files";
	}
	if (
		key === "app.quit" ||
		key === "app.screen.clear" ||
		key === "app.exit-if-editor-empty" ||
		name === "ctrl+q" ||
		description.includes("quit") ||
		description.includes("clear screen")
	) {
		return "diagnostics";
	}
	return "other";
}

function isLaneCommand(name: string): boolean {
	return (
		name.startsWith("/lane") || name === "/artifacts" || name === "/isolation" || name === "/route" || name === "/sabha"
	);
}

function isDiagnosticCommand(name: string): boolean {
	return (
		name === "/autocycle-cancel" ||
		name === "/capabilities" ||
		name === "/consolidate" ||
		name === "/csession" ||
		name === "/daemon" ||
		name === "/day" ||
		name === "/facts" ||
		name === "/healthcaps" ||
		name === "/healthx" ||
		name === "/patterns" ||
		name === "/predict" ||
		name === "/track" ||
		name === "/turns" ||
		name === "/vidhi"
	);
}
