import type { ChitraguptaBridge } from "@takumi/bridge";
import type { AgentEvent, OrchestrationConfig } from "@takumi/core";
import type { AgentEvaluator } from "@yugenlab/chitragupta/niyanta";
import type { MessagePayload, SendMessageOptions } from "../loop.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { AgentBus } from "./agent-bus.js";
import { runExecutionPhase, runPlanningPhase } from "./phases-execution.js";
import { runFixingPhase } from "./phases-fixing.js";
import { runAgent } from "./phases-run-agent.js";
import { aggregateValidationResults, runValidationPhase, runValidator } from "./phases-validation.js";
import type {
	AgentInstance,
	AgentRole,
	AgentStatus,
	ClusterEvent,
	ClusterPhase,
	ClusterState,
	ValidationDecision,
	ValidationResult,
	WorkProduct,
} from "./types.js";

export interface PhaseContext {
	getState(): ClusterState;
	setPhase(p: ClusterPhase): void;
	updateAgentStatus(id: string, s: AgentStatus, msg?: string): void;
	emitEvent(e: ClusterEvent): void;
	saveCheckpoint(): Promise<void>;
	sendMessage(
		messages: MessagePayload[],
		system: string,
		tools?: unknown[],
		signal?: AbortSignal,
		options?: SendMessageOptions,
	): AsyncIterable<AgentEvent>;
	workDir: string;
	chitraguptaMemory?: string;
	chitragupta?: ChitraguptaBridge;
	getModelForRole?: (role: AgentRole) => string | undefined;
	tools?: ToolRegistry;
	onAgentText?: (agentId: string, delta: string) => void;
	onTokenUsage?: (inputTokens: number, outputTokens: number) => void;
	orchestrationConfig?: OrchestrationConfig;
	/** Shared agent bus — used for heartbeat publishing during agent execution. */
	bus?: AgentBus;
}

export class ClusterPhaseRunner {
	private readonly ctx: PhaseContext;
	private readonly evaluator: AgentEvaluator;

	constructor(ctx: PhaseContext, evaluator: AgentEvaluator) {
		this.ctx = ctx;
		this.evaluator = evaluator;
	}

	async runAgent(
		agent: AgentInstance,
		systemPrompt: string,
		userMessage: string,
		phase: ClusterPhase,
		attemptNumber = 1,
	): Promise<string> {
		return runAgent(
			this.ctx,
			(id, s, msg) => this.ctx.updateAgentStatus(id, s, msg),
			agent,
			systemPrompt,
			userMessage,
			phase,
			attemptNumber,
		);
	}

	async *runPlanningPhase(): AsyncGenerator<ClusterEvent> {
		yield* runPlanningPhase(this.makeDeps());
	}

	async *runExecutionPhase(): AsyncGenerator<ClusterEvent> {
		yield* runExecutionPhase(this.makeDeps());
	}

	async *runValidationPhase(): AsyncGenerator<ClusterEvent> {
		yield* runValidationPhase({
			ctx: this.ctx,
			evaluator: this.evaluator,
			runAgent: this.runAgent.bind(this),
			getAgentsByRolePattern: this.getAgentsByRolePattern.bind(this),
			aggregateValidationResults: this.aggregateValidationResults.bind(this),
		});
	}

	async *runFixingPhase(): AsyncGenerator<ClusterEvent> {
		yield* runFixingPhase(this.makeDeps());
	}

	async runValidator(validator: AgentInstance, workProduct: WorkProduct): Promise<ValidationResult> {
		return runValidator(
			{
				ctx: this.ctx,
				evaluator: this.evaluator,
				runAgent: this.runAgent.bind(this),
				getAgentsByRolePattern: this.getAgentsByRolePattern.bind(this),
				aggregateValidationResults: this.aggregateValidationResults.bind(this),
			},
			validator,
			workProduct,
		);
	}

	aggregateValidationResults(state: ClusterState, results: ValidationResult[]): ValidationDecision {
		return aggregateValidationResults(this.ctx, this.evaluator, state, results);
	}

	private makeDeps() {
		return {
			ctx: this.ctx,
			evaluator: this.evaluator,
			runAgent: this.runAgent.bind(this),
			getAgentByRole: this.getAgentByRole.bind(this),
		};
	}

	private getAgentByRole(state: ClusterState, role: AgentRole): AgentInstance | null {
		return Array.from(state.agents.values()).find((a) => a.role === role) ?? null;
	}

	private getAgentsByRolePattern(state: ClusterState, pattern: RegExp): AgentInstance[] {
		return Array.from(state.agents.values()).filter((a) => pattern.test(a.role));
	}
}
