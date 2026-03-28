import type { ToolDefinition } from "@takumi/core";
import type { AppCommandContext } from "./app-command-context.js";
import { inspectExtensionHost } from "./app-extension-host.js";
import {
	formatPackageDetail,
	formatPackageList,
	formatPackageSummary,
	inspectTakumiPackages,
	selectTakumiPackage,
} from "./app-package-inspector.js";

/**
 * I register operator-facing extension inspection commands.
 *
 * I keep this read-only for now so the surface is honest: operators can inspect
 * the live extension runtime without implying install/reload flows exist yet.
 */
export function registerExtensionCommands(ctx: AppCommandContext): void {
	ctx.commands.register("/extensions", "Inspect loaded extensions", (args) => {
		const extensionRunner = ctx.getExtensionRunner();
		if (!extensionRunner) {
			ctx.addInfoMessage("No extension runtime is active.");
			return;
		}

		const snapshot = inspectExtensionHost(extensionRunner);
		if (snapshot.extensionCount === 0) {
			ctx.addInfoMessage("Extension runtime is active, but no extensions are loaded.");
			return;
		}

		const trimmed = args.trim();
		if (!trimmed || trimmed === "list") {
			ctx.addInfoMessage(formatExtensionList(snapshot));
			return;
		}

		if (trimmed === "summary") {
			ctx.addInfoMessage(formatExtensionSummary(snapshot));
			return;
		}

		if (trimmed.startsWith("show ")) {
			const selected = selectExtension(snapshot, trimmed.slice(5).trim());
			if (!selected) {
				ctx.addInfoMessage(
					`Unknown extension: ${trimmed.slice(5).trim() || "(empty)"}\nUse /extensions to list loaded extensions.`,
				);
				return;
			}
			ctx.addInfoMessage(formatExtensionDetail(selected));
			return;
		}

		ctx.addInfoMessage("Usage: /extensions [list|summary|show <index|name|path>]");
	});

	ctx.commands.register("/tools", "Inspect loaded tools", (args) => {
		if (!ctx.agentRunner) {
			ctx.addInfoMessage("No agent runner is active, so no live tool registry is available.");
			return;
		}

		const tools = ctx.agentRunner
			.getTools()
			.getDefinitions()
			.slice()
			.sort((left, right) => left.name.localeCompare(right.name));
		if (tools.length === 0) {
			ctx.addInfoMessage("The live tool registry is empty.");
			return;
		}

		const trimmed = args.trim();
		if (!trimmed || trimmed === "list") {
			ctx.addInfoMessage(formatToolList(tools));
			return;
		}

		if (trimmed === "summary") {
			ctx.addInfoMessage(formatToolSummary(tools));
			return;
		}

		if (trimmed.startsWith("show ")) {
			const tool = tools.find((entry) => entry.name === trimmed.slice(5).trim());
			if (!tool) {
				ctx.addInfoMessage(`Unknown tool: ${trimmed.slice(5).trim() || "(empty)"}\nUse /tools to list loaded tools.`);
				return;
			}
			ctx.addInfoMessage(formatToolDetail(tool));
			return;
		}

		ctx.addInfoMessage("Usage: /tools [list|summary|show <tool-name>]");
	});

	ctx.commands.register("/skills", "Inspect loaded local skills", (args) => {
		const conventionFiles = ctx.getConventionFiles();
		const skills = conventionFiles?.skills ?? [];
		if (skills.length === 0) {
			ctx.addInfoMessage("No local skills are loaded.");
			return;
		}

		const trimmed = args.trim();
		if (!trimmed || trimmed === "list") {
			ctx.addInfoMessage(formatSkillList(skills));
			return;
		}

		if (trimmed === "summary") {
			ctx.addInfoMessage(formatSkillSummary(skills));
			return;
		}

		if (trimmed.startsWith("show ")) {
			const selected = selectSkill(skills, trimmed.slice(5).trim());
			if (!selected) {
				ctx.addInfoMessage(
					`Unknown skill: ${trimmed.slice(5).trim() || "(empty)"}\nUse /skills to list loaded skills.`,
				);
				return;
			}
			ctx.addInfoMessage(formatSkillDetail(selected));
			return;
		}

		ctx.addInfoMessage("Usage: /skills [list|summary|show <index|name|path>]");
	});

	ctx.commands.register("/conventions", "Inspect loaded convention files", () => {
		const conventionFiles = ctx.getConventionFiles();
		if (!conventionFiles || conventionFiles.loadedFiles.length === 0) {
			ctx.addInfoMessage("No local convention files are loaded.");
			return;
		}

		ctx.addInfoMessage(formatConventionSummary(conventionFiles));
	});

	ctx.commands.register(
		"/packages",
		"Inspect discovered Takumi packages",
		(args) => {
			const inspection = inspectTakumiPackages(ctx.config);
			const trimmed = args.trim();
			if (!trimmed || trimmed === "list") {
				ctx.addInfoMessage(formatPackageList(inspection));
				return;
			}

			if (trimmed === "summary") {
				ctx.addInfoMessage(formatPackageSummary(inspection));
				return;
			}

			if (trimmed.startsWith("show ")) {
				const selected = selectTakumiPackage(inspection, trimmed.slice(5).trim());
				if (!selected) {
					ctx.addInfoMessage(
						`Unknown package: ${trimmed.slice(5).trim() || "(empty)"}\nUse /packages to list discovered packages.`,
					);
					return;
				}
				ctx.addInfoMessage(formatPackageDetail(selected));
				return;
			}

			ctx.addInfoMessage("Usage: /packages [list|summary|show <index|name|path>]");
		},
		{ getArgumentCompletions: (partial) => getPackageCommandCompletions(ctx, partial) },
	);
}

function formatExtensionSummary(snapshot: ReturnType<typeof inspectExtensionHost>): string {
	return [
		`Extensions: ${snapshot.extensionCount}`,
		`Commands: ${snapshot.commandCount}`,
		`Shortcuts: ${snapshot.shortcutCount}`,
		`Tools: ${snapshot.toolCount}`,
		`Handlers: ${snapshot.handlerCount}`,
	].join("\n");
}

function formatExtensionList(snapshot: ReturnType<typeof inspectExtensionHost>): string {
	return [
		formatExtensionSummary(snapshot),
		"",
		...snapshot.extensions.map((extension, index) => {
			const headline = `${index + 1}. ${extension.displayName}${extension.version ? `@${extension.version}` : ""}`;
			const description = extension.description ? `   ${extension.description}` : null;
			const counts =
				`   commands:${extension.commandCount} shortcuts:${extension.shortcutCount} ` +
				`tools:${extension.toolCount} handlers:${extension.handlerCount}`;
			return [headline, description, counts].filter(Boolean).join("\n");
		}),
		"",
		"Use /extensions show <index|name|path> for details.",
	].join("\n");
}

function formatExtensionDetail(extension: ReturnType<typeof inspectExtensionHost>["extensions"][number]): string {
	const lines = [
		`${extension.displayName}${extension.version ? `@${extension.version}` : ""}`,
		`Source: ${extension.path}`,
	];
	if (extension.resolvedPath !== extension.path) {
		lines.push(`Resolved: ${extension.resolvedPath}`);
	}
	if (extension.description) {
		lines.push(`Description: ${extension.description}`);
	}
	if (extension.author) {
		lines.push(`Author: ${extension.author}`);
	}
	if (extension.homepage) {
		lines.push(`Homepage: ${extension.homepage}`);
	}
	lines.push(
		`Commands (${extension.commandCount}): ${formatCollection(extension.commands)}`,
		`Shortcuts (${extension.shortcutCount}): ${formatCollection(extension.shortcuts)}`,
		`Tools (${extension.toolCount}): ${formatCollection(extension.tools)}`,
		`Handlers (${extension.handlerCount}): ${formatCollection(extension.events)}`,
	);
	return lines.join("\n");
}

function formatCollection(values: string[]): string {
	return values.length > 0 ? values.join(", ") : "none";
}

function formatToolSummary(tools: ToolDefinition[]): string {
	const permissionCount = tools.filter((tool) => tool.requiresPermission).length;
	const byCategory = new Map<string, number>();
	for (const tool of tools) {
		byCategory.set(tool.category, (byCategory.get(tool.category) ?? 0) + 1);
	}
	const categorySummary = [...byCategory.entries()]
		.sort((left, right) => left[0].localeCompare(right[0]))
		.map(([category, count]) => `${category}:${count}`)
		.join(" ");
	return [
		`Tools: ${tools.length}`,
		`Permission-gated: ${permissionCount}`,
		`Categories: ${categorySummary || "none"}`,
	].join("\n");
}

function formatToolList(tools: ToolDefinition[]): string {
	return [
		formatToolSummary(tools),
		"",
		...tools.map((tool) => {
			const permission = tool.requiresPermission ? "permission" : "no-permission";
			return `${tool.name}  [${tool.category}] [${permission}]`;
		}),
		"",
		"Use /tools show <tool-name> for details.",
	].join("\n");
}

function formatToolDetail(tool: ToolDefinition): string {
	const inputKeys = Object.keys(tool.inputSchema ?? {}).sort((left, right) => left.localeCompare(right));
	return [
		tool.name,
		`Category: ${tool.category}`,
		`Permission: ${tool.requiresPermission ? "required" : "not required"}`,
		`Inputs: ${inputKeys.length > 0 ? inputKeys.join(", ") : "schema-defined"}`,
		`Description: ${tool.description}`,
	].join("\n");
}

function formatSkillSummary(
	skills: NonNullable<ReturnType<AppCommandContext["getConventionFiles"]>>["skills"],
): string {
	const alwaysOnCount = skills.filter((skill) => skill.alwaysOn).length;
	const bySource = new Map<string, number>();
	for (const skill of skills) {
		bySource.set(skill.source, (bySource.get(skill.source) ?? 0) + 1);
	}
	const sourceSummary = [...bySource.entries()]
		.sort((left, right) => left[0].localeCompare(right[0]))
		.map(([source, count]) => `${source}:${count}`)
		.join(" ");
	return [`Skills: ${skills.length}`, `Always-on: ${alwaysOnCount}`, `Sources: ${sourceSummary || "none"}`].join("\n");
}

function formatSkillList(skills: NonNullable<ReturnType<AppCommandContext["getConventionFiles"]>>["skills"]): string {
	return [
		formatSkillSummary(skills),
		"",
		...skills.map((skill, index) => {
			const tags = skill.tags.length > 0 ? ` [${skill.tags.join(", ")}]` : "";
			const alwaysOn = skill.alwaysOn ? " [always-on]" : "";
			return `${index + 1}. ${skill.name}${alwaysOn} [${skill.source}]${tags}`;
		}),
		"",
		"Use /skills show <index|name|path> for details.",
	].join("\n");
}

function formatSkillDetail(
	skill: NonNullable<ReturnType<AppCommandContext["getConventionFiles"]>>["skills"][number],
): string {
	return [
		skill.name,
		`Source: ${skill.source}`,
		`Always-on: ${skill.alwaysOn ? "yes" : "no"}`,
		`Tags: ${skill.tags.length > 0 ? skill.tags.join(", ") : "none"}`,
		`Path: ${skill.path}`,
		`Description: ${skill.description}`,
	].join("\n");
}

function formatConventionSummary(
	conventionFiles: NonNullable<ReturnType<AppCommandContext["getConventionFiles"]>>,
): string {
	return [
		"Convention files",
		`Loaded files: ${conventionFiles.loadedFiles.length}`,
		`System prompt addon: ${conventionFiles.systemPromptAddon ? "yes" : "no"}`,
		`Tool rules: ${conventionFiles.toolRules.length}`,
		`Skills: ${conventionFiles.skills.length}`,
		"",
		...conventionFiles.loadedFiles.map((value) => `- ${value}`),
	].join("\n");
}

function getPackageCommandCompletions(ctx: AppCommandContext, partial: string): string[] {
	const trimmed = partial.trim();
	const inspection = inspectTakumiPackages(ctx.config);
	const packageNames = inspection.packages.map((pkg) => pkg.packageName);
	if (!trimmed) {
		return ["list", "summary", ...packageNames.slice(0, 8).map((name) => `show ${name}`)];
	}
	if ("list".startsWith(trimmed)) {
		return ["list"];
	}
	if ("summary".startsWith(trimmed)) {
		return ["summary"];
	}
	if ("show".startsWith(trimmed)) {
		return ["show"];
	}
	if (trimmed.startsWith("show ")) {
		const selector = trimmed.slice(5).trim().toLowerCase();
		return packageNames
			.filter((name) => name.toLowerCase().includes(selector))
			.slice(0, 12)
			.map((name) => `show ${name}`);
	}
	return [];
}

function selectExtension(
	snapshot: ReturnType<typeof inspectExtensionHost>,
	selector: string,
): ReturnType<typeof inspectExtensionHost>["extensions"][number] | null {
	if (!selector) return null;
	const index = Number.parseInt(selector, 10);
	if (Number.isInteger(index) && index > 0) {
		return snapshot.extensions[index - 1] ?? null;
	}

	const normalized = selector.trim().toLowerCase();
	return (
		snapshot.extensions.find((extension) =>
			[extension.displayName, extension.manifestName, extension.label, extension.path, extension.resolvedPath]
				.filter((value): value is string => typeof value === "string" && value.length > 0)
				.some((value) => value.toLowerCase().includes(normalized)),
		) ?? null
	);
}

function selectSkill(
	skills: NonNullable<ReturnType<AppCommandContext["getConventionFiles"]>>["skills"],
	selector: string,
): NonNullable<ReturnType<AppCommandContext["getConventionFiles"]>>["skills"][number] | null {
	if (!selector) return null;
	const index = Number.parseInt(selector, 10);
	if (Number.isInteger(index) && index > 0) {
		return skills[index - 1] ?? null;
	}

	const normalized = selector.trim().toLowerCase();
	return (
		skills.find((skill) =>
			[skill.name, skill.path, skill.description].some((value) => value.toLowerCase().includes(normalized)),
		) ?? null
	);
}
