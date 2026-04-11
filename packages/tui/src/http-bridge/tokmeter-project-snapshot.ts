import { basename } from "node:path";
import type {
	DailyEntry,
	ModelSummary,
	ProviderSummary,
	TokmeterCore as TokmeterCoreClass,
} from "@sriinnu/tokmeter-core";

const DEFAULT_CACHE_TTL_MS = 30_000;
const MAX_TOP_MODELS = 3;
const MAX_TOP_PROVIDERS = 3;
const MAX_RECENT_DAILY = 7;
const DAY_MS = 86_400_000;

type TokmeterCoreLike = Pick<
	TokmeterCoreClass,
	"scan" | "getAllProjects" | "getModelCosts" | "getProviderBreakdown" | "getDailyBreakdown" | "getStats"
>;

type TokmeterCoreFactory = () => Promise<TokmeterCoreLike>;

export interface TokmeterProjectSnapshotData {
	/** Source identifier so operator surfaces can explain the telemetry origin. */
	source: "tokmeter-core";
	/** Project substring used when scanning tokmeter history. */
	projectQuery: string;
	/** Epoch ms when this tokmeter snapshot was refreshed. */
	refreshedAt: number;
	/** Distinct tokmeter project buckets that matched the project query. */
	matchedProjects: string[];
	/** Aggregated token count across matched records. */
	totalTokens: number;
	/** Aggregated spend across matched records. */
	totalCostUsd: number;
	/** Tokens recorded today for the matched records. */
	todayTokens: number;
	/** Spend recorded today for the matched records. */
	todayCostUsd: number;
	/** Number of active days represented by the matched records. */
	activeDays: number;
	/** Total token usage records matched by the current project query. */
	totalRecords: number;
	/** Highest-cost models in the matched project set. */
	topModels: Array<{
		model: string;
		provider: string;
		totalTokens: number;
		costUsd: number;
		percentageOfTotal: number;
	}>;
	/** Highest-cost providers in the matched project set. */
	topProviders: Array<{
		provider: string;
		totalTokens: number;
		costUsd: number;
		percentageOfTotal: number;
	}>;
	/** Recent daily cost/token samples for spark charts. */
	recentDaily: Array<{
		date: string;
		totalTokens: number;
		costUsd: number;
	}>;
	/** Optional note describing empty or degraded tokmeter data. */
	note: string | null;
}

export interface TokmeterProjectTrackerOptions {
	/** Project root used to derive the tokmeter project query. */
	projectRoot?: string;
	/** Cache time-to-live for expensive tokmeter scans. */
	cacheTtlMs?: number;
	/** Test seam for injecting a fake tokmeter core instance. */
	createCore?: TokmeterCoreFactory;
	/** Clock seam used by tests and snapshot freshness checks. */
	now?: () => number;
}

/**
 * TokmeterProjectTracker keeps a lightweight cached project summary for the
 * Build Window so desktop polling does not rescan all session logs on every
 * state request.
 */
export class TokmeterProjectTracker {
	private readonly projectQuery: string;
	private readonly cacheTtlMs: number;
	private readonly createCore: TokmeterCoreFactory;
	private readonly now: () => number;
	private cachedSnapshot: TokmeterProjectSnapshotData | null = null;
	private cachedAt = 0;
	private inFlight: Promise<TokmeterProjectSnapshotData> | null = null;

	constructor(options: TokmeterProjectTrackerOptions = {}) {
		const projectRoot = options.projectRoot ?? process.cwd();
		this.projectQuery = resolveProjectQuery(projectRoot);
		this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
		this.createCore = options.createCore ?? defaultCreateTokmeterCore;
		this.now = options.now ?? Date.now;
	}

	/**
	 * Return a cached tokmeter snapshot when it is still fresh, otherwise build
	 * a new one and memoize the result for subsequent bridge polls.
	 */
	async getSnapshot(): Promise<TokmeterProjectSnapshotData> {
		const now = this.now();
		if (this.cachedSnapshot && now - this.cachedAt < this.cacheTtlMs) {
			return this.cachedSnapshot;
		}
		if (this.inFlight) {
			return this.inFlight;
		}
		this.inFlight = this.refreshSnapshot();
		try {
			const snapshot = await this.inFlight;
			this.cachedSnapshot = snapshot;
			this.cachedAt = this.now();
			return snapshot;
		} finally {
			this.inFlight = null;
		}
	}

	private async refreshSnapshot(): Promise<TokmeterProjectSnapshotData> {
		try {
			const core = await this.createCore();
			await core.scan({ project: this.projectQuery });
			return buildTokmeterProjectSnapshot(this.projectQuery, core, this.now());
		} catch (error) {
			return buildTokmeterErrorSnapshot(this.projectQuery, this.now(), error);
		}
	}
}

/** Build a transport-safe tokmeter project snapshot from an initialized core. */
export function buildTokmeterProjectSnapshot(
	projectQuery: string,
	core: TokmeterCoreLike,
	now: number,
): TokmeterProjectSnapshotData {
	const matchedProjects = [
		...new Set(core.getAllProjects().map((project: { project: string }) => project.project)),
	].sort();
	const stats = core.getStats();
	const daily = core.getDailyBreakdown();
	const today = daily.find((entry: DailyEntry) => entry.date === toDateKey(now));

	return {
		source: "tokmeter-core",
		projectQuery,
		refreshedAt: now,
		matchedProjects,
		totalTokens: stats.totalTokens,
		totalCostUsd: stats.totalCost,
		todayTokens: today?.totalTokens ?? 0,
		todayCostUsd: today?.cost ?? 0,
		activeDays: stats.activeDays,
		totalRecords: stats.totalRecords,
		topModels: normalizeTopModels(core.getModelCosts()),
		topProviders: normalizeTopProviders(core.getProviderBreakdown()),
		recentDaily: normalizeRecentDaily(daily, now),
		note: buildSnapshotNote(projectQuery, matchedProjects, stats.totalRecords),
	};
}

function buildTokmeterErrorSnapshot(projectQuery: string, now: number, error: unknown): TokmeterProjectSnapshotData {
	const message = error instanceof Error ? error.message : String(error);
	return {
		source: "tokmeter-core",
		projectQuery,
		refreshedAt: now,
		matchedProjects: [],
		totalTokens: 0,
		totalCostUsd: 0,
		todayTokens: 0,
		todayCostUsd: 0,
		activeDays: 0,
		totalRecords: 0,
		topModels: [],
		topProviders: [],
		recentDaily: buildEmptyDailyWindow(now),
		note: `Tokmeter sync failed: ${message}`,
	};
}

function buildSnapshotNote(projectQuery: string, matchedProjects: string[], totalRecords: number): string | null {
	if (totalRecords === 0) {
		return `No tokmeter history matched “${projectQuery}” yet.`;
	}
	if (matchedProjects.length > 1) {
		return `Combined ${matchedProjects.length} matching tokmeter project buckets.`;
	}
	return null;
}

function normalizeTopModels(models: ModelSummary[]): TokmeterProjectSnapshotData["topModels"] {
	return models.slice(0, MAX_TOP_MODELS).map((model) => ({
		model: model.model,
		provider: model.provider,
		totalTokens: model.totalTokens,
		costUsd: model.cost,
		percentageOfTotal: model.percentageOfTotal,
	}));
}

function normalizeTopProviders(providers: ProviderSummary[]): TokmeterProjectSnapshotData["topProviders"] {
	return providers.slice(0, MAX_TOP_PROVIDERS).map((provider) => ({
		provider: provider.provider,
		totalTokens: provider.totalTokens,
		costUsd: provider.cost,
		percentageOfTotal: provider.percentageOfTotal,
	}));
}

function normalizeRecentDaily(daily: DailyEntry[], now: number): TokmeterProjectSnapshotData["recentDaily"] {
	if (daily.length === 0) {
		return buildEmptyDailyWindow(now);
	}
	return daily.slice(-MAX_RECENT_DAILY).map((entry) => ({
		date: entry.date,
		totalTokens: entry.totalTokens,
		costUsd: entry.cost,
	}));
}

function buildEmptyDailyWindow(now: number): TokmeterProjectSnapshotData["recentDaily"] {
	const entries: TokmeterProjectSnapshotData["recentDaily"] = [];
	for (let offset = MAX_RECENT_DAILY - 1; offset >= 0; offset--) {
		entries.push({
			date: toDateKey(now - offset * DAY_MS),
			totalTokens: 0,
			costUsd: 0,
		});
	}
	return entries;
}

function resolveProjectQuery(projectRoot: string): string {
	const name = basename(projectRoot).trim();
	return name || projectRoot;
}

function toDateKey(timestamp: number): string {
	return new Date(timestamp).toISOString().slice(0, 10);
}

async function defaultCreateTokmeterCore(): Promise<TokmeterCoreLike> {
	const { TokmeterCore } = await import("@sriinnu/tokmeter-core");
	return new TokmeterCore();
}
