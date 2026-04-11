import type { ChitraguptaBridge } from "@takumi/bridge";
import type { SessionControlPlaneLaneState } from "@takumi/core";
import { mapBootstrapLanesToSessionState } from "../app-startup.js";

type LaneAuthoritySource = NonNullable<SessionControlPlaneLaneState["authoritySource"]>;

export interface RefreshedControlPlaneLanes {
	lanes: SessionControlPlaneLaneState[];
	source: LaneAuthoritySource | null;
	warnings: string[];
}

/**
 * Refresh one canonical session's lane truth from Chitragupta before Takumi
 * trusts any cached local lane snapshot.
 */
export async function refreshControlPlaneLanesFromDaemon(
	bridge: Pick<ChitraguptaBridge, "routeLanesGet" | "routeLanesRefresh">,
	sessionId: string | undefined,
	projectPath: string,
	consumer = "takumi",
): Promise<RefreshedControlPlaneLanes> {
	if (!sessionId) {
		return { lanes: [], source: null, warnings: [] };
	}

	const warnings: string[] = [];
	try {
		const refreshed = await bridge.routeLanesRefresh({
			sessionId,
			project: projectPath,
			consumer,
			refreshReason: "takumi.connect",
		});
		if (refreshed?.lanes.length) {
			return {
				lanes: mapBootstrapLanesToSessionState(refreshed.lanes, "route.lanes.refresh"),
				source: "route.lanes.refresh",
				warnings,
			};
		}
	} catch (error) {
		warnings.push(`Control-plane lane refresh failed: ${(error as Error).message}`);
	}

	try {
		const stored = await bridge.routeLanesGet({
			sessionId,
			project: projectPath,
		});
		if (stored?.lanes.length) {
			return {
				lanes: mapBootstrapLanesToSessionState(stored.lanes, "route.lanes.get"),
				source: "route.lanes.get",
				warnings,
			};
		}
	} catch (error) {
		warnings.push(`Control-plane lane reload failed: ${(error as Error).message}`);
	}

	return { lanes: [], source: null, warnings };
}
