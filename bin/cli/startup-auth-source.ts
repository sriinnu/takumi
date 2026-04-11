import type { TakumiConfig } from "@takumi/core";
import { hasProviderEnvKey } from "./entry-runtime.js";
import { canSkipApiKey } from "./provider.js";

/** Keep the startup banner honest without reviving the old credential preflight UX. */
export function describeStartupAuthSource(
	config: TakumiConfig,
	args: { apiKey?: string; proxy?: string },
): string {
	if (config.proxyUrl) return "proxy";
	if (args.apiKey) return "explicit api key";
	if (config.apiKey) return "configured api key";
	if (hasProviderEnvKey(config)) return `${config.provider} environment`;
	if (canSkipApiKey(config)) return "local endpoint";
	return "resolved at provider startup";
}