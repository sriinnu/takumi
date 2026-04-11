import {
	detectAvailableIdeLaunchers,
	findIdeLauncher,
	formatIdeStatus,
	listIdeLauncherIds,
	openInIde,
} from "@takumi/core";
import type { AppCommandContext } from "../../commands/app-command-context.js";
import type { SlashCommandPack } from "../pack.js";

function parseLeadingArgument(input: string): { value: string; rest: string } {
	const trimmed = input.trim();
	if (!trimmed) {
		return { value: "", rest: "" };
	}

	const quote = trimmed[0];
	if (quote === '"' || quote === "'") {
		const end = trimmed.indexOf(quote, 1);
		if (end > 0) {
			return {
				value: trimmed.slice(1, end),
				rest: trimmed.slice(end + 1).trim(),
			};
		}
	}

	const boundary = trimmed.search(/\s/);
	if (boundary === -1) {
		return { value: trimmed, rest: "" };
	}

	return {
		value: trimmed.slice(0, boundary),
		rest: trimmed.slice(boundary + 1).trim(),
	};
}

function looksLikePath(token: string): boolean {
	return (
		token === "." ||
		token === ".." ||
		token.startsWith("./") ||
		token.startsWith("../") ||
		token.startsWith("/") ||
		token.startsWith("~/") ||
		/^[A-Za-z]:[\\/]/.test(token)
	);
}

function parseIdeOpenArgs(rawArgs: string): { selector?: string; targetPath?: string; error?: string } {
	const { value: first, rest } = parseLeadingArgument(rawArgs);
	if (!first) return {};

	if (findIdeLauncher(first)) {
		const parsedTarget = parseLeadingArgument(rest);
		return {
			selector: first,
			targetPath: parsedTarget.value ? [parsedTarget.value, parsedTarget.rest].filter(Boolean).join(" ") : undefined,
		};
	}

	if (!rest || looksLikePath(first)) {
		return {
			targetPath: rawArgs.trim(),
		};
	}

	return {
		error: `Unknown launcher: ${first}. Try one of: ${listIdeLauncherIds().join(", ")}`,
	};
}

export function createIdeSlashCommandPack(ctx: AppCommandContext): SlashCommandPack {
	return {
		id: "builtin.ide",
		label: "IDE",
		source: "builtin",
		commands: [
			{
				name: "/ide",
				description: "Inspect detected IDE launchers or open this project in one",
				handler: async (args) => {
					const trimmed = args.trim();
					const cwd = ctx.config.workingDirectory || process.cwd();
					const { value: subcommand, rest } = parseLeadingArgument(trimmed);
					const action = (subcommand || "status").toLowerCase();

					if (action !== "status" && action !== "open") {
						ctx.addInfoMessage("Usage: /ide [status [path]] | /ide open [launcher] [path]");
						return;
					}

					const availability = await detectAvailableIdeLaunchers();
					if (action === "status") {
						ctx.addInfoMessage(
							formatIdeStatus({
								targetPath: rest || cwd,
								launchers: availability,
								usageLine: "Usage: /ide open [launcher] [path]",
							}),
						);
						return;
					}

					const parsed = parseIdeOpenArgs(rest);
					if (parsed.error) {
						ctx.addInfoMessage(parsed.error);
						return;
					}

					const result = await openInIde({
						selector: parsed.selector,
						targetPath: parsed.targetPath,
						cwd,
						availability,
					});

					if (result.opened) {
						ctx.addInfoMessage(`Opened ${result.targetPath} in ${result.launcher?.label ?? "your IDE"}.`);
						return;
					}

					ctx.addInfoMessage(
						[
							`Failed to open ${result.targetPath}.`,
							result.error,
							formatIdeStatus({
								targetPath: result.targetPath,
								launchers: availability,
								usageLine: "Usage: /ide open [launcher] [path]",
							}),
						]
							.filter(Boolean)
							.join("\n"),
					);
				},
				getArgumentCompletions: (partial) => {
					const trimmed = partial.trim();
					if (!trimmed) return ["status", "open"];
					if ("status".startsWith(trimmed)) return ["status"];
					if ("open".startsWith(trimmed)) return ["open"];
					if (trimmed === "open") return ["open"];
					if (trimmed.startsWith("open ")) {
						const launcherPartial = trimmed.slice("open ".length).trim().toLowerCase();
						return listIdeLauncherIds()
							.filter((id) => id.startsWith(launcherPartial))
							.map((id) => `open ${id}`);
					}
					return [];
				},
			},
		],
	};
}
