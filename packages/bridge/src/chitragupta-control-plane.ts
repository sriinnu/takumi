/**
 * Socket-only daemon control-plane helpers for bootstrap and credential access.
 *
 * I keep these helpers separate from the high-level bridge so Takumi can
 * consume the daemon-first contract without mixing transport parsing into the
 * memory/session surface.
 */

import {
	BRIDGE_BOOTSTRAP_POLICY_BUDGETS,
	BRIDGE_BOOTSTRAP_PROVIDER_LANES,
	BRIDGE_BOOTSTRAP_PROVIDER_TRANSPORTS,
	BRIDGE_BOOTSTRAP_VERTICAL_RESOLUTION_SOURCES,
	type BridgeBootstrapRequest,
	type DaemonBridgeBootstrapAuth,
	type DaemonBridgeBootstrapBinding,
	type DaemonBridgeBootstrapContinuity,
	type DaemonBridgeBootstrapInventory,
	type DaemonBridgeBootstrapInventoryModel,
	type DaemonBridgeBootstrapInventoryProvider,
	type DaemonBridgeBootstrapInventoryRuntime,
	type DaemonBridgeBootstrapLane,
	type DaemonBridgeBootstrapLanePolicy,
	type DaemonBridgeBootstrapResult,
	type DaemonBridgeBootstrapRoutingDecision,
	type DaemonBridgeBootstrapSession,
	type DaemonBridgeBootstrapVertical,
	type DaemonBridgeLaneRefreshRequest,
	type DaemonBridgeLaneSnapshotRequest,
	type DaemonBridgeLaneSnapshotResult,
	type DaemonBridgeProtocolDescriptor,
	type ProviderCredentialResolution,
	VERTICAL_PROFILE_AUTH_MODES,
	VERTICAL_PROFILE_PREFERRED_TRANSPORTS,
	VERTICAL_RUNTIME_RECOVERY_ACTIONS,
	type VerticalRuntimeContinuityRecord,
	type VerticalRuntimeRecoveryPlan,
} from "./chitragupta-bootstrap-types.js";
import type { DaemonSocketClient } from "./daemon-socket.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNullableString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function readNullableBoolean(value: unknown): boolean | null {
	return typeof value === "boolean" ? value : null;
}

function readProviderLane(value: unknown): DaemonBridgeBootstrapInventoryProvider["lane"] {
	return BRIDGE_BOOTSTRAP_PROVIDER_LANES.includes(value as DaemonBridgeBootstrapInventoryProvider["lane"])
		? (value as DaemonBridgeBootstrapInventoryProvider["lane"])
		: "cloud";
}

function readProviderTransport(value: unknown): DaemonBridgeBootstrapInventoryProvider["transport"] {
	return BRIDGE_BOOTSTRAP_PROVIDER_TRANSPORTS.includes(value as DaemonBridgeBootstrapInventoryProvider["transport"])
		? (value as DaemonBridgeBootstrapInventoryProvider["transport"])
		: "remote-api";
}

function readBudgetClass(value: unknown): DaemonBridgeBootstrapInventoryModel["costClass"] {
	return BRIDGE_BOOTSTRAP_POLICY_BUDGETS.includes(value as DaemonBridgeBootstrapInventoryModel["costClass"])
		? (value as DaemonBridgeBootstrapInventoryModel["costClass"])
		: "medium";
}

function readPreferredTransport(value: unknown): DaemonBridgeBootstrapVertical["preferredTransport"] {
	return VERTICAL_PROFILE_PREFERRED_TRANSPORTS.includes(value as (typeof VERTICAL_PROFILE_PREFERRED_TRANSPORTS)[number])
		? (value as DaemonBridgeBootstrapVertical["preferredTransport"])
		: null;
}

function readAllowedTransports(value: unknown): DaemonBridgeBootstrapVertical["allowedTransports"] {
	return Array.isArray(value)
		? value.filter((entry): entry is DaemonBridgeBootstrapVertical["allowedTransports"][number] =>
				VERTICAL_PROFILE_PREFERRED_TRANSPORTS.includes(entry as (typeof VERTICAL_PROFILE_PREFERRED_TRANSPORTS)[number]),
			)
		: [];
}

function readAuthMode(value: unknown): DaemonBridgeBootstrapVertical["authMode"] {
	return VERTICAL_PROFILE_AUTH_MODES.includes(value as (typeof VERTICAL_PROFILE_AUTH_MODES)[number])
		? (value as DaemonBridgeBootstrapVertical["authMode"])
		: null;
}

function readVerticalResolutionSource(value: unknown): DaemonBridgeBootstrapVertical["resolutionSource"] {
	return BRIDGE_BOOTSTRAP_VERTICAL_RESOLUTION_SOURCES.includes(
		value as (typeof BRIDGE_BOOTSTRAP_VERTICAL_RESOLUTION_SOURCES)[number],
	)
		? (value as DaemonBridgeBootstrapVertical["resolutionSource"])
		: "unbound";
}

function readBootstrapVertical(value: unknown): DaemonBridgeBootstrapVertical {
	if (!isRecord(value)) {
		return {
			contractVersion: 1,
			id: null,
			label: null,
			description: null,
			preferredTransport: null,
			authMode: null,
			allowedTransports: [],
			bundleIds: [],
			availableBundleIds: [],
			requestedBundleIds: [],
			deniedBundleIds: [],
			consumer: null,
			surface: null,
			canonical: false,
			degraded: true,
			resolutionSource: "unbound",
		};
	}
	return {
		contractVersion: 1,
		id: readNullableString(value.id),
		label: readNullableString(value.label),
		description: readNullableString(value.description),
		preferredTransport: readPreferredTransport(value.preferredTransport),
		authMode: readAuthMode(value.authMode),
		allowedTransports: readAllowedTransports(value.allowedTransports),
		bundleIds: readStringArray(value.bundleIds),
		availableBundleIds: readStringArray(value.availableBundleIds),
		requestedBundleIds: readStringArray(value.requestedBundleIds),
		deniedBundleIds: readStringArray(value.deniedBundleIds),
		consumer: readNullableString(value.consumer),
		surface: readNullableString(value.surface),
		canonical: value.canonical === true,
		degraded: value.degraded === true,
		resolutionSource: readVerticalResolutionSource(value.resolutionSource),
	};
}

function readBootstrapContinuityRecord(value: unknown): VerticalRuntimeContinuityRecord | null {
	if (!isRecord(value)) return null;
	return {
		contractVersion: 1,
		identityKey: readNullableString(value.identityKey),
		verticalId: String(value.verticalId ?? ""),
		consumer: readNullableString(value.consumer),
		surface: String(value.surface ?? ""),
		channel: readNullableString(value.channel),
		project: readNullableString(value.project),
		sessionId: readNullableString(value.sessionId),
		sessionReusePolicy: readNullableString(value.sessionReusePolicy),
		clientKey: readNullableString(value.clientKey),
		sessionLineageKey: readNullableString(value.sessionLineageKey),
		attachedClientId: readNullableString(value.attachedClientId),
		authFamily: readNullableString(value.authFamily),
		status: value.status === "detached" ? "detached" : "active",
		state: value.state === "reattachable" ? "reattachable" : "tracked",
		requiredAction: value.requiredAction === "reattach-via-bridge.bootstrap" ? "reattach-via-bridge.bootstrap" : "none",
		source: "durable-record",
		lastSeenAt: typeof value.lastSeenAt === "number" ? value.lastSeenAt : null,
		lastDetachedAt: typeof value.lastDetachedAt === "number" ? value.lastDetachedAt : null,
		updatedAt: Number(value.updatedAt ?? 0),
	};
}

function readBootstrapRecoveryPlan(value: unknown): VerticalRuntimeRecoveryPlan {
	const record = isRecord(value) ? value : {};
	const action = VERTICAL_RUNTIME_RECOVERY_ACTIONS.includes(
		record.action as (typeof VERTICAL_RUNTIME_RECOVERY_ACTIONS)[number],
	)
		? (record.action as VerticalRuntimeRecoveryPlan["action"])
		: "bootstrap-new-runtime";
	return {
		contractVersion: 1,
		action,
		activeElsewhere: record.activeElsewhere === true,
		shouldBootstrap:
			typeof record.shouldBootstrap === "boolean" ? record.shouldBootstrap : action === "bootstrap-new-runtime",
		shouldResubscribe: record.shouldResubscribe === true,
		shouldReplay: record.shouldReplay === true,
		steps: readStringArray(record.steps),
	};
}

function readBootstrapContinuity(value: unknown): DaemonBridgeBootstrapContinuity | null {
	if (value == null) return null;
	if (!isRecord(value)) {
		throw new Error("bridge.bootstrap continuity metadata is invalid");
	}
	return {
		contractVersion: 1,
		tracked: value.tracked === true,
		reattached: value.reattached === true,
		activeElsewhere: value.activeElsewhere === true,
		record: readBootstrapContinuityRecord(value.record),
		plan: readBootstrapRecoveryPlan(value.plan),
	};
}

/** Parse the daemon bootstrap protocol block once before Takumi trusts it. */
function readProtocol(value: unknown): DaemonBridgeProtocolDescriptor {
	if (!isRecord(value)) {
		throw new Error("bridge.bootstrap protocol metadata is missing");
	}
	return {
		name: "chitragupta-daemon-bridge",
		version: Number(value.version ?? 0),
		minCompatibleVersion: Number(value.minCompatibleVersion ?? 0),
		maxCompatibleVersion: Number(value.maxCompatibleVersion ?? 0),
	};
}

function readBootstrapAuth(value: unknown): DaemonBridgeBootstrapAuth {
	if (!isRecord(value)) {
		throw new Error("bridge.bootstrap auth metadata is missing");
	}
	return {
		authenticated: value.authenticated === true,
		keyId: readNullableString(value.keyId),
		tenantId: readNullableString(value.tenantId),
		scopes: readStringArray(value.scopes),
	};
}

function readBootstrapBinding(value: unknown): DaemonBridgeBootstrapBinding {
	if (!isRecord(value)) {
		throw new Error("bridge.bootstrap binding metadata is missing");
	}
	return {
		mode: String(value.mode ?? "exec") as DaemonBridgeBootstrapBinding["mode"],
		project: readNullableString(value.project),
		consumer: readNullableString(value.consumer),
		clientId: readNullableString(value.clientId),
	};
}

function readBootstrapInventoryModel(value: unknown): DaemonBridgeBootstrapInventoryModel {
	if (!isRecord(value)) {
		throw new Error("bridge.bootstrap inventory model metadata is invalid");
	}
	const id = readNullableString(value.id) ?? "";
	return {
		id,
		name: readNullableString(value.name) ?? id,
		available: value.available === true,
		health: readNullableString(value.health) ?? "unknown",
		capabilities: readStringArray(value.capabilities),
		contextWindow: Number(value.contextWindow ?? 0),
		maxOutputTokens: Number(value.maxOutputTokens ?? 0),
		costClass: readBudgetClass(value.costClass),
		source: readNullableString(value.source) ?? "unknown",
	};
}

function readBootstrapInventoryRuntime(value: unknown): DaemonBridgeBootstrapInventoryRuntime | null {
	if (value == null) return null;
	if (!isRecord(value)) {
		throw new Error("bridge.bootstrap inventory runtime metadata is invalid");
	}
	return {
		transport: readProviderTransport(value.transport),
		endpoint: readNullableString(value.endpoint),
		command: readNullableString(value.command),
		commandPath: readNullableString(value.commandPath),
		configured: value.configured === true,
		reachable: value.reachable === true,
		preferred: value.preferred === true,
		lastError: readNullableString(value.lastError),
	};
}

function readBootstrapInventoryProvider(value: unknown): DaemonBridgeBootstrapInventoryProvider {
	if (!isRecord(value)) {
		throw new Error("bridge.bootstrap inventory provider metadata is invalid");
	}
	const id = readNullableString(value.id) ?? "";
	const models = Array.isArray(value.models) ? value.models.map((model) => readBootstrapInventoryModel(model)) : [];
	return {
		id,
		name: readNullableString(value.name) ?? id,
		lane: readProviderLane(value.lane),
		transport: readProviderTransport(value.transport),
		available: value.available === true,
		authenticated: value.authenticated === true,
		credentialAvailable: value.credentialAvailable === true,
		credentialSource: readNullableString(value.credentialSource),
		modelCount: Number(value.modelCount ?? models.length),
		models,
		issues: readStringArray(value.issues),
		runtime: readBootstrapInventoryRuntime(value.runtime),
	};
}

function readBootstrapInventory(value: unknown): DaemonBridgeBootstrapInventory {
	if (!isRecord(value)) {
		throw new Error("bridge.bootstrap inventory metadata is invalid");
	}
	const providers = Array.isArray(value.providers)
		? value.providers
				.map((provider) => readBootstrapInventoryProvider(provider))
				.filter((provider) => provider.id.length > 0)
		: [];
	return {
		contractVersion: 1,
		snapshotAt: Number(value.snapshotAt ?? 0),
		discoverySnapshotAt: typeof value.discoverySnapshotAt === "number" ? value.discoverySnapshotAt : null,
		localRuntimeSnapshotAt: typeof value.localRuntimeSnapshotAt === "number" ? value.localRuntimeSnapshotAt : null,
		providerPriority: readStringArray(value.providerPriority),
		lanePriority: Array.isArray(value.lanePriority)
			? value.lanePriority.filter((entry): entry is DaemonBridgeBootstrapInventory["lanePriority"][number] =>
					BRIDGE_BOOTSTRAP_PROVIDER_LANES.includes(entry as DaemonBridgeBootstrapInventory["lanePriority"][number]),
				)
			: [],
		providers,
		stale: value.stale === true,
		staleReason: readNullableString(value.staleReason),
		warnings: readStringArray(value.warnings),
	};
}

function readBootstrapSession(value: unknown): DaemonBridgeBootstrapSession | null {
	if (value == null) return null;
	if (!isRecord(value)) {
		throw new Error("bridge.bootstrap session metadata is invalid");
	}
	return {
		id: readNullableString(value.id),
		created: typeof value.created === "boolean" ? value.created : null,
		lineageKey: readNullableString(value.lineageKey),
		sessionReusePolicy: readNullableString(value.sessionReusePolicy),
	};
}

function readBootstrapRoutingDecision(value: unknown): DaemonBridgeBootstrapRoutingDecision | null {
	if (value == null) return null;
	if (!isRecord(value)) {
		throw new Error("bridge.bootstrap routing decision is invalid");
	}
	return {
		authority: "chitragupta",
		source: String(value.source ?? "route.resolve") as DaemonBridgeBootstrapRoutingDecision["source"],
		routeClass: readNullableString(value.routeClass),
		capability: readNullableString(value.capability),
		selectedCapabilityId: readNullableString(value.selectedCapabilityId),
		provider: readNullableString(value.provider),
		model: readNullableString(value.model),
		requestedBudget: readNullableString(value.requestedBudget),
		effectiveBudget: readNullableString(value.effectiveBudget),
		degraded: value.degraded === true,
		reasonCode: String(value.reasonCode ?? ""),
		reason: readNullableString(value.reason),
		policyTrace: readStringArray(value.policyTrace),
		fallbackChain: readStringArray(value.fallbackChain),
		discoverableOnly: value.discoverableOnly === true,
		requestId: readNullableString(value.requestId),
		traceId: readNullableString(value.traceId),
		snapshotAt: Number(value.snapshotAt ?? 0),
		expiresAt: null,
		cacheScope: "request",
	};
}

function readBootstrapLanePolicy(value: unknown, role: string): DaemonBridgeBootstrapLanePolicy {
	const record = isRecord(value) ? value : {};
	return {
		contractVersion: 1,
		role,
		preferLocal: readNullableBoolean(record.preferLocal),
		allowCloud: readNullableBoolean(record.allowCloud),
		maxCostClass:
			record.maxCostClass === "free" ||
			record.maxCostClass === "low" ||
			record.maxCostClass === "medium" ||
			record.maxCostClass === "high"
				? record.maxCostClass
				: null,
		requireStreaming: readNullableBoolean(record.requireStreaming),
		hardProviderFamily: readNullableString(record.hardProviderFamily),
		preferredProviderFamilies: readStringArray(record.preferredProviderFamilies),
		toolAccess:
			record.toolAccess === "allow" || record.toolAccess === "deny" || record.toolAccess === "inherit"
				? record.toolAccess
				: "inherit",
		privacyBoundary:
			record.privacyBoundary === "local-preferred" ||
			record.privacyBoundary === "cloud-ok" ||
			record.privacyBoundary === "strict-local" ||
			record.privacyBoundary === "inherit"
				? record.privacyBoundary
				: "inherit",
		fallbackStrategy:
			record.fallbackStrategy === "same-provider" ||
			record.fallbackStrategy === "capability-only" ||
			record.fallbackStrategy === "none"
				? record.fallbackStrategy
				: "capability-only",
		tags: readStringArray(record.tags),
	};
}

function readBootstrapLanes(value: unknown): DaemonBridgeBootstrapLane[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => {
			if (!isRecord(entry)) return null;
			const role = readNullableString(entry.role) ?? readNullableString(entry.key) ?? "lane";
			const requestedPolicy = readBootstrapLanePolicy(entry.requestedPolicy ?? entry.policy, role);
			const effectivePolicy = readBootstrapLanePolicy(entry.effectivePolicy ?? entry.policy, role);
			return {
				key: readNullableString(entry.key) ?? "lane",
				role,
				laneId: readNullableString(entry.laneId) ?? "",
				durableKey: readNullableString(entry.durableKey) ?? "",
				snapshotAt: Number(entry.snapshotAt ?? 0),
				policy: effectivePolicy,
				requestedPolicy,
				effectivePolicy,
				constraintsApplied: isRecord(entry.constraintsApplied) ? entry.constraintsApplied : null,
				policyHash: readNullableString(entry.policyHash),
				policyWarnings: readStringArray(entry.policyWarnings),
				route: isRecord(entry.route) ? entry.route : null,
				routingDecision: readBootstrapRoutingDecision(entry.routingDecision),
			} satisfies DaemonBridgeBootstrapLane;
		})
		.filter((entry): entry is DaemonBridgeBootstrapLane => entry !== null && entry.laneId.length > 0);
}

function readLaneSnapshot(value: unknown): DaemonBridgeLaneSnapshotResult {
	if (!isRecord(value)) {
		throw new Error("route.lanes payload is invalid");
	}
	const lanes = readBootstrapLanes(value.lanes);
	return {
		contractVersion: Number(value.contractVersion ?? 0),
		sessionId: readNullableString(value.sessionId),
		project: readNullableString(value.project),
		primaryLaneKey: readNullableString(value.primaryLaneKey),
		laneCount: Number(value.laneCount ?? lanes.length),
		lanes,
	};
}

/** Call the canonical daemon bootstrap method over the live socket. */
export async function daemonBootstrap(
	socket: DaemonSocketClient | null,
	request: BridgeBootstrapRequest,
): Promise<DaemonBridgeBootstrapResult | null> {
	if (!socket?.isConnected) return null;
	const raw = await socket.call<Record<string, unknown>>(
		"bridge.bootstrap",
		request as unknown as Record<string, unknown>,
	);
	if (!isRecord(raw)) {
		throw new Error("bridge.bootstrap returned an invalid payload");
	}
	return {
		contractVersion: Number(raw.contractVersion ?? 0),
		protocol: readProtocol(raw.protocol),
		connected: raw.connected === true,
		degraded: raw.degraded === true,
		transport: String(raw.transport ?? "unknown"),
		authority: String(raw.authority ?? "unknown"),
		requestId: readNullableString(raw.requestId),
		traceId: readNullableString(raw.traceId),
		taskId: readNullableString(raw.taskId),
		laneId: readNullableString(raw.laneId),
		warnings: readStringArray(raw.warnings),
		auth: readBootstrapAuth(raw.auth),
		binding: readBootstrapBinding(raw.binding),
		session: readBootstrapSession(raw.session),
		vertical: readBootstrapVertical(raw.vertical),
		continuity: readBootstrapContinuity(raw.continuity),
		inventory: readBootstrapInventory(raw.inventory),
		route: isRecord(raw.route) ? raw.route : null,
		routingDecision: readBootstrapRoutingDecision(raw.routingDecision),
		lanes: readBootstrapLanes(raw.lanes),
		capabilities: raw.capabilities,
	};
}

/** Fetch the daemon-owned durable lane snapshot for one canonical session. */
export async function daemonRouteLanesGet(
	socket: DaemonSocketClient | null,
	request: DaemonBridgeLaneSnapshotRequest,
): Promise<DaemonBridgeLaneSnapshotResult | null> {
	if (!socket?.isConnected) return null;
	const raw = await socket.call<Record<string, unknown>>("route.lanes.get", {
		sessionId: request.sessionId,
		project: request.project,
	});
	return readLaneSnapshot(raw);
}

/** Refresh the daemon-owned durable lane snapshot for one canonical session. */
export async function daemonRouteLanesRefresh(
	socket: DaemonSocketClient | null,
	request: DaemonBridgeLaneRefreshRequest,
): Promise<DaemonBridgeLaneSnapshotResult | null> {
	if (!socket?.isConnected) return null;
	const raw = await socket.call<Record<string, unknown>>("route.lanes.refresh", {
		sessionId: request.sessionId,
		project: request.project,
		consumer: request.consumer,
		refreshReason: request.refreshReason,
	});
	return readLaneSnapshot(raw);
}

/**
 * Ask Chitragupta for the bound provider credential before Takumi falls back
 * to local CLI or environment probing.
 */
export async function resolveProviderCredential(
	socket: DaemonSocketClient | null,
	providerId?: string,
): Promise<ProviderCredentialResolution | null> {
	if (!socket?.isConnected) return null;
	const params = providerId ? { providerId } : {};
	try {
		return await socket.call<ProviderCredentialResolution>("provider.credentials.resolve", params);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!/method not found|code:\s*-32601/i.test(message)) {
			throw error;
		}
		if (!providerId) return null;
		const fallback = await socket.call<{ found?: boolean; providerId?: string; value?: string | null }>(
			"provider.credentials.retrieve",
			{ providerId },
		);
		return {
			found: fallback.found === true && typeof fallback.value === "string" && fallback.value.length > 0,
			providerId: typeof fallback.providerId === "string" ? fallback.providerId : providerId,
			boundProviderId: typeof fallback.providerId === "string" ? fallback.providerId : providerId,
			modelId: null,
			routeClass: null,
			selectedCapabilityId: null,
			consumer: null,
			value: typeof fallback.value === "string" ? fallback.value : null,
			needsRekey: false,
		};
	}
}
