import type { ToolDefinition } from "@takumi/core";
import type { AppCommandContext } from "../../commands/app-command-context.js";
import type { SlashCommandPack } from "../pack.js";

const TOOLS_USAGE = "Usage: /tools [list|summary|show <tool-name>]";

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

/**
 * I expose the live tool-registry inspection surface through the builtin pack
 * contract so it shares source metadata with other first-party slash commands.
 */
export function createToolsSlashCommandPack(ctx: AppCommandContext): SlashCommandPack {
	return {
		id: "builtin.tools",
		label: "Tools",
		source: "builtin",
		commands: [
			{
				name: "/tools",
				description: "Inspect loaded tools",
				handler: (args) => {
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
							ctx.addInfoMessage(
								`Unknown tool: ${trimmed.slice(5).trim() || "(empty)"}\nUse /tools to list loaded tools.`,
							);
							return;
						}
						ctx.addInfoMessage(formatToolDetail(tool));
						return;
					}

					ctx.addInfoMessage(TOOLS_USAGE);
				},
			},
		],
	};
}
