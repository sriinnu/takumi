import type { AppCommandContext } from "./app-command-context.js";
import {
	findMissingTemplateParams,
	getBuiltInPromptTemplate,
	listBuiltInPromptTemplates,
	parseTemplateParams,
	renderBuiltInPromptTemplate,
} from "./prompt-templates.js";

export function registerTemplateCommands(ctx: AppCommandContext): void {
	ctx.commands.register(
		"/template",
		"List, inspect, or run built-in prompt templates",
		async (args) => {
			const trimmed = args.trim();
			if (!trimmed || trimmed === "list") {
				const templates = listBuiltInPromptTemplates();
				ctx.addInfoMessage(
					[
						"Built-in templates:",
						...templates.map((template) => {
							const params = template.params.length > 0 ? ` (${template.params.join(", ")})` : "";
							return `  ${template.id.padEnd(10)} ${template.summary}${params}`;
						}),
						"",
						"Usage:",
						"  /template show <id>",
						"  /template run <id> key=value ...",
					].join("\n"),
				);
				return;
			}

			const [subcommand, templateId, ...rest] = trimmed.split(/\s+/);
			if (!templateId) {
				ctx.addInfoMessage("Usage: /template [list|show <id>|run <id> key=value ...]");
				return;
			}

			const template = getBuiltInPromptTemplate(templateId);
			if (!template) {
				ctx.addInfoMessage(`Unknown template: ${templateId}`);
				return;
			}

			if (subcommand === "show") {
				ctx.addInfoMessage(
					[
						`Template: ${template.id}`,
						`Summary : ${template.summary}`,
						`Params   : ${template.params.join(", ") || "none"}`,
						"",
						template.source,
					].join("\n"),
				);
				return;
			}

			if (subcommand !== "run" && subcommand !== "use") {
				ctx.addInfoMessage("Usage: /template [list|show <id>|run <id> key=value ...]");
				return;
			}

			const rawParamText = rest.join(" ");
			const params = parseTemplateParams(rawParamText);
			const missing = findMissingTemplateParams(template, params);
			if (missing.length > 0) {
				ctx.addInfoMessage(`Missing template params for ${template.id}: ${missing.join(", ")}`);
				return;
			}

			const rendered = renderBuiltInPromptTemplate(template.id, params);
			if (!rendered) {
				ctx.addInfoMessage(`Failed to render template: ${template.id}`);
				return;
			}

			if (!ctx.agentRunner) {
				ctx.addInfoMessage(`Rendered template:\n\n${rendered}`);
				return;
			}

			await ctx.agentRunner.submit(rendered);
		},
		["/tmpl"],
	);
}
