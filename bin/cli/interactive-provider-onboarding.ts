import type { TakumiConfig } from "@takumi/core";
import type { FastProviderStatus } from "./cli-auth.js";
import { formatDiscoveredProviderSummary } from "./degraded-local-mode.js";
import {
	createResolvedProvider,
	isProviderConfigurationError,
	type CreateResolvedProviderOptions,
	type ResolvedProviderRuntime,
} from "./provider.js";
import { chooseProviderAndModel, type ChooseProviderAndModelResult } from "./provider-picker.js";

export interface InteractiveProviderResolutionOptions extends CreateResolvedProviderOptions {
	providerModels: Record<string, string[]>;
	providerStatuses: FastProviderStatus[];
	allowOnboarding: boolean;
	maxPickerRetries?: number;
}

interface InteractiveProviderOnboardingDependencies {
	resolveProvider?: typeof createResolvedProvider;
	chooseProviderAndModel?: typeof chooseProviderAndModel;
	writeLine?: (line: string) => void;
}

interface InteractiveProviderSetupMessageInput {
	error: Error;
	provider: string;
	model?: string;
	preferredProvider?: string;
	preferredModel?: string;
	providerStatuses: FastProviderStatus[];
	attempt: number;
	maxAttempts: number;
}

/**
 * I keep interactive startup alive when the runtime simply lacks a usable
 * provider path, while still respecting strict Chitragupta route authority.
 */
export async function resolveInteractiveProviderWithOnboarding(
	config: TakumiConfig,
	options: InteractiveProviderResolutionOptions,
	dependencies: InteractiveProviderOnboardingDependencies = {},
): Promise<ResolvedProviderRuntime> {
	const resolveProvider = dependencies.resolveProvider ?? createResolvedProvider;
	const pickProvider = dependencies.chooseProviderAndModel ?? chooseProviderAndModel;
	const writeLine = dependencies.writeLine ?? ((line: string) => process.stderr.write(`${line}\n`));
	const resolutionOptions = buildResolutionOptions(options);

	try {
		return await resolveProvider(config, resolutionOptions);
	} catch (error) {
		if (!options.allowOnboarding || options.strictPreferredRoute || !isProviderConfigurationError(error)) {
			throw error;
		}

		let lastError = error;
		const maxAttempts = Math.max(1, options.maxPickerRetries ?? 2);
		for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
			writeLine(
				formatInteractiveProviderSetupMessage({
					error: lastError,
					provider: config.provider,
					model: config.model,
					preferredProvider: options.preferredProvider,
					preferredModel: options.preferredModel,
					providerStatuses: options.providerStatuses,
					attempt,
					maxAttempts,
				}),
			);

			const selection = await pickProvider(config, options.providerModels, {
				preferredProvider: options.preferredProvider ?? config.provider,
				preferredModel: options.preferredModel ?? config.model,
				showIntro: false,
			});
			if (!selection) {
				throw lastError;
			}

			try {
				return await resolveProvider(config, resolutionOptions);
			} catch (retryError) {
				if (!isProviderConfigurationError(retryError)) {
					throw retryError;
				}
				lastError = retryError;
			}
		}

		throw lastError;
	}
}

/**
 * I turn a dry provider-config failure into a human startup recovery prompt.
 */
export function formatInteractiveProviderSetupMessage(input: InteractiveProviderSetupMessageInput): string {
	const routedTarget = formatOptionalTarget(input.preferredProvider, input.preferredModel);
	const currentTarget = formatDisplayTarget(input.provider, input.model);
	const attemptPrefix =
		input.attempt > 1 ? `Retry ${input.attempt} of ${input.maxAttempts}: the last pick still did not initialize.` : "Takumi needs a live provider path before the session can start.";

	return [
		"\x1b[33m⚠ Startup provider setup needed\x1b[0m",
		attemptPrefix,
		routedTarget
			? `Chitragupta suggested: ${routedTarget} (Takumi can fall back because this route is not strict).`
			: `Current startup target: ${currentTarget}.`,
		`Discovered providers: ${formatDiscoveredProviderSummary(input.providerStatuses)}`,
		"Pick a provider/model for this session, or cancel and fix it persistently with `takumi doctor` or `takumi config open`.",
		`Details: ${input.error.message}`,
	].join("\n");
}

function buildResolutionOptions(options: InteractiveProviderResolutionOptions): CreateResolvedProviderOptions {
	return {
		fallbackName: options.fallbackName,
		preferredProvider: options.preferredProvider,
		preferredModel: options.preferredModel,
		strictPreferredRoute: options.strictPreferredRoute,
		allowStandaloneFallback: options.allowStandaloneFallback,
		bootstrapBridge: options.bootstrapBridge,
	};
}

function formatOptionalTarget(provider: string | undefined, model: string | undefined): string | undefined {
	if (!provider && !model) return undefined;
	return formatDisplayTarget(provider, model);
}

function formatDisplayTarget(provider: string | undefined, model: string | undefined): string {
	if (provider && model) return `${provider} / ${model}`;
	if (provider) return provider;
	if (model) return model;
	return "unresolved provider";
}

export type { ChooseProviderAndModelResult };