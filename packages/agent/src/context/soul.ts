/**
 * Soul loader — reads personality, preferences, and identity files
 * from the project's soul/ directory and formats them for the system prompt.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SoulData {
	personality: string | null;
	preferences: string | null;
	identity: string | null;
}

const SOUL_FILES = ["personality.md", "preferences.md", "identity.md"] as const;
const SOUL_KEYS: (keyof SoulData)[] = ["personality", "preferences", "identity"];

/**
 * Load soul data from `<projectRoot>/soul/`.
 * Returns null for any file that is missing or empty.
 */
export function loadSoul(projectRoot: string): SoulData {
	const soulDir = join(projectRoot, "soul");
	const result: SoulData = {
		personality: null,
		preferences: null,
		identity: null,
	};

	if (!existsSync(soulDir)) {
		return result;
	}

	for (let i = 0; i < SOUL_FILES.length; i++) {
		const filePath = join(soulDir, SOUL_FILES[i]);
		if (existsSync(filePath)) {
			const content = readFileSync(filePath, "utf-8").trim();
			if (content.length > 0) {
				result[SOUL_KEYS[i]] = content;
			}
		}
	}

	return result;
}

/**
 * Format soul data into prompt sections.
 * Skips any null fields. Returns empty string if all fields are null.
 */
export function formatSoulPrompt(soul: SoulData): string {
	const sections: string[] = [];

	if (soul.personality) {
		sections.push(`## Personality\n${soul.personality}`);
	}
	if (soul.preferences) {
		sections.push(`## Preferences\n${soul.preferences}`);
	}
	if (soul.identity) {
		sections.push(`## Identity\n${soul.identity}`);
	}

	return sections.join("\n\n");
}
