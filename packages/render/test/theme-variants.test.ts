/**
 * Tests for built-in theme variants.
 *
 * Verifies that all 6 themes (default + 5 variants) are registered,
 * discoverable, switchable, and contain all required color properties.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	builtinThemes,
	catppuccinLatte,
	catppuccinMocha,
	dracula,
	getTheme,
	gruvboxDark,
	listThemes,
	oneDark,
	registerTheme,
	setTheme,
	type Theme,
	tokyoNight,
} from "../src/index.js";

/** Every color property that a Theme must define (excluding `name`). */
const ALL_COLOR_PROPS: ReadonlyArray<keyof Theme> = [
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
];

/** All built-in theme names that must be registered. */
const EXPECTED_THEME_NAMES = [
	"default",
	"catppuccin-mocha",
	"catppuccin-latte",
	"dracula",
	"tokyo-night",
	"one-dark",
	"gruvbox-dark",
];

/** All built-in theme objects for parameterized tests. */
const ALL_THEMES: Theme[] = [catppuccinMocha, catppuccinLatte, dracula, tokyoNight, oneDark, gruvboxDark];

const hexRegex = /^#[0-9a-f]{6}$/i;

describe("theme variants", () => {
	beforeEach(() => {
		setTheme("default");
	});

	describe("registration", () => {
		it("registers all 6 built-in themes plus the default", () => {
			const names = listThemes();
			// default + 6 variants = 7
			expect(names.length).toBeGreaterThanOrEqual(7);
		});

		it("includes every expected theme name", () => {
			const names = listThemes();
			for (const expected of EXPECTED_THEME_NAMES) {
				expect(names).toContain(expected);
			}
		});

		it("builtinThemes array contains all 6 variants", () => {
			expect(builtinThemes).toHaveLength(6);

			const names = builtinThemes.map((t) => t.name);
			expect(names).toContain("catppuccin-mocha");
			expect(names).toContain("catppuccin-latte");
			expect(names).toContain("dracula");
			expect(names).toContain("tokyo-night");
			expect(names).toContain("one-dark");
			expect(names).toContain("gruvbox-dark");
		});
	});

	describe("listThemes", () => {
		it("returns all theme names as an array of strings", () => {
			const names = listThemes();

			expect(Array.isArray(names)).toBe(true);
			for (const name of names) {
				expect(typeof name).toBe("string");
			}
		});

		it("always includes the default theme", () => {
			expect(listThemes()).toContain("default");
		});

		it("returns all built-in variant names", () => {
			const names = listThemes();
			for (const theme of ALL_THEMES) {
				expect(names).toContain(theme.name);
			}
		});
	});

	describe("setTheme / getTheme round-trip", () => {
		it.each(EXPECTED_THEME_NAMES)("can switch to '%s' and read it back", (themeName) => {
			setTheme(themeName);

			const active = getTheme();

			expect(active.name).toBe(themeName);
			expect(active.primary).toBeDefined();
			expect(active.background).toBeDefined();
		});

		it("switches between all variants without error", () => {
			for (const theme of ALL_THEMES) {
				setTheme(theme.name);
				expect(getTheme().name).toBe(theme.name);
			}

			// Switch back to default
			setTheme("default");
			expect(getTheme().name).toBe("default");
		});

		it("preserves theme values after round-trip", () => {
			setTheme("dracula");
			const active = getTheme();

			expect(active.primary).toBe(dracula.primary);
			expect(active.secondary).toBe(dracula.secondary);
			expect(active.background).toBe(dracula.background);
			expect(active.foreground).toBe(dracula.foreground);
			expect(active.error).toBe(dracula.error);
		});
	});

	describe("color properties", () => {
		it.each(ALL_THEMES.map((t) => [t.name, t] as const))("'%s' has all required color properties", (_name, theme) => {
			for (const prop of ALL_COLOR_PROPS) {
				expect(theme).toHaveProperty(prop);
				expect(theme[prop]).toBeDefined();
				expect(typeof theme[prop]).toBe("string");
			}
		});

		it.each(ALL_THEMES.map((t) => [t.name, t] as const))("'%s' has valid hex color values", (_name, theme) => {
			for (const prop of ALL_COLOR_PROPS) {
				expect(theme[prop]).toMatch(hexRegex);
			}
		});

		it.each(ALL_THEMES.map((t) => [t.name, t] as const))("'%s' has distinct primary palette colors", (_name, theme) => {
			expect(theme.primary).not.toBe(theme.background);
			expect(theme.foreground).not.toBe(theme.background);
			expect(theme.error).not.toBe(theme.success);
		});
	});

	describe("individual theme identity", () => {
		it("catppuccin-mocha is a dark theme", () => {
			expect(catppuccinMocha.name).toBe("catppuccin-mocha");
			expect(catppuccinMocha.primary).toBe("#cba6f7");
			expect(catppuccinMocha.background).toBe("#1e1e2e");
		});

		it("catppuccin-latte is a light theme", () => {
			expect(catppuccinLatte.name).toBe("catppuccin-latte");
			expect(catppuccinLatte.primary).toBe("#8839ef");
			expect(catppuccinLatte.background).toBe("#eff1f5");
		});

		it("dracula has characteristic purple primary", () => {
			expect(dracula.name).toBe("dracula");
			expect(dracula.primary).toBe("#bd93f9");
			expect(dracula.background).toBe("#282a36");
		});

		it("tokyo-night has characteristic blue primary", () => {
			expect(tokyoNight.name).toBe("tokyo-night");
			expect(tokyoNight.primary).toBe("#7aa2f7");
			expect(tokyoNight.background).toBe("#1a1b26");
		});

		it("one-dark has characteristic blue primary", () => {
			expect(oneDark.name).toBe("one-dark");
			expect(oneDark.primary).toBe("#61afef");
			expect(oneDark.background).toBe("#282c34");
		});

		it("gruvbox-dark has characteristic orange primary", () => {
			expect(gruvboxDark.name).toBe("gruvbox-dark");
			expect(gruvboxDark.primary).toBe("#d65d0e");
			expect(gruvboxDark.background).toBe("#1d2021");
		});
	});

	describe("registerTheme + switch round-trip", () => {
		it("can register a custom theme and switch to it", () => {
			const custom: Theme = {
				...catppuccinMocha,
				name: "my-custom",
				primary: "#ff00ff",
			};

			registerTheme(custom);
			expect(listThemes()).toContain("my-custom");

			setTheme("my-custom");
			expect(getTheme().name).toBe("my-custom");
			expect(getTheme().primary).toBe("#ff00ff");
		});

		it("can switch away and back to a registered theme", () => {
			setTheme("dracula");
			expect(getTheme().name).toBe("dracula");

			setTheme("tokyo-night");
			expect(getTheme().name).toBe("tokyo-night");

			setTheme("dracula");
			expect(getTheme().name).toBe("dracula");
			expect(getTheme().primary).toBe(dracula.primary);
		});

		it("can register, switch, register another, switch again", () => {
			const themeA: Theme = {
				...oneDark,
				name: "roundtrip-a",
				primary: "#aaaaaa",
			};

			const themeB: Theme = {
				...gruvboxDark,
				name: "roundtrip-b",
				primary: "#bbbbbb",
			};

			registerTheme(themeA);
			setTheme("roundtrip-a");
			expect(getTheme().primary).toBe("#aaaaaa");

			registerTheme(themeB);
			setTheme("roundtrip-b");
			expect(getTheme().primary).toBe("#bbbbbb");

			// Switch back
			setTheme("roundtrip-a");
			expect(getTheme().primary).toBe("#aaaaaa");
		});

		it("overwriting a built-in theme updates it in the registry", () => {
			const modifiedDracula: Theme = {
				...dracula,
				primary: "#000000",
			};

			registerTheme(modifiedDracula);
			setTheme("dracula");

			expect(getTheme().primary).toBe("#000000");
		});
	});

	describe("theme isolation", () => {
		it("setting one theme does not affect others", () => {
			const originalPrimary = dracula.primary;

			setTheme("dracula");
			const active = getTheme();
			active.primary = "#ffffff";

			// Original theme object is unaffected
			expect(dracula.primary).toBe(originalPrimary);
		});

		it("each theme has a unique name", () => {
			const names = ALL_THEMES.map((t) => t.name);
			const unique = new Set(names);

			expect(unique.size).toBe(names.length);
		});
	});
});
