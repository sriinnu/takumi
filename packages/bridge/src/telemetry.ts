import fs from "node:fs/promises";
import path from "node:path";
import { createLogger, TELEMETRY_DIR } from "@takumi/core";
import type { AgentTelemetry, TelemetrySnapshot } from "./chitragupta-types.js";

const log = createLogger("telemetry");

export { TELEMETRY_DIR };

/**
 * Emit telemetry heartbeat to local JSON file.
 * Merges with cached data and writes atomically.
 *
 * @param cache - Current cached telemetry data
 * @param update - Partial telemetry data to merge
 * @param telemetryDir - Optional override for telemetry directory (for testing)
 * @returns Updated cache
 */
export async function telemetryHeartbeat(
	cache: Partial<AgentTelemetry>,
	update: Partial<AgentTelemetry>,
	telemetryDir = TELEMETRY_DIR,
): Promise<Partial<AgentTelemetry>> {
	const updatedCache: Partial<AgentTelemetry> = {
		...cache,
		...update,
		schemaVersion: 2,
	};

	const telemetryFile = path.join(telemetryDir, `${process.pid}.json`);

	// Ensure directory exists
	await fs.mkdir(telemetryDir, { recursive: true });

	// Atomic write (temp file + rename)
	const tempFile = `${telemetryFile}.tmp`;
	await fs.writeFile(tempFile, JSON.stringify(updatedCache, null, 2));
	await fs.rename(tempFile, telemetryFile);

	return updatedCache;
}

/**
 * Cleanup telemetry file for a specific PID.
 * Safe to call even if file doesn't exist.
 *
 * @param pid - Process ID to cleanup
 * @param telemetryDir - Optional override for telemetry directory (for testing)
 */
export async function telemetryCleanup(pid = process.pid, telemetryDir = TELEMETRY_DIR): Promise<void> {
	const telemetryFile = path.join(telemetryDir, `${pid}.json`);

	try {
		await fs.unlink(telemetryFile);
	} catch (err) {
		// Ignore if file doesn't exist
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			throw err;
		}
	}
}

/**
 * Aggregate telemetry snapshot from all active instances.
 * Filters stale instances based on heartbeat timestamp.
 *
 * @param staleMs - Milliseconds to consider instance stale (default: 10s)
 * @param telemetryDir - Optional override for telemetry directory (for testing)
 * @returns TelemetrySnapshot with aggregated stats
 */
export async function telemetrySnapshot(staleMs = 10000, telemetryDir = TELEMETRY_DIR): Promise<TelemetrySnapshot> {
	const now = Date.now();
	const instances: AgentTelemetry[] = [];

	// Read all telemetry files
	try {
		const files = await fs.readdir(telemetryDir);

		for (const file of files) {
			if (!file.endsWith(".json")) continue;

			try {
				const content = await fs.readFile(path.join(telemetryDir, file), "utf-8");
				const data = JSON.parse(content) as AgentTelemetry;

				// Validate minimum required structure for aggregation
				if (
					typeof data.process?.heartbeatAt !== "number" ||
					typeof data.state?.activity !== "string" ||
					typeof data.context?.pressure !== "string" ||
					typeof data.session?.id !== "string"
				) {
					continue;
				}

				// Skip stale instances (no heartbeat in staleMs)
				if (now - data.process.heartbeatAt > staleMs) continue;

				instances.push(data);
			} catch {}
		}
	} catch (err) {
		// Directory doesn't exist or not readable - return empty snapshot
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			log.warn(`Failed to read telemetry directory: ${(err as Error).message}`);
		}
	}

	// Aggregate activity counts
	const counts = {
		total: instances.length,
		working: instances.filter((i) => i.state.activity === "working").length,
		waiting_input: instances.filter((i) => i.state.activity === "waiting_input").length,
		idle: instances.filter((i) => i.state.activity === "idle").length,
		error: instances.filter((i) => i.state.activity === "error").length,
	};

	// Aggregate context pressure
	const context = {
		total: instances.length,
		normal: instances.filter((i) => i.context.pressure === "normal").length,
		approachingLimit: instances.filter((i) => i.context.pressure === "approaching_limit").length,
		nearLimit: instances.filter((i) => i.context.pressure === "near_limit").length,
		atLimit: instances.filter((i) => i.context.pressure === "at_limit").length,
	};

	// Group by session
	const sessions: Record<string, { sessionId: string; instances: number; statuses: string[] }> = {};
	instances.forEach((inst) => {
		if (!sessions[inst.session.id]) {
			sessions[inst.session.id] = {
				sessionId: inst.session.id,
				instances: 0,
				statuses: [],
			};
		}
		sessions[inst.session.id].instances++;
		sessions[inst.session.id].statuses.push(inst.state.activity);
	});

	// Determine aggregate activity
	const aggregate: TelemetrySnapshot["aggregate"] =
		counts.working > 0 && counts.waiting_input > 0
			? "mixed"
			: counts.working > 0
				? "working"
				: counts.waiting_input > 0
					? "waiting_input"
					: "idle";

	return {
		schemaVersion: 2,
		timestamp: now,
		aggregate,
		counts,
		context,
		sessions,
		instancesByPid: Object.fromEntries(instances.map((i) => [i.process.pid, i])),
		instances,
	};
}
