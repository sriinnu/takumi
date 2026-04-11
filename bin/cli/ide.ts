import { detectAvailableIdeLaunchers, findIdeLauncher, formatIdeStatus, listIdeLauncherIds, openInIde } from "@takumi/core";

function looksLikePath(token: string): boolean {
	return token === "." || token === ".." || token.startsWith("./") || token.startsWith("../") || token.startsWith("/") || token.startsWith("~/") || /^[A-Za-z]:[\\/]/.test(token);
}

function parseOpenArgs(tokens: string[]): { selector?: string; targetPath?: string; error?: string } {
	const [first, ...rest] = tokens;
	if (!first) return {};

	if (findIdeLauncher(first)) {
		return {
			selector: first,
			targetPath: rest.join(" ").trim() || undefined,
		};
	}

	if (tokens.length === 1 || looksLikePath(first)) {
		return {
			targetPath: tokens.join(" ").trim() || undefined,
		};
	}

	return {
		error: `Unknown launcher: ${first}. Try one of: ${listIdeLauncherIds().join(", ")}`,
	};
}

export async function cmdIde(action = "status", args: string[] = [], json = false): Promise<void> {
	const normalized = action.trim().toLowerCase();
	if (normalized !== "status" && normalized !== "open") {
		console.error("Usage: takumi ide [status [path]] | takumi ide open [launcher] [path]");
		process.exit(1);
	}

	const availability = await detectAvailableIdeLaunchers();
	const cwd = process.cwd();

	if (normalized === "status") {
		const targetPath = args.join(" ").trim() || cwd;
		if (json) {
			console.log(
				JSON.stringify(
					{
						targetPath,
						launchers: availability,
						usage: "takumi ide open [launcher] [path]",
					},
					null,
					2,
				),
			);
			return;
		}

		console.log(
			formatIdeStatus({
				targetPath,
				launchers: availability,
				usageLine: "Usage: takumi ide open [launcher] [path]",
			}),
		);
		return;
	}

	const parsed = parseOpenArgs(args);
	if (parsed.error) {
		console.error(parsed.error);
		process.exit(1);
	}

	const result = await openInIde({
		selector: parsed.selector,
		targetPath: parsed.targetPath,
		cwd,
		availability,
	});

	if (json) {
		console.log(JSON.stringify(result, null, 2));
	}

	if (!result.opened) {
		if (!json) {
			console.error(`Failed to open ${result.targetPath}${result.error ? `: ${result.error}` : ""}`);
		}
		process.exitCode = 1;
		return;
	}

	if (!json) {
		console.log(`Opened ${result.targetPath} in ${result.launcher?.label ?? "your IDE"}.`);
	}
}