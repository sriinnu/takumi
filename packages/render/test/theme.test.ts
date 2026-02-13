/**
 * Tests for the theming system.
 * Tests theme creation, registration, switching, and color validation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
	defaultTheme,
	getTheme,
	setTheme,
	registerTheme,
	listThemes,
	type Theme,
} from "../src/theme.js";

describe("theme", () => {
	beforeEach(() => {
		// Reset to default theme before each test
		setTheme("default");
	});

	describe("defaultTheme", () => {
		it("has all required properties", () => {
			expect(defaultTheme).toHaveProperty("name");
			expect(defaultTheme.name).toBe("default");

			// Primary palette
			expect(defaultTheme).toHaveProperty("primary");
			expect(defaultTheme).toHaveProperty("secondary");
			expect(defaultTheme).toHaveProperty("accent");
			expect(defaultTheme).toHaveProperty("background");
			expect(defaultTheme).toHaveProperty("foreground");
			expect(defaultTheme).toHaveProperty("muted");
			expect(defaultTheme).toHaveProperty("error");
			expect(defaultTheme).toHaveProperty("warning");
			expect(defaultTheme).toHaveProperty("success");
			expect(defaultTheme).toHaveProperty("info");

			// Component-specific
			expect(defaultTheme).toHaveProperty("border");
			expect(defaultTheme).toHaveProperty("borderFocused");
			expect(defaultTheme).toHaveProperty("inputBackground");
			expect(defaultTheme).toHaveProperty("inputForeground");
			expect(defaultTheme).toHaveProperty("inputPlaceholder");
			expect(defaultTheme).toHaveProperty("selectionBackground");
			expect(defaultTheme).toHaveProperty("selectionForeground");

			// Message colors
			expect(defaultTheme).toHaveProperty("userMessage");
			expect(defaultTheme).toHaveProperty("assistantMessage");
			expect(defaultTheme).toHaveProperty("systemMessage");
			expect(defaultTheme).toHaveProperty("thinkingText");

			// Syntax highlighting
			expect(defaultTheme).toHaveProperty("syntaxKeyword");
			expect(defaultTheme).toHaveProperty("syntaxString");
			expect(defaultTheme).toHaveProperty("syntaxNumber");
			expect(defaultTheme).toHaveProperty("syntaxComment");
			expect(defaultTheme).toHaveProperty("syntaxFunction");
			expect(defaultTheme).toHaveProperty("syntaxType");
			expect(defaultTheme).toHaveProperty("syntaxOperator");
			expect(defaultTheme).toHaveProperty("syntaxPunctuation");

			// Diff colors
			expect(defaultTheme).toHaveProperty("diffAdd");
			expect(defaultTheme).toHaveProperty("diffRemove");
			expect(defaultTheme).toHaveProperty("diffContext");
			expect(defaultTheme).toHaveProperty("diffHunkHeader");

			// Status bar
			expect(defaultTheme).toHaveProperty("statusBarBg");
			expect(defaultTheme).toHaveProperty("statusBarFg");
			expect(defaultTheme).toHaveProperty("statusBarAccent");
		});

		it("has valid hex color values", () => {
			const hexRegex = /^#[0-9a-f]{6}$/i;

			expect(defaultTheme.primary).toMatch(hexRegex);
			expect(defaultTheme.secondary).toMatch(hexRegex);
			expect(defaultTheme.accent).toMatch(hexRegex);
			expect(defaultTheme.background).toMatch(hexRegex);
			expect(defaultTheme.foreground).toMatch(hexRegex);
			expect(defaultTheme.error).toMatch(hexRegex);
			expect(defaultTheme.warning).toMatch(hexRegex);
			expect(defaultTheme.success).toMatch(hexRegex);
			expect(defaultTheme.info).toMatch(hexRegex);
		});

		it("has distinct colors for primary palette", () => {
			// Ensure key colors are different
			expect(defaultTheme.primary).not.toBe(defaultTheme.secondary);
			expect(defaultTheme.primary).not.toBe(defaultTheme.accent);
			expect(defaultTheme.background).not.toBe(defaultTheme.foreground);
			expect(defaultTheme.error).not.toBe(defaultTheme.success);
		});
	});

	describe("getTheme", () => {
		it("returns default theme initially", () => {
			const theme = getTheme();

			expect(theme.name).toBe("default");
			expect(theme.primary).toBe(defaultTheme.primary);
		});

		it("returns the active theme object", () => {
			const theme1 = getTheme();
			const theme2 = getTheme();

			// Same reference (no copy overhead)
			expect(theme1).toBe(theme2);
			expect(theme1.name).toBe("default");
			expect(theme1.primary).toBeDefined();
		});

		it("returns current active theme", () => {
			const customTheme: Theme = {
				...defaultTheme,
				name: "custom",
				primary: "#ff0000",
			};

			setTheme(customTheme);

			const theme = getTheme();

			expect(theme.name).toBe("custom");
			expect(theme.primary).toBe("#ff0000");
		});
	});

	describe("setTheme", () => {
		it("changes active theme by name", () => {
			const customTheme: Theme = {
				...defaultTheme,
				name: "dark",
				background: "#000000",
			};

			registerTheme(customTheme);
			setTheme("dark");

			const theme = getTheme();

			expect(theme.name).toBe("dark");
			expect(theme.background).toBe("#000000");
		});

		it("changes active theme by object", () => {
			const customTheme: Theme = {
				...defaultTheme,
				name: "light",
				background: "#ffffff",
				foreground: "#000000",
			};

			setTheme(customTheme);

			const theme = getTheme();

			expect(theme.name).toBe("light");
			expect(theme.background).toBe("#ffffff");
			expect(theme.foreground).toBe("#000000");
		});

		it("throws error for unknown theme name", () => {
			expect(() => setTheme("non-existent")).toThrow("Unknown theme: non-existent");
		});

		it("creates a copy when setting theme", () => {
			const customTheme: Theme = {
				...defaultTheme,
				name: "custom",
				primary: "#ff0000",
			};

			setTheme(customTheme);

			// Modify original
			customTheme.primary = "#00ff00";

			// Active theme should not be affected
			const theme = getTheme();
			expect(theme.primary).toBe("#ff0000");
		});

		it("can switch between registered themes", () => {
			const theme1: Theme = {
				...defaultTheme,
				name: "theme1",
				primary: "#111111",
			};

			const theme2: Theme = {
				...defaultTheme,
				name: "theme2",
				primary: "#222222",
			};

			registerTheme(theme1);
			registerTheme(theme2);

			setTheme("theme1");
			expect(getTheme().primary).toBe("#111111");

			setTheme("theme2");
			expect(getTheme().primary).toBe("#222222");

			setTheme("theme1");
			expect(getTheme().primary).toBe("#111111");
		});
	});

	describe("registerTheme", () => {
		it("adds a custom theme to registry", () => {
			const customTheme: Theme = {
				...defaultTheme,
				name: "ocean",
				primary: "#0066cc",
			};

			const themesBefore = listThemes();

			registerTheme(customTheme);

			const themesAfter = listThemes();

			expect(themesAfter.length).toBe(themesBefore.length + 1);
			expect(themesAfter).toContain("ocean");
		});

		it("allows overwriting existing theme", () => {
			const customTheme1: Theme = {
				...defaultTheme,
				name: "custom",
				primary: "#111111",
			};

			const customTheme2: Theme = {
				...defaultTheme,
				name: "custom",
				primary: "#222222",
			};

			registerTheme(customTheme1);
			setTheme("custom");
			expect(getTheme().primary).toBe("#111111");

			registerTheme(customTheme2);
			setTheme("custom");
			expect(getTheme().primary).toBe("#222222");
		});

		it("registers multiple themes", () => {
			const theme1: Theme = { ...defaultTheme, name: "theme1" };
			const theme2: Theme = { ...defaultTheme, name: "theme2" };
			const theme3: Theme = { ...defaultTheme, name: "theme3" };

			registerTheme(theme1);
			registerTheme(theme2);
			registerTheme(theme3);

			const themes = listThemes();

			expect(themes).toContain("theme1");
			expect(themes).toContain("theme2");
			expect(themes).toContain("theme3");
		});
	});

	describe("listThemes", () => {
		it("returns all registered theme names", () => {
			const themes = listThemes();

			expect(Array.isArray(themes)).toBe(true);
			expect(themes).toContain("default");
		});

		it("returns updated list after registration", () => {
			const themesBefore = listThemes();
			const countBefore = themesBefore.length;

			const customTheme: Theme = {
				...defaultTheme,
				name: "midnight",
			};

			registerTheme(customTheme);

			const themesAfter = listThemes();

			expect(themesAfter.length).toBe(countBefore + 1);
			expect(themesAfter).toContain("midnight");
		});

		it("includes default theme", () => {
			const themes = listThemes();

			expect(themes).toContain("default");
		});
	});

	describe("theme colors validation", () => {
		it("validates all default theme colors are hex", () => {
			const hexRegex = /^#[0-9a-f]{6}$/i;
			const theme = defaultTheme;

			// Test all color properties
			const colorProps = [
				"primary",
				"secondary",
				"accent",
				"background",
				"foreground",
				"muted",
				"error",
				"warning",
				"success",
				"info",
				"border",
				"borderFocused",
				"inputBackground",
				"inputForeground",
				"inputPlaceholder",
				"selectionBackground",
				"selectionForeground",
				"userMessage",
				"assistantMessage",
				"systemMessage",
				"thinkingText",
				"syntaxKeyword",
				"syntaxString",
				"syntaxNumber",
				"syntaxComment",
				"syntaxFunction",
				"syntaxType",
				"syntaxOperator",
				"syntaxPunctuation",
				"diffAdd",
				"diffRemove",
				"diffContext",
				"diffHunkHeader",
				"statusBarBg",
				"statusBarFg",
				"statusBarAccent",
			] as const;

			for (const prop of colorProps) {
				expect(theme[prop]).toMatch(hexRegex);
			}
		});

		it("accepts custom theme with valid colors", () => {
			const customTheme: Theme = {
				...defaultTheme,
				name: "valid-custom",
				primary: "#ff5733",
				secondary: "#33ff57",
			};

			expect(() => registerTheme(customTheme)).not.toThrow();
			expect(() => setTheme("valid-custom")).not.toThrow();
		});
	});

	describe("theme immutability", () => {
		it("does not mutate default theme when getting theme", () => {
			const originalPrimary = defaultTheme.primary;
			const theme = getTheme();

			theme.primary = "#000000";

			expect(defaultTheme.primary).toBe(originalPrimary);
		});

		it("does not mutate registered theme when setting", () => {
			const customTheme: Theme = {
				...defaultTheme,
				name: "immutable-test",
				primary: "#123456",
			};

			registerTheme(customTheme);

			const originalPrimary = customTheme.primary;

			setTheme("immutable-test");
			const activeTheme = getTheme();
			activeTheme.primary = "#654321";

			expect(customTheme.primary).toBe(originalPrimary);
		});
	});
});
