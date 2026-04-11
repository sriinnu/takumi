import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_KEYBINDING_DEFINITIONS,
	ensureUserKeybindingConfigFile,
	loadUserKeybindingDefinitions,
	syncDefaultKeybindingRegistry,
} from "../src/input/keybinding-config.js";
import { KeyBindingRegistry } from "../src/input/keybinds.js";

describe("keybinding config helpers", () => {
	afterEach(() => {
		delete process.env.TAKUMI_CONFIG_DIR;
	});

	it("creates a default keybindings config file", async () => {
		const configDir = await mkdtemp(join(tmpdir(), "takumi-keybindings-"));
		process.env.TAKUMI_CONFIG_DIR = configDir;

		const result = await ensureUserKeybindingConfigFile();
		expect(result.created).toBe(true);

		const raw = await readFile(result.filePath, "utf-8");
		const parsed = JSON.parse(raw) as {
			version: number;
			bindings: Record<string, { key: string; aliases?: string[]; description?: string }>;
		};

		expect(parsed.version).toBe(1);
		expect(parsed.bindings["app.command-palette.toggle"]).toMatchObject({
			key: "ctrl+k",
			aliases: [],
			description: "Command palette",
		});
		expect(parsed.bindings["app.preview.toggle"]).toMatchObject({
			key: "ctrl+p",
			aliases: [],
			description: "Toggle preview",
		});
	});

	it("loads remapped definitions and skips unknown action ids", async () => {
		const filePath = join(await mkdtemp(join(tmpdir(), "takumi-keybindings-load-")), "keybindings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					version: 1,
					bindings: {
						"app.quit": { key: "ctrl+x", enabled: false },
						"app.command-palette.toggle": { key: "ctrl+q", aliases: ["ctrl+space"] },
						"app.ghost-action": { key: "ctrl+z" },
					},
				},
				null,
				"\t",
			),
			"utf-8",
		);

		const result = await loadUserKeybindingDefinitions(filePath);
		expect(result.error).toBeUndefined();
		expect(result.found).toBe(true);
		expect(result.definitions.find((definition) => definition.id === "app.quit")).toMatchObject({
			key: "ctrl+x",
			enabled: false,
		});
		expect(result.definitions.find((definition) => definition.id === "app.command-palette.toggle")).toMatchObject({
			key: "ctrl+q",
			aliases: ["ctrl+space"],
		});
		expect(result.skipped).toEqual(["app.ghost-action (unknown action)"]);
	});

	it("syncs remapped default bindings without leaving stale key ownership behind", () => {
		const registry = new KeyBindingRegistry();
		const handlers = Object.fromEntries(
			DEFAULT_KEYBINDING_DEFINITIONS.map((definition) => [definition.id, vi.fn()]),
		) as Record<string, () => void>;
		const remapped = DEFAULT_KEYBINDING_DEFINITIONS.map((definition) => {
			if (definition.id === "app.quit") {
				return { ...definition, key: "ctrl+k", aliases: [] };
			}
			if (definition.id === "app.command-palette.toggle") {
				return { ...definition, key: "ctrl+q", aliases: [] };
			}
			return { ...definition, aliases: [...definition.aliases] };
		});

		syncDefaultKeybindingRegistry(registry, handlers, remapped);

		expect(registry.getById("app.quit")?.key).toBe("ctrl+k");
		expect(registry.getById("app.command-palette.toggle")?.key).toBe("ctrl+q");
		expect(registry.get("ctrl+k")?.id).toBe("app.quit");
		expect(registry.get("ctrl+q")?.id).toBe("app.command-palette.toggle");
	});
});
