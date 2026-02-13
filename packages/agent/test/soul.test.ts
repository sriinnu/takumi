import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSoul, formatSoulPrompt, type SoulData } from "../src/context/soul.js";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function createTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "takumi-soul-test-"));
}

function writeSoulFile(root: string, name: string, content: string): void {
	const soulDir = join(root, "soul");
	mkdirSync(soulDir, { recursive: true });
	writeFileSync(join(soulDir, name), content, "utf-8");
}

/* ── loadSoul ──────────────────────────────────────────────────────────────── */

describe("loadSoul", () => {
	/* ---- No soul directory ------------------------------------------------ */

	it("returns all null when soul directory does not exist", () => {
		const root = createTmpDir();
		try {
			const result = loadSoul(root);

			expect(result.personality).toBeNull();
			expect(result.preferences).toBeNull();
			expect(result.identity).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns all null when projectRoot itself does not exist", () => {
		const result = loadSoul("/tmp/nonexistent-soul-dir-" + Date.now());

		expect(result.personality).toBeNull();
		expect(result.preferences).toBeNull();
		expect(result.identity).toBeNull();
	});

	/* ---- All three files present ----------------------------------------- */

	it("loads all three files when they exist", () => {
		const root = createTmpDir();
		try {
			writeSoulFile(root, "personality.md", "You are calm and thoughtful.");
			writeSoulFile(root, "preferences.md", "Use TypeScript. Prefer functional style.");
			writeSoulFile(root, "identity.md", "You are Takumi, a coding assistant.");

			const result = loadSoul(root);

			expect(result.personality).toBe("You are calm and thoughtful.");
			expect(result.preferences).toBe("Use TypeScript. Prefer functional style.");
			expect(result.identity).toBe("You are Takumi, a coding assistant.");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("trims whitespace from loaded content", () => {
		const root = createTmpDir();
		try {
			writeSoulFile(root, "personality.md", "  padded content  \n\n");

			const result = loadSoul(root);

			expect(result.personality).toBe("padded content");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	/* ---- Partial files --------------------------------------------------- */

	it("loads only personality when only personality.md exists", () => {
		const root = createTmpDir();
		try {
			writeSoulFile(root, "personality.md", "Friendly and helpful.");

			const result = loadSoul(root);

			expect(result.personality).toBe("Friendly and helpful.");
			expect(result.preferences).toBeNull();
			expect(result.identity).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("loads only preferences when only preferences.md exists", () => {
		const root = createTmpDir();
		try {
			writeSoulFile(root, "preferences.md", "Always write tests.");

			const result = loadSoul(root);

			expect(result.personality).toBeNull();
			expect(result.preferences).toBe("Always write tests.");
			expect(result.identity).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("loads only identity when only identity.md exists", () => {
		const root = createTmpDir();
		try {
			writeSoulFile(root, "identity.md", "You are a senior engineer.");

			const result = loadSoul(root);

			expect(result.personality).toBeNull();
			expect(result.preferences).toBeNull();
			expect(result.identity).toBe("You are a senior engineer.");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("loads personality and identity but not preferences when preferences.md is missing", () => {
		const root = createTmpDir();
		try {
			writeSoulFile(root, "personality.md", "Concise.");
			writeSoulFile(root, "identity.md", "AI assistant.");

			const result = loadSoul(root);

			expect(result.personality).toBe("Concise.");
			expect(result.preferences).toBeNull();
			expect(result.identity).toBe("AI assistant.");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	/* ---- Empty files ----------------------------------------------------- */

	it("returns null for empty personality.md", () => {
		const root = createTmpDir();
		try {
			writeSoulFile(root, "personality.md", "");

			const result = loadSoul(root);

			expect(result.personality).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns null for whitespace-only files", () => {
		const root = createTmpDir();
		try {
			writeSoulFile(root, "personality.md", "   \n\n\t  ");
			writeSoulFile(root, "preferences.md", "\n");
			writeSoulFile(root, "identity.md", "  ");

			const result = loadSoul(root);

			expect(result.personality).toBeNull();
			expect(result.preferences).toBeNull();
			expect(result.identity).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns null for empty files but loads non-empty ones", () => {
		const root = createTmpDir();
		try {
			writeSoulFile(root, "personality.md", "");
			writeSoulFile(root, "preferences.md", "Use tabs.");
			writeSoulFile(root, "identity.md", "");

			const result = loadSoul(root);

			expect(result.personality).toBeNull();
			expect(result.preferences).toBe("Use tabs.");
			expect(result.identity).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	/* ---- Multiline content ----------------------------------------------- */

	it("preserves multiline content", () => {
		const root = createTmpDir();
		try {
			const multiline = "Line one.\nLine two.\nLine three.";
			writeSoulFile(root, "personality.md", multiline);

			const result = loadSoul(root);

			expect(result.personality).toBe(multiline);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	/* ---- Empty soul directory -------------------------------------------- */

	it("returns all null when soul directory exists but is empty", () => {
		const root = createTmpDir();
		try {
			mkdirSync(join(root, "soul"), { recursive: true });

			const result = loadSoul(root);

			expect(result.personality).toBeNull();
			expect(result.preferences).toBeNull();
			expect(result.identity).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

/* ── formatSoulPrompt ──────────────────────────────────────────────────────── */

describe("formatSoulPrompt", () => {
	/* ---- All data present ------------------------------------------------ */

	it("includes all sections with headers when all data is present", () => {
		const soul: SoulData = {
			personality: "You are calm.",
			preferences: "Use TypeScript.",
			identity: "You are Takumi.",
		};

		const result = formatSoulPrompt(soul);

		expect(result).toContain("## Personality");
		expect(result).toContain("You are calm.");
		expect(result).toContain("## Preferences");
		expect(result).toContain("Use TypeScript.");
		expect(result).toContain("## Identity");
		expect(result).toContain("You are Takumi.");
	});

	it("orders sections as Personality, Preferences, Identity", () => {
		const soul: SoulData = {
			personality: "P1",
			preferences: "P2",
			identity: "P3",
		};

		const result = formatSoulPrompt(soul);

		const personalityIdx = result.indexOf("## Personality");
		const preferencesIdx = result.indexOf("## Preferences");
		const identityIdx = result.indexOf("## Identity");

		expect(personalityIdx).toBeLessThan(preferencesIdx);
		expect(preferencesIdx).toBeLessThan(identityIdx);
	});

	it("separates sections with double newlines", () => {
		const soul: SoulData = {
			personality: "P1",
			preferences: "P2",
			identity: "P3",
		};

		const result = formatSoulPrompt(soul);

		expect(result).toContain("P1\n\n## Preferences");
		expect(result).toContain("P2\n\n## Identity");
	});

	it("places content directly after the header on the next line", () => {
		const soul: SoulData = {
			personality: "Calm and thoughtful.",
			preferences: null,
			identity: null,
		};

		const result = formatSoulPrompt(soul);

		expect(result).toBe("## Personality\nCalm and thoughtful.");
	});

	/* ---- Some null ------------------------------------------------------- */

	it("skips personality when null", () => {
		const soul: SoulData = {
			personality: null,
			preferences: "Use ESM.",
			identity: "Assistant.",
		};

		const result = formatSoulPrompt(soul);

		expect(result).not.toContain("## Personality");
		expect(result).toContain("## Preferences");
		expect(result).toContain("## Identity");
	});

	it("skips preferences when null", () => {
		const soul: SoulData = {
			personality: "Friendly.",
			preferences: null,
			identity: "Takumi.",
		};

		const result = formatSoulPrompt(soul);

		expect(result).toContain("## Personality");
		expect(result).not.toContain("## Preferences");
		expect(result).toContain("## Identity");
	});

	it("skips identity when null", () => {
		const soul: SoulData = {
			personality: "Friendly.",
			preferences: "Use tabs.",
			identity: null,
		};

		const result = formatSoulPrompt(soul);

		expect(result).toContain("## Personality");
		expect(result).toContain("## Preferences");
		expect(result).not.toContain("## Identity");
	});

	it("returns only one section when two are null", () => {
		const soul: SoulData = {
			personality: null,
			preferences: "Prefer immutable data.",
			identity: null,
		};

		const result = formatSoulPrompt(soul);

		expect(result).toBe("## Preferences\nPrefer immutable data.");
		expect(result).not.toContain("## Personality");
		expect(result).not.toContain("## Identity");
	});

	/* ---- All null -------------------------------------------------------- */

	it("returns empty string when all fields are null", () => {
		const soul: SoulData = {
			personality: null,
			preferences: null,
			identity: null,
		};

		const result = formatSoulPrompt(soul);

		expect(result).toBe("");
	});

	/* ---- Multiline content ----------------------------------------------- */

	it("handles multiline content in sections", () => {
		const soul: SoulData = {
			personality: "Line 1.\nLine 2.\nLine 3.",
			preferences: null,
			identity: null,
		};

		const result = formatSoulPrompt(soul);

		expect(result).toContain("## Personality\nLine 1.\nLine 2.\nLine 3.");
	});

	/* ---- Special characters ---------------------------------------------- */

	it("preserves special characters in content", () => {
		const soul: SoulData = {
			personality: "Use **bold** and `code` with <html> & symbols!",
			preferences: null,
			identity: null,
		};

		const result = formatSoulPrompt(soul);

		expect(result).toContain("Use **bold** and `code` with <html> & symbols!");
	});
});
