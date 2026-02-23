/**
 * Task Complexity Classifier
 *
 * Analyzes task descriptions and determines appropriate agent topology.
 * Uses LLM to classify tasks by complexity and type, then maps to agent count.
 */

import type { AgentEvent } from "@takumi/core";
import { createLogger } from "@takumi/core";
import type { AgentSlot, OrchestrationPlan, OrchestratorTask } from "@yugenlab/chitragupta/niyanta";
import { decompose, suggestPlan } from "@yugenlab/chitragupta/niyanta";
import type { MessagePayload } from "./loop.js";
import { inferProvider, type ModelRecommendation, ModelRouter } from "./model-router.js";

const log = createLogger("classifier");

// ── Types ────────────────────────────────────────────────────────────────────

export enum TaskComplexity {
	/** Single file, simple change, low risk */
	TRIVIAL = "TRIVIAL",
	/** Few files, straightforward logic, medium risk */
	SIMPLE = "SIMPLE",
	/** Multiple files, complex logic, high risk */
	STANDARD = "STANDARD",
	/** Critical systems, security-sensitive, very high risk */
	CRITICAL = "CRITICAL",
}

export enum TaskType {
	/** Writing new code or features */
	CODING = "CODING",
	/** Restructuring existing code */
	REFACTOR = "REFACTOR",
	/** Finding and fixing bugs */
	DEBUG = "DEBUG",
	/** Information gathering, analysis */
	RESEARCH = "RESEARCH",
	/** Code review, quality checks */
	REVIEW = "REVIEW",
}

export interface TaskClassification {
	/** Complexity level */
	complexity: TaskComplexity;
	/** Task type */
	type: TaskType;
	/** Estimated number of files affected */
	estimatedFiles: number;
	/** Risk level (0-10) */
	riskLevel: number;
	/** Confidence score (0-1) */
	confidence: number;
	/** Reasoning for classification */
	reasoning: string;
}

export interface AgentTopology {
	/** Total number of agents */
	totalAgents: number;
	/** Number of validator agents */
	validatorCount: number;
	/** Whether to use a dedicated planner agent */
	usePlanner: boolean;
	/** Validation strategy */
	validationStrategy: "none" | "single" | "majority" | "all_approve";
}

// ── Niyanta Integration ───────────────────────────────────────────────────────

/**
 * Extended result of {@link TaskClassifier.classifyAndGetTopology}.
 * Includes niyanta-derived orchestration plan and subtask decomposition.
 */
export interface ClassificationResult {
	/** LLM-powered complexity + type classification. */
	classification: TaskClassification;
	/** Agent topology derived from complexity level. */
	topology: AgentTopology;
	/** Niyanta's recommended coordination plan. */
	plan: OrchestrationPlan;
	/** Subtasks decomposed from the task description. */
	subtasks: OrchestratorTask[];
	/**
	 * Smart model recommendation for the WORKER agent role.
	 * Use `TaskClassifier.router.recommend(complexity, role)` for other roles.
	 */
	recommendedModel: ModelRecommendation;
}

/**
 * Default agent slots exposed to niyanta's `suggestPlan()`.
 * Covers every role Takumi's ClusterOrchestrator supports.
 */
const DEFAULT_SLOTS: AgentSlot[] = [
	{ id: "planner", role: "planner", capabilities: ["planning", "decomposition"] },
	{ id: "worker", role: "worker", capabilities: ["coding", "implementation"] },
	{ id: "reviewer", role: "reviewer", capabilities: ["review", "validation"] },
	{ id: "tester", role: "tester", capabilities: ["testing", "verification"] },
	{ id: "security", role: "security", capabilities: ["security", "audit"] },
];

// ── Complexity → Agent Count Mapping ─────────────────────────────────────────

const TOPOLOGY_MAP: Record<TaskComplexity, AgentTopology> = {
	[TaskComplexity.TRIVIAL]: {
		totalAgents: 1,
		validatorCount: 0,
		usePlanner: false,
		validationStrategy: "none",
	},
	[TaskComplexity.SIMPLE]: {
		totalAgents: 2,
		validatorCount: 1,
		usePlanner: false,
		validationStrategy: "single",
	},
	[TaskComplexity.STANDARD]: {
		totalAgents: 4,
		validatorCount: 2,
		usePlanner: true,
		validationStrategy: "majority",
	},
	[TaskComplexity.CRITICAL]: {
		totalAgents: 7,
		validatorCount: 5,
		usePlanner: true,
		validationStrategy: "all_approve",
	},
};

// ── Classification Prompt ────────────────────────────────────────────────────

const CLASSIFICATION_PROMPT = `You are a task complexity analyzer for a multi-agent coding system.

Analyze the given task description and classify it according to:

1. **Complexity Level:**
   - TRIVIAL: Single file, simple change (e.g., "fix typo", "add console.log")
   - SIMPLE: Few files, straightforward logic (e.g., "add validation", "refactor function")
   - STANDARD: Multiple files, complex logic (e.g., "implement feature", "redesign module")
   - CRITICAL: Critical systems, security-sensitive (e.g., "auth system", "payment flow")

2. **Task Type:**
   - CODING: Writing new code or features
   - REFACTOR: Restructuring existing code
   - DEBUG: Finding and fixing bugs
   - RESEARCH: Information gathering, analysis
   - REVIEW: Code review, quality checks

3. **Risk Assessment:**
   - Estimate number of files affected (1-100+)
   - Risk level (0-10): 0=no risk, 10=catastrophic if wrong
   - Confidence in classification (0-1)

Respond ONLY with valid JSON in this exact format:
{
  "complexity": "TRIVIAL" | "SIMPLE" | "STANDARD" | "CRITICAL",
  "type": "CODING" | "REFACTOR" | "DEBUG" | "RESEARCH" | "REVIEW",
  "estimatedFiles": <number>,
  "riskLevel": <number 0-10>,
  "confidence": <number 0-1>,
  "reasoning": "<brief explanation>"
}`;

// ── Classifier ───────────────────────────────────────────────────────────────

export interface ClassifierOptions {
	/** Function to send messages to LLM */
	sendMessage: (messages: MessagePayload[], system: string) => AsyncIterable<AgentEvent>;
	/**
	 * Current model string (e.g. `"claude-sonnet-4-20250514"`) used to infer
	 * the provider family for smart model routing.  Defaults to Anthropic.
	 */
	currentModel?: string;
}

export class TaskClassifier {
	private sendMessage: ClassifierOptions["sendMessage"];
	/** Smart model router — maps complexity + role → recommended model. */
	readonly router: ModelRouter;

	constructor(options: ClassifierOptions) {
		this.sendMessage = options.sendMessage;
		// Infer provider from the model string so the router picks the right family
		const provider = options.currentModel ? inferProvider(options.currentModel) : "anthropic";
		this.router = new ModelRouter(provider);
	}

	/**
	 * Classify a task description.
	 * Returns classification with confidence score.
	 */
	async classify(description: string): Promise<TaskClassification> {
		log.info(`Classifying task: ${description.slice(0, 100)}...`);

		const messages: MessagePayload[] = [
			{
				role: "user",
				content: [{ type: "text", text: `Task: ${description}` }],
			},
		];

		let responseText = "";

		try {
			const stream = this.sendMessage(messages, CLASSIFICATION_PROMPT);

			for await (const event of stream) {
				if (event.type === "text_delta") {
					responseText += event.text;
				} else if (event.type === "error") {
					throw event.error;
				}
			}

			// Parse JSON response
			const parsed = this.parseClassification(responseText);
			log.info(`Classification result: ${parsed.complexity} (${parsed.confidence})`);
			return parsed;
		} catch (err) {
			log.error("Classification failed", err);
			// Fallback to SIMPLE complexity on error
			return this.fallbackClassification(description);
		}
	}

	/**
	 * Parse LLM response into TaskClassification.
	 * Handles various JSON formats and extracts the data.
	 */
	private parseClassification(text: string): TaskClassification {
		// Try to extract JSON from response (may have markdown code blocks)
		const jsonMatch = text.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			throw new Error("No JSON found in classification response");
		}

		const data = JSON.parse(jsonMatch[0]);

		// Validate required fields
		if (!data.complexity || !data.type) {
			throw new Error("Missing required fields in classification");
		}

		return {
			complexity: data.complexity as TaskComplexity,
			type: data.type as TaskType,
			estimatedFiles: data.estimatedFiles ?? 1,
			riskLevel: data.riskLevel ?? 5,
			confidence: data.confidence ?? 0.5,
			reasoning: data.reasoning ?? "No reasoning provided",
		};
	}

	/**
	 * Fallback classification when LLM fails.
	 * Uses simple heuristics based on keywords.
	 */
	private fallbackClassification(description: string): TaskClassification {
		const lower = description.toLowerCase();

		// Check for critical keywords
		const isCritical =
			lower.includes("auth") ||
			lower.includes("security") ||
			lower.includes("payment") ||
			lower.includes("crypto") ||
			lower.includes("password");

		// Check for simple keywords
		const isTrivial =
			lower.includes("typo") ||
			lower.includes("comment") ||
			lower.includes("log") ||
			lower.includes("rename") ||
			description.length < 50;

		// Determine complexity
		let complexity: TaskComplexity;
		if (isCritical) {
			complexity = TaskComplexity.CRITICAL;
		} else if (isTrivial) {
			complexity = TaskComplexity.TRIVIAL;
		} else {
			complexity = TaskComplexity.SIMPLE;
		}

		// Determine type
		let type: TaskType;
		if (lower.includes("refactor")) {
			type = TaskType.REFACTOR;
		} else if (lower.includes("bug") || lower.includes("fix")) {
			type = TaskType.DEBUG;
		} else if (lower.includes("review")) {
			type = TaskType.REVIEW;
		} else if (lower.includes("research") || lower.includes("analyze")) {
			type = TaskType.RESEARCH;
		} else {
			type = TaskType.CODING;
		}

		log.warn(`Using fallback classification: ${complexity}`);

		return {
			complexity,
			type,
			estimatedFiles: isTrivial ? 1 : 5,
			riskLevel: isCritical ? 9 : isTrivial ? 1 : 5,
			confidence: 0.3, // Low confidence for fallback
			reasoning: "Fallback classification based on keywords",
		};
	}

	/**
	 * Get agent topology for a given complexity level.
	 */
	getTopology(complexity: TaskComplexity): AgentTopology {
		return TOPOLOGY_MAP[complexity];
	}

	/**
	 * Classify the task and get the full orchestration picture in one call.
	 *
	 * Runs LLM classification, niyanta plan suggestion, and subtask
	 * decomposition **in parallel** for minimum latency.
	 *
	 * @param description - Task description to classify.
	 * @returns Enriched result with complexity, topology, niyanta plan, subtasks.
	 */
	async classifyAndGetTopology(description: string): Promise<ClassificationResult> {
		// Run classification + niyanta plan suggestion in parallel to save latency
		const [classification, plan] = await Promise.all([
			this.classify(description),
			Promise.resolve(this.suggestOrchestrationPlan(description)),
		]);
		const topology = this.getTopology(classification.complexity);
		// Decompose synchronously — heuristic only, no LLM call
		const subtasks = this.decomposeTask(description);
		// Get model recommendation for the WORKER role (main execution model)
		const recommendedModel = this.router.recommend(classification.complexity, "WORKER");
		log.debug(
			`Plan strategy: ${plan.strategy}, subtasks: ${subtasks.length}, ` +
				`recommended model: ${recommendedModel.model} (${recommendedModel.tier})`,
		);
		return { classification, topology, plan, subtasks, recommendedModel };
	}

	/**
	 * Decompose a task description into structured sub-tasks using niyanta's
	 * heuristic parser (keyword-based, no LLM call, zero latency).
	 *
	 * @param description - Natural language task description.
	 * @returns Array of {@link OrchestratorTask} with inferred types and dependencies.
	 */
	decomposeTask(description: string): OrchestratorTask[] {
		return decompose(description);
	}

	/**
	 * Suggest an {@link OrchestrationPlan} using niyanta's heuristic planner.
	 * Chooses between round-robin, chain, hierarchical, swarm, or competitive
	 * strategies based on keywords in the task description.
	 *
	 * @param description - Natural language task description.
	 * @returns A complete plan with strategy, routing rules, and coordination config.
	 */
	suggestOrchestrationPlan(description: string): OrchestrationPlan {
		return suggestPlan(description, DEFAULT_SLOTS);
	}
}

// Re-export niyanta types so callers don't need a separate import
export type { OrchestrationPlan, AgentSlot, OrchestratorTask };
