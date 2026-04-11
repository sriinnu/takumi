import type { ConventionFiles } from "@takumi/agent";
import type { AppCommandContext } from "../../commands/app-command-context.js";
import type { SlashCommandPack } from "../pack.js";

const SKILLS_USAGE = "Usage: /skills [list|summary|show <index|name|path>]";

function formatSkillSummary(skills: ConventionFiles["skills"]): string {
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

function formatSkillList(skills: ConventionFiles["skills"]): string {
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

function formatSkillDetail(skill: ConventionFiles["skills"][number]): string {
	return [
		skill.name,
		`Source: ${skill.source}`,
		`Always-on: ${skill.alwaysOn ? "yes" : "no"}`,
		`Tags: ${skill.tags.length > 0 ? skill.tags.join(", ") : "none"}`,
		`Path: ${skill.path}`,
		`Description: ${skill.description}`,
	].join("\n");
}

function formatConventionSummary(conventionFiles: ConventionFiles): string {
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

function selectSkill(skills: ConventionFiles["skills"], selector: string): ConventionFiles["skills"][number] | null {
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

/**
 * I group the local skills + convention inspection commands into one builtin
 * pack because they share the same convention-file runtime dependency.
 */
export function createConventionInspectionSlashCommandPack(ctx: AppCommandContext): SlashCommandPack {
	return {
		id: "builtin.conventions",
		label: "Conventions",
		source: "builtin",
		commands: [
			{
				name: "/skills",
				description: "Inspect loaded local skills",
				handler: (args) => {
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

					ctx.addInfoMessage(SKILLS_USAGE);
				},
			},
			{
				name: "/conventions",
				description: "Inspect loaded convention files",
				handler: () => {
					const conventionFiles = ctx.getConventionFiles();
					if (!conventionFiles || conventionFiles.loadedFiles.length === 0) {
						ctx.addInfoMessage("No local convention files are loaded.");
						return;
					}

					ctx.addInfoMessage(formatConventionSummary(conventionFiles));
				},
			},
		],
	};
}
