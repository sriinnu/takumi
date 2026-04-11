import type { bootstrapChitraguptaForExec } from "@takumi/agent";
import { ChitraguptaObserver } from "@takumi/bridge";
import type { ExecRoutingBinding, ExecSessionBinding, TakumiConfig } from "@takumi/core";
import {
	extractSelectedModel,
	extractSelectedProvider,
	normalizeExecProviderFamily,
	resolveExecConcreteProvider,
} from "./one-shot-helpers.js";

/** Resolved Chitragupta bridge handle from bootstrapChitraguptaForExec. */
export type ExecBridge = NonNullable<Awaited<ReturnType<typeof bootstrapChitraguptaForExec>>["bridge"]>;

/** Ask Chitragupta for one exec route and only trust it when Takumi can bind a concrete provider. */
export async function resolveExecRouting(
	bridge: ExecBridge,
	session: ExecSessionBinding,
	prompt: string,
	config: TakumiConfig,
	capability: string,
): Promise<ExecRoutingBinding> {
	try {
		const observer = new ChitraguptaObserver(bridge as never);
		const decision = await observer.routeResolve({
			consumer: "takumi.exec",
			sessionId: session.canonicalSessionId ?? "transient",
			capability,
			constraints: { requireStreaming: true, hardProviderFamily: normalizeExecProviderFamily(config.provider) ?? undefined },
			context: {
				projectPath: session.projectPath,
				promptLength: prompt.length,
				configuredModel: config.model,
				configuredProvider: config.provider,
			},
		});
		const selected = decision?.selected;
		const selectedModel = extractSelectedModel(selected?.metadata);
		const selectedProvider = extractSelectedProvider(selected?.metadata);
		const concreteProvider = resolveExecConcreteProvider(
			selected?.providerFamily,
			selectedProvider,
			selectedModel,
			config.provider,
		);
		const canApplyModel = Boolean(selected && selectedModel && concreteProvider);
		return {
			capability,
			authority: canApplyModel ? "engine" : "takumi-fallback",
			enforcement: canApplyModel ? "same-provider" : "capability-only",
			provider: concreteProvider ?? config.provider,
			model: canApplyModel ? selectedModel : config.model,
			degraded: decision?.degraded ?? false,
		};
	} catch {
		return {
			capability,
			authority: "takumi-fallback",
			enforcement: "capability-only",
			provider: config.provider,
			model: config.model,
		};
	}
}
