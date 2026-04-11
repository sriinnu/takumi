import type {
	VerticalRegistryAuthContract,
	VerticalRegistryBindSubscribeContract,
	VerticalRegistryBundle,
	VerticalRegistryContract,
	VerticalRegistryProfile,
} from "./chitragupta-vertical-contract-types.js";
import type { DaemonSocketClient } from "./daemon-socket.js";

function normalizeVerticalId(value: string): string {
	return value.trim().toLowerCase();
}

/** I expose the actionable runtime truth one Takumi-like consumer needs from the vertical contract. */
export interface VerticalRuntimeContractSurface {
	verticalId: string;
	profile: VerticalRegistryProfile;
	bundles: VerticalRegistryBundle[];
	auth: VerticalRegistryAuthContract;
	bindSubscribe: VerticalRegistryBindSubscribeContract;
	runtime: {
		usesDaemonBridgeToken: boolean;
		allowsServePairing: boolean;
		daemonRuntimeStartupAllowed: boolean;
		supportsBindingTokens: boolean;
		supportsRotation: boolean;
		supportsRevocation: boolean;
		supportsIntrospection: boolean;
		subscribeTransport: string;
		supportsReplayRecovery: boolean;
		supportsReattach: boolean;
	};
}

/** I collapse the raw daemon registry and auth blocks into one consumer-usable runtime contract. */
export function resolveVerticalRuntimeContract(
	registry: VerticalRegistryContract,
	auth: VerticalRegistryAuthContract,
	verticalId: string,
): VerticalRuntimeContractSurface | null {
	const normalizedId = normalizeVerticalId(verticalId);
	const profile = registry.profiles.find((entry) => normalizeVerticalId(entry.id) === normalizedId);
	if (!profile) return null;

	const bundleIds = new Set(profile.bundleIds);
	const bundles = registry.bundles.filter((bundle) => bundleIds.has(bundle.id));
	const usesDaemonBridgeToken =
		profile.authMode === "daemon-bridge-token" || profile.authMode === "daemon-bridge-token-or-serve-pairing-jwt";
	const allowsServePairing =
		profile.authMode === "serve-pairing-jwt" || profile.authMode === "daemon-bridge-token-or-serve-pairing-jwt";

	return {
		verticalId: profile.id,
		profile,
		bundles,
		auth,
		bindSubscribe: registry.bindSubscribe,
		runtime: {
			usesDaemonBridgeToken,
			allowsServePairing,
			daemonRuntimeStartupAllowed: usesDaemonBridgeToken,
			supportsBindingTokens: Boolean(auth.verticalTokens.issueMethod && auth.verticalTokens.exchangeMethod),
			supportsRotation: auth.verticalTokens.supportsRotation,
			supportsRevocation: auth.verticalTokens.supportsRevocation,
			supportsIntrospection: auth.verticalTokens.supportsIntrospection,
			subscribeTransport: registry.bindSubscribe.subscribe.transport,
			supportsReplayRecovery: registry.bindSubscribe.subscribe.missedEventRecovery.steps.length > 0,
			supportsReattach: registry.bindSubscribe.subscribe.reattach.resumeViaBootstrap,
		},
	};
}

/** I fetch and combine the daemon-owned registry/auth blocks into one runtime contract for a vertical. */
export async function describeVerticalRuntimeContract(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	verticalId: string,
): Promise<VerticalRuntimeContractSurface | null> {
	if (!socketMode || !socket?.isConnected) return null;
	const [registry, auth] = await Promise.all([
		socket.call<VerticalRegistryContract>("vertical.registry", {}),
		socket.call<VerticalRegistryAuthContract>("vertical.auth.describe", {}),
	]);
	return resolveVerticalRuntimeContract(registry, auth, verticalId);
}
