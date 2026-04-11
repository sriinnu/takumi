import { describe, expect, it, vi } from "vitest";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { registerSlashCommandPack } from "../src/slash-commands/pack.js";

/* ── Tests ──────────────────────────────────────────────────────────────────── */

describe("SlashCommandRegistry", () => {
	/* ---- register -------------------------------------------------------- */

	describe("register", () => {
		it("adds a command", () => {
			const reg = new SlashCommandRegistry();
			reg.register("/help", "Show help", vi.fn());

			expect(reg.has("/help")).toBe(true);
		});

		it("stores description and handler", () => {
			const reg = new SlashCommandRegistry();
			const handler = vi.fn();
			reg.register("/help", "Show help text", handler);

			const cmds = reg.list();
			expect(cmds).toHaveLength(1);
			expect(cmds[0].name).toBe("/help");
			expect(cmds[0].description).toBe("Show help text");
			expect(cmds[0].handler).toBe(handler);
		});

		it("stores aliases", () => {
			const reg = new SlashCommandRegistry();
			reg.register("/help", "Help", vi.fn(), ["/h", "/?"]);

			expect(reg.has("/help")).toBe(true);
			expect(reg.has("/h")).toBe(true);
			expect(reg.has("/?")).toBe(true);
		});

		it("defaults to empty aliases when none provided", () => {
			const reg = new SlashCommandRegistry();
			reg.register("/help", "Help", vi.fn());

			const cmds = reg.list();
			expect(cmds[0].aliases).toEqual([]);
		});

		it("stores argument completion handlers from register options", async () => {
			const reg = new SlashCommandRegistry();
			const complete = vi.fn(async () => ["resume", "refresh"]);
			reg.register("/lane", "Lane tools", vi.fn(), { getArgumentCompletions: complete });

			const cmd = reg.get("/lane");
			expect(cmd?.getArgumentCompletions).toBeDefined();
			await expect(cmd?.getArgumentCompletions?.("re")).resolves.toEqual(["resume", "refresh"]);
			expect(complete).toHaveBeenCalledWith("re");
		});

		it("stores shared contribution metadata via slash command packs", () => {
			const reg = new SlashCommandRegistry();
			registerSlashCommandPack(reg, {
				id: "builtin.ide",
				label: "IDE",
				source: "builtin",
				commands: [
					{
						name: "/ide",
						description: "IDE commands",
						handler: vi.fn(),
						aliases: ["/open-ide"],
					},
				],
			});

			const cmd = reg.get("/ide");
			expect(cmd?.source).toBe("builtin");
			expect(cmd?.packId).toBe("builtin.ide");
			expect(cmd?.packLabel).toBe("IDE");
			expect(cmd?.requestedName).toBe("/ide");
			expect(reg.get("/open-ide")?.name).toBe("/ide");
		});
	});

	/* ---- has ------------------------------------------------------------- */

	describe("has", () => {
		it("returns true for a registered command", () => {
			const reg = new SlashCommandRegistry();
			reg.register("/help", "Help", vi.fn());
			expect(reg.has("/help")).toBe(true);
		});

		it("returns false for an unknown command", () => {
			const reg = new SlashCommandRegistry();
			expect(reg.has("/nonexistent")).toBe(false);
		});

		it("returns true for an alias", () => {
			const reg = new SlashCommandRegistry();
			reg.register("/help", "Help", vi.fn(), ["/h"]);
			expect(reg.has("/h")).toBe(true);
		});

		it("returns false after unregister", () => {
			const reg = new SlashCommandRegistry();
			reg.register("/help", "Help", vi.fn());
			reg.unregister("/help");
			expect(reg.has("/help")).toBe(false);
		});
	});

	describe("get", () => {
		it("returns the canonical command for names and aliases", () => {
			const reg = new SlashCommandRegistry();
			reg.register("/help", "Help", vi.fn(), ["/h"]);
			expect(reg.get("/help")?.name).toBe("/help");
			expect(reg.get("/h")?.name).toBe("/help");
		});
	});

	/* ---- execute --------------------------------------------------------- */

	describe("execute", () => {
		it("calls handler with args and returns true", async () => {
			const reg = new SlashCommandRegistry();
			const handler = vi.fn();
			reg.register("/echo", "Echo text", handler);

			const result = await reg.execute("/echo hello world");

			expect(result).toBe(true);
			expect(handler).toHaveBeenCalledOnce();
			expect(handler).toHaveBeenCalledWith("hello world");
		});

		it("returns false for non-slash input", async () => {
			const reg = new SlashCommandRegistry();
			reg.register("/help", "Help", vi.fn());

			const result = await reg.execute("hello world");
			expect(result).toBe(false);
		});

		it("returns false for unknown command", async () => {
			const reg = new SlashCommandRegistry();
			reg.register("/help", "Help", vi.fn());

			const result = await reg.execute("/unknown");
			expect(result).toBe(false);
		});

		it("parses command name and args correctly", async () => {
			const reg = new SlashCommandRegistry();
			const handler = vi.fn();
			reg.register("/model", "Set model", handler);

			await reg.execute("/model claude-opus-4-20250514");

			expect(handler).toHaveBeenCalledWith("claude-opus-4-20250514");
		});

		it("passes empty string as args when no space after command", async () => {
			const reg = new SlashCommandRegistry();
			const handler = vi.fn();
			reg.register("/help", "Help", handler);

			await reg.execute("/help");

			expect(handler).toHaveBeenCalledWith("");
		});

		it("trims args whitespace", async () => {
			const reg = new SlashCommandRegistry();
			const handler = vi.fn();
			reg.register("/echo", "Echo", handler);

			await reg.execute("/echo   hello   ");

			expect(handler).toHaveBeenCalledWith("hello");
		});

		it("aliases resolve to the same handler", async () => {
			const reg = new SlashCommandRegistry();
			const handler = vi.fn();
			reg.register("/help", "Help", handler, ["/h", "/?"]);

			await reg.execute("/h");
			expect(handler).toHaveBeenCalledOnce();

			await reg.execute("/?");
			expect(handler).toHaveBeenCalledTimes(2);
		});

		it("handles async handlers correctly", async () => {
			const reg = new SlashCommandRegistry();
			let resolved = false;
			const handler = vi.fn(async () => {
				await new Promise((r) => setTimeout(r, 10));
				resolved = true;
			});
			reg.register("/async", "Async command", handler);

			const result = await reg.execute("/async test");

			expect(result).toBe(true);
			expect(resolved).toBe(true);
			expect(handler).toHaveBeenCalledWith("test");
		});

		it("does not call handler for non-slash input", async () => {
			const reg = new SlashCommandRegistry();
			const handler = vi.fn();
			reg.register("/help", "Help", handler);

			await reg.execute("just some text");
			expect(handler).not.toHaveBeenCalled();
		});
	});

	/* ---- unregister ------------------------------------------------------ */

	describe("unregister", () => {
		it("removes a registered command", () => {
			const reg = new SlashCommandRegistry();
			reg.register("/help", "Help", vi.fn());
			const result = reg.unregister("/help");

			expect(result).toBe(true);
			expect(reg.has("/help")).toBe(false);
		});

		it("returns false for an unknown command", () => {
			const reg = new SlashCommandRegistry();
			expect(reg.unregister("/nonexistent")).toBe(false);
		});

		it("removes command aliases too", () => {
			const reg = new SlashCommandRegistry();
			reg.register("/help", "Help", vi.fn(), ["/h", "/?"]);
			reg.unregister("/help");

			expect(reg.has("/help")).toBe(false);
			expect(reg.has("/h")).toBe(false);
			expect(reg.has("/?")).toBe(false);
		});

		it("makes execute return false after unregister", async () => {
			const reg = new SlashCommandRegistry();
			const handler = vi.fn();
			reg.register("/help", "Help", handler);
			reg.unregister("/help");

			const result = await reg.execute("/help");
			expect(result).toBe(false);
			expect(handler).not.toHaveBeenCalled();
		});

		it("returns false when unregistering the same command twice", () => {
			const reg = new SlashCommandRegistry();
			reg.register("/help", "Help", vi.fn());
			reg.unregister("/help");
			expect(reg.unregister("/help")).toBe(false);
		});
	});

	/* ---- getCompletions -------------------------------------------------- */

	describe("getCompletions", () => {
		it("returns matching commands for partial input", () => {
			const reg = new SlashCommandRegistry();
			reg.register("/help", "Help", vi.fn());
			reg.register("/history", "History", vi.fn());
			reg.register("/model", "Model", vi.fn());

			const completions = reg.getCompletions("/h");
			expect(completions).toHaveLength(2);
			expect(completions.map((c) => c.name)).toContain("/help");
			expect(completions.map((c) => c.name)).toContain("/history");
		});

		it("returns empty for non-slash input", () => {
			const reg = new SlashCommandRegistry();
			reg.register("/help", "Help", vi.fn());

			expect(reg.getCompletions("help")).toEqual([]);
		});

		it("returns all commands for just '/'", () => {
			const reg = new SlashCommandRegistry();
			reg.register("/help", "Help", vi.fn());
			reg.register("/model", "Model", vi.fn());
			reg.register("/clear", "Clear", vi.fn());

			const completions = reg.getCompletions("/");
			expect(completions).toHaveLength(3);
		});

		it("returns empty when no commands match", () => {
			const reg = new SlashCommandRegistry();
			reg.register("/help", "Help", vi.fn());

			expect(reg.getCompletions("/z")).toEqual([]);
		});

		it("returns results sorted by name", () => {
			const reg = new SlashCommandRegistry();
			reg.register("/model", "Model", vi.fn());
			reg.register("/clear", "Clear", vi.fn());
			reg.register("/help", "Help", vi.fn());

			const completions = reg.getCompletions("/");
			expect(completions.map((c) => c.name)).toEqual(["/clear", "/help", "/model"]);
		});

		it("returns unique commands (no duplicates from aliases)", () => {
			const reg = new SlashCommandRegistry();
			reg.register("/help", "Help", vi.fn(), ["/h"]);

			// /h starts with /h, and /help starts with /h
			const completions = reg.getCompletions("/h");
			// Should only include /help once (the canonical name)
			expect(completions).toHaveLength(1);
			expect(completions[0].name).toBe("/help");
		});
	});

	/* ---- list ------------------------------------------------------------ */

	describe("list", () => {
		it("returns all unique commands sorted by name", () => {
			const reg = new SlashCommandRegistry();
			reg.register("/model", "Model", vi.fn());
			reg.register("/clear", "Clear", vi.fn());
			reg.register("/help", "Help", vi.fn());

			const cmds = reg.list();
			expect(cmds).toHaveLength(3);
			expect(cmds.map((c) => c.name)).toEqual(["/clear", "/help", "/model"]);
		});

		it("does not include alias entries as separate commands", () => {
			const reg = new SlashCommandRegistry();
			reg.register("/help", "Help", vi.fn(), ["/h", "/?"]);
			reg.register("/model", "Model", vi.fn(), ["/m"]);

			const cmds = reg.list();
			expect(cmds).toHaveLength(2);
			expect(cmds.map((c) => c.name).sort()).toEqual(["/help", "/model"]);
		});

		it("returns empty array when no commands registered", () => {
			const reg = new SlashCommandRegistry();
			expect(reg.list()).toEqual([]);
		});

		it("excludes unregistered commands", () => {
			const reg = new SlashCommandRegistry();
			reg.register("/help", "Help", vi.fn());
			reg.register("/model", "Model", vi.fn());
			reg.unregister("/help");

			const cmds = reg.list();
			expect(cmds).toHaveLength(1);
			expect(cmds[0].name).toBe("/model");
		});
	});
});
