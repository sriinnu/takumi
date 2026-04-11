import type { AppCommandContext } from "../../commands/app-command-context.js";
import {
	findMissingTemplateParams,
	getBuiltInPromptTemplate,
	listBuiltInPromptTemplates,
	parseTemplateParams,
	renderBuiltInPromptTemplate,
} from "../../prompt-templates.js";
import type { SlashCommandPack } from "../pack.js";

const TEMPLATE_USAGE = "Usage: /template [list|show <id>|run <id> key=value ...]";

function formatTemplateList(): string {
	const templates = listBuiltInPromptTemplates();
	return [
		"Built-in templates:",
		...templates.map((template) => {
			const params = template.params.length > 0 ? ` (${template.params.join(", ")})` : "";
			return `  ${template.id.padEnd(10)} ${template.summary}${params}`;
		}),
		"",
		"Usage:",
		"  /template show <id>",
		"  /template run <id> key=value ...",
	].join("\n");
}

function formatTemplateDetails(template: NonNullable<ReturnType<typeof getBuiltInPromptTemplate>>): string {
	return [
		`Template: ${template.id}`,
		`Summary : ${template.summary}`,
		`Params   : ${template.params.join(", ") || "none"}`,
		"",
		template.source,
	].join("\n");
}

/**
 * I register the built-in prompt-template slash-command family through the
 * shared pack contract so the registry can surface origin metadata uniformly.
 */
export function createTemplateSlashCommandPack(ctx: AppCommandContext): SlashCommandPack {
	return {
		id: "builtin.template",
		label: "Templates",
		source: "builtin",
		commands: [
			{
				name: "/template",
				description: "List, inspect, or run built-in prompt templates",
				aliases: ["/tmpl"],
				handler: async (args) => {
					const trimmed = args.trim();
					if (!trimmed || trimmed === "list") {
						ctx.addInfoMessage(formatTemplateList());
						return;
					}

					const [subcommand, templateId, ...rest] = trimmed.split(/\s+/);
					if (!templateId) {
						ctx.addInfoMessage(TEMPLATE_USAGE);
						return;
					}

					const template = getBuiltInPromptTemplate(templateId);
					if (!template) {
						ctx.addInfoMessage(`Unknown template: ${templateId}`);
						return;
					}

					if (subcommand === "show") {
						ctx.addInfoMessage(formatTemplateDetails(template));
						return;
					}

					if (subcommand !== "run" && subcommand !== "use") {
						ctx.addInfoMessage(TEMPLATE_USAGE);
						return;
					}

					const params = parseTemplateParams(rest.join(" "));
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
			},
		],
	};
}
