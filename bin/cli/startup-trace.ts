export interface StartupTracePhase {
	name: string;
	durationMs: number;
}

export interface StartupTraceSnapshot {
	totalMs: number;
	phases: StartupTracePhase[];
}

/**
 * I keep startup profiling cheap and opt-in so the CLI can expose real phase
 * costs without adding another always-on runtime tax.
 */
export class StartupTrace {
	private readonly startedAt = performance.now();
	private readonly phases: StartupTracePhase[] = [];

	constructor(private readonly enabled: boolean) {}

	get isEnabled(): boolean {
		return this.enabled;
	}

	/**
	 * I measure one named startup phase and preserve call order so the resulting
	 * trace reads like the real CLI boot path.
	 */
	async measure<T>(name: string, work: () => Promise<T> | T): Promise<T> {
		if (!this.enabled) {
			return await work();
		}
		const startedAt = performance.now();
		const result = await work();
		this.phases.push({
			name,
			durationMs: roundDuration(performance.now() - startedAt),
		});
		return result;
	}

	/** I snapshot the accumulated timings once callers are ready to surface them. */
	snapshot(): StartupTraceSnapshot | null {
		if (!this.enabled) return null;
		return {
			totalMs: roundDuration(performance.now() - this.startedAt),
			phases: [...this.phases],
		};
	}

	/** I format compact operator-facing lines for TUI and stderr startup traces. */
	formatLines(title = "Startup trace"): string[] {
		const snapshot = this.snapshot();
		if (!snapshot) return [];
		return [
			`${title}: ${snapshot.totalMs}ms total`,
			...snapshot.phases.map((phase) => `  ${phase.name}: ${phase.durationMs}ms`),
		];
	}
}

/** I enable startup tracing from either the CLI flag or an environment knob. */
export function shouldTraceStartup(flagEnabled = false): boolean {
	return flagEnabled || process.env.TAKUMI_STARTUP_TRACE === "1";
}

function roundDuration(value: number): number {
	return Math.round(value * 10) / 10;
}
