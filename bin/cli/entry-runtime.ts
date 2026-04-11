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
 */
export function installFatalHandlers(): void {
	const cleanup = () => {
		process.stdout.write("\x1b[?1049l");
		process.stdout.write("\x1b[?25h");
		process.stdout.write("\x1b[?1000l\x1b[?1006l");
		process.stdout.write("\x1b[?2004l");
		process.exit(0);
	};

	process.on("uncaughtException", (err) => {
		cleanup();
		console.error(`Fatal: ${err.message}`);
		process.exit(1);
	});
	process.on("unhandledRejection", (err) => {
		cleanup();
		console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	});
}