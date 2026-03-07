export interface DockerIsolationConfig {
	image: string;
	mounts: string[];
	envPassthrough: string[];
}

export type MeshTopologyMode =
	| "sequential"
	| "parallel"
	| "hierarchical"
	| "council"
	| "swarm"
	| "adversarial"
	| "healing";

export interface OrchestrationMeshConfig {
	defaultTopology?: MeshTopologyMode;
	lucyAdaptiveTopology?: boolean;
	scarlettAdaptiveTopology?: boolean;
	sabhaEscalation?: {
		enabled: boolean;
		integrityThreshold?: "warning" | "critical";
		minValidationAttempts?: number;
	};
}

export interface OrchestrationConfig {
	enabled: boolean;
	defaultMode: "single" | "multi";
	complexityThreshold: "TRIVIAL" | "SIMPLE" | "STANDARD" | "CRITICAL";
	maxValidationRetries: number;
	isolationMode: "none" | "worktree" | "docker";
	docker?: DockerIsolationConfig;
	ensemble?: {
		enabled: boolean;
		workerCount: number;
		temperature: number;
		parallel: boolean;
	};
	weightedVoting?: {
		minConfidenceThreshold: number;
	};
	reflexion?: {
		enabled: boolean;
		maxHistorySize: number;
		useAkasha: boolean;
	};
	moA?: {
		enabled: boolean;
		rounds: number;
		validatorCount: number;
		allowCrossTalk: boolean;
		temperatures: number[];
	};
	progressiveRefinement?: {
		enabled: boolean;
		maxIterations: number;
		minImprovement: number;
		useCriticModel: boolean;
		targetScore: number;
	};
	adaptiveTemperature?: {
		enabled: boolean;
		baseTemperatures?: {
			TRIVIAL?: number;
			SIMPLE?: number;
			STANDARD?: number;
			CRITICAL?: number;
		};
	};
	mesh?: OrchestrationMeshConfig;
}
