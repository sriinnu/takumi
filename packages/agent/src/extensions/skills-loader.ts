import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";

const IGNORED_DIR_NAMES = new Set([".git", "node_modules", "dist", "build", "coverage", ".next"]);

type SkillSource = "project" | "global";

export interface LoadedSkill {
	name: string;
	description: string;
	prompt: string;
	path: string;
	alwaysOn: boolean;
	tags: string[];
	source: SkillSource;
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
	const roots: Array<{ path: string; source: SkillSource }> = [
		{ path: join(homedir(), ".takumi", "skills"), source: "global" },
		{ path: join(cwd, ".takumi", "skills"), source: "project" },
	];
	const skillsByKey = new Map<string, LoadedSkill>();

	for (const root of roots) {
		if (!existsSync(root.path)) {
			continue;
		}

		for (const filePath of walkSkillFiles(root.path)) {
			const skill = parseSkillFile(filePath, root.source);
			if (!skill) {
				continue;
			}
			skillsByKey.set(toSkillKey(skill), skill);
		}
	}

	const skills = [...skillsByKey.values()];
	const loadedFiles = skills.map((skill) => skill.path);

	skills.sort((a, b) => Number(b.alwaysOn) - Number(a.alwaysOn) || a.name.localeCompare(b.name));

	return {
		skills,
		loadedFiles,
		promptAddon: buildSkillsPrompt(skills),
	};
}

export function buildSkillsPrompt(skills: LoadedSkill[], userText?: string, limit = 4): string | null {
	if (skills.length === 0) {
		return null;
	}

	const lines = ["## Skills System"];
	const selected = selectSkillsForPrompt(skills, userText, limit);
	if (selected.length > 0) {
		lines.push("Activated skills:");
		for (const skill of selected) {
			const source = skill.source === "project" ? "project" : "global";
			lines.push(`- ${skill.name} (${source}): ${skill.description}`);
			lines.push(indentBlock(trimForPrompt(skill.prompt, 700), "  "));
		}
	}

	const remaining = skills.filter((skill) => !selected.includes(skill)).slice(0, 8);
	if (remaining.length > 0) {
		lines.push("Available skill catalog:");
		for (const skill of remaining) {
			const tagText = skill.tags.length > 0 ? ` [${skill.tags.join(", ")}]` : "";
			lines.push(`- ${skill.name}${tagText}: ${skill.description}`);
		}
	}

	lines.push("Apply only the skills that materially improve the current task; skip unrelated guidance.");
	return lines.join("\n");
}

export function selectSkillsForPrompt(skills: LoadedSkill[], userText?: string, limit = 4): LoadedSkill[] {
	const alwaysOn = skills.filter((skill) => skill.alwaysOn);
	const scored = skills
		.filter((skill) => !skill.alwaysOn)
		.map((skill) => ({ skill, score: scoreSkill(skill, userText ?? "") }))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
		.map((entry) => entry.skill);

	return [...alwaysOn, ...scored].slice(0, Math.max(limit, alwaysOn.length));
}

function walkSkillFiles(root: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const fullPath = join(root, entry.name);
		if (entry.isDirectory()) {
			if (IGNORED_DIR_NAMES.has(entry.name)) {
				continue;
			}
			files.push(...walkSkillFiles(fullPath));
			continue;
		}
		if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
			files.push(fullPath);
		}
	}
	return files.sort((left, right) => left.localeCompare(right));
}

function parseSkillFile(filePath: string, source: SkillSource): LoadedSkill | null {
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
			source,
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

	const headerLines = header.split("\n");
	for (let index = 0; index < headerLines.length; index++) {
		const line = headerLines[index];
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
			case "tags": {
				if (value.length > 0) {
					frontmatter.tags = parseTagList(value);
					break;
				}

				const items: string[] = [];
				for (let next = index + 1; next < headerLines.length; next++) {
					const candidate = headerLines[next].trim();
					if (!candidate.startsWith("- ")) {
						break;
					}
					items.push(stripQuotes(candidate.slice(2).trim()));
					index = next;
				}
				frontmatter.tags = items;
				break;
			}
		}
	}

	return { frontmatter, body };
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

function parseTagList(value: string): string[] {
	const normalized = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
	return normalized
		.split(",")
		.map((tag) => stripQuotes(tag.trim()))
		.filter(Boolean);
}

function scoreSkill(skill: LoadedSkill, userText: string): number {
	if (!userText.trim()) {
		return 0;
	}

	const queryTokens = tokenize(userText);
	if (queryTokens.size === 0) {
		return 0;
	}

	const haystack = tokenize(`${skill.name} ${skill.description} ${skill.tags.join(" ")}`);
	let score = 0;
	for (const token of haystack) {
		if (queryTokens.has(token)) {
			score += 3;
		}
	}

	for (const tag of skill.tags) {
		if (queryTokens.has(tag.toLowerCase())) {
			score += 4;
		}
	}

	if (skill.source === "project") {
		score += 1;
	}

	return score;
}

function tokenize(value: string): Set<string> {
	return new Set(
		value
			.toLowerCase()
			.split(/[^a-z0-9_+#.-]+/g)
			.filter((token) => token.length > 1),
	);
}

function toSkillKey(skill: LoadedSkill): string {
	return skill.name.toLowerCase();
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
