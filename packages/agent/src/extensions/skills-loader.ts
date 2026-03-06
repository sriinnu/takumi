import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";

export interface LoadedSkill {
	name: string;
	description: string;
	prompt: string;
	path: string;
	alwaysOn: boolean;
	tags: string[];
}

export interface LoadedSkillsResult {
	skills: LoadedSkill[];
	loadedFiles: string[];
	promptAddon: string | null;
}

interface SkillFrontmatter {
	name?: string;
	description?: string;
	alwaysOn?: boolean;
	tags?: string[];
}

export function loadSkills(cwd: string): LoadedSkillsResult {
	const roots = [join(cwd, ".takumi", "skills"), join(homedir(), ".takumi", "skills")];
	const skills: LoadedSkill[] = [];
	const loadedFiles: string[] = [];

	for (const root of roots) {
		if (!existsSync(root)) {
			continue;
		}

		for (const filePath of walkSkillFiles(root)) {
			const skill = parseSkillFile(filePath);
			if (!skill) {
				continue;
			}
			skills.push(skill);
			loadedFiles.push(filePath);
		}
	}

	skills.sort((a, b) => Number(b.alwaysOn) - Number(a.alwaysOn) || a.name.localeCompare(b.name));

	return {
		skills,
		loadedFiles,
		promptAddon: renderSkillsPrompt(skills),
	};
}

function walkSkillFiles(root: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const fullPath = join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...walkSkillFiles(fullPath));
			continue;
		}
		if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
			files.push(fullPath);
		}
	}
	return files;
}

function parseSkillFile(filePath: string): LoadedSkill | null {
	try {
		const raw = readFileSync(filePath, "utf-8").trim();
		if (!raw) {
			return null;
		}

		const { frontmatter, body } = extractFrontmatter(raw);
		const prompt = body.trim();
		if (!prompt) {
			return null;
		}

		const name = frontmatter.name?.trim() || humanizeName(basename(filePath, ".md"));
		const description =
			frontmatter.description?.trim() || firstSentence(prompt) || `${name} guidance available for this project.`;

		return {
			name,
			description,
			prompt,
			path: filePath,
			alwaysOn: frontmatter.alwaysOn ?? false,
			tags: frontmatter.tags ?? [],
		};
	} catch {
		return null;
	}
}

function extractFrontmatter(raw: string): { frontmatter: SkillFrontmatter; body: string } {
	if (!raw.startsWith("---\n")) {
		return { frontmatter: {}, body: raw };
	}

	const end = raw.indexOf("\n---\n", 4);
	if (end === -1) {
		return { frontmatter: {}, body: raw };
	}

	const header = raw.slice(4, end).trim();
	const body = raw.slice(end + 5);
	const frontmatter: SkillFrontmatter = {};

	for (const line of header.split("\n")) {
		const separator = line.indexOf(":");
		if (separator === -1) {
			continue;
		}
		const key = line.slice(0, separator).trim();
		const value = line.slice(separator + 1).trim();
		switch (key) {
			case "name":
				frontmatter.name = stripQuotes(value);
				break;
			case "description":
				frontmatter.description = stripQuotes(value);
				break;
			case "alwaysOn":
				frontmatter.alwaysOn = value.toLowerCase() === "true";
				break;
			case "tags":
				frontmatter.tags = stripQuotes(value)
					.split(",")
					.map((tag) => tag.trim())
					.filter(Boolean);
				break;
		}
	}

	return { frontmatter, body };
}

function renderSkillsPrompt(skills: LoadedSkill[]): string | null {
	if (skills.length === 0) {
		return null;
	}

	const sections: string[] = ["## Skills System"];
	const activeSkills = skills.filter((skill) => skill.alwaysOn);
	if (activeSkills.length > 0) {
		sections.push("Always-on skills:");
		for (const skill of activeSkills.slice(0, 4)) {
			sections.push(`- ${skill.name}: ${skill.description}`);
			sections.push(indentBlock(trimForPrompt(skill.prompt, 500), "  "));
		}
	}

	const catalogSkills = skills.slice(0, 8);
	sections.push("Available skill catalog:");
	for (const skill of catalogSkills) {
		const tagText = skill.tags.length > 0 ? ` [${skill.tags.join(", ")}]` : "";
		sections.push(`- ${skill.name}${tagText}: ${skill.description}`);
	}

	sections.push("Use the catalog to pick the smallest relevant skill instead of expanding every instruction set.");
	return sections.join("\n");
}

function firstSentence(text: string): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return "";
	}
	const sentenceEnd = normalized.search(/[.!?](\s|$)/);
	if (sentenceEnd === -1) {
		return normalized.slice(0, 140);
	}
	return normalized.slice(0, sentenceEnd + 1);
}

function humanizeName(value: string): string {
	return value
		.split(/[-_]/g)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function stripQuotes(value: string): string {
	return value.replace(/^['"]|['"]$/g, "");
}

function trimForPrompt(value: string, limit: number): string {
	if (value.length <= limit) {
		return value;
	}
	return `${value.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function indentBlock(value: string, prefix: string): string {
	return value
		.split("\n")
		.map((line) => `${prefix}${line}`)
		.join("\n");
}
