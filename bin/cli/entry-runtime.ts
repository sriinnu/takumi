import { loadMergedEnv, resolveProviderCredential } from "@takumi/core";
import type { TakumiConfig } from "@takumi/core";

/** I check whether the current provider can authenticate from the workspace env. */
export function hasProviderEnvKey(config: TakumiConfig): boolean {
	const env = loadMergedEnv(config.workingDirectory || process.cwd());
	return Boolean(resolveProviderCredential(config.provider, env) || env.TAKUMI_API_KEY);
}

/**
 * I restore the terminal before process-level failures escape, preventing the
 * operator from being stranded in an alternate-screen gremlin cave.
 *
 * The cleanup sequence is ordered with the same care as a kernel panic handler:
 *
 * 1. **Exit alternate screen** — most critical; without this the user can't see
 *    their shell at all.
 * 2. **Show cursor** — cosmetic but disorienting when missing.
 * 3. **Disable mouse / bracketed paste** — prevents stray escape sequences from
 *    leaking into the next shell command.
 * 4. **Restore raw mode** — lets the line discipline reassemble keystrokes into
 *    lines; without it even `ls` won't work.
 *
 * I intentionally do NOT call `process.exit()` inside cleanup — the caller
 * controls the exit code so fatal crashes actually report failure (code 1)
 * instead of masquerading as success (the previous code exited 0).
 */
export function installFatalHandlers(): void {
	const cleanup = () => {
		process.stdout.write("\x1b[?1049l"); // alt screen off
		process.stdout.write("\x1b[?25h"); // cursor show
		process.stdout.write("\x1b[?1000l\x1b[?1006l"); // mouse off
		process.stdout.write("\x1b[?2004l"); // bracketed paste off
		try {
			if (typeof process.stdin.setRawMode === "function") process.stdin.setRawMode(false);
		} catch {
			/* stdin may already be destroyed or not a TTY */
		}
		try {
			process.stdin.pause();
		} catch {
			/* swallow — stdin may be closed */
		}
	};

	const onFatal = (label: string, err: unknown) => {
		cleanup();
		const message = err instanceof Error ? err.message : String(err);
		console.error(`Fatal (${label}): ${message}`);
		process.exit(1);
	};

	process.on("uncaughtException", (err) => onFatal("uncaughtException", err));
	process.on("unhandledRejection", (err) => onFatal("unhandledRejection", err));
	process.on("SIGHUP", () => {
		cleanup();
		process.exit(128 + 1);
	});
}