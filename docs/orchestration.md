<p align="center">
  <img src="./logo.svg" alt="Takumi logo" width="160" />
</p>

# Multi-Agent Orchestration Architecture

Takumi's orchestration layer spawns and coordinates multiple LLM agents for a
single task.  A **ClusterOrchestrator** manages the full lifecycle — plan,
execute, validate, fix, done — while a Thompson-sampling bandit (via Niyanta)
learns which strategy works best over time.

## High-Level Flow

```
User prompt
  │
  ▼
TaskComplexityClassifier
  │  classifies → TRIVIAL / SIMPLE / STANDARD / CRITICAL
  ▼
ClusterOrchestrator.spawn(config)
  │  creates AgentInstances (planner, worker, validators)
  │  sets up IsolationContext (none / worktree / docker)
  ▼
ClusterOrchestrator.execute(task)
  │
  ├─ PLANNING   (if planner present)
  ├─ EXECUTING  (worker produces work product)
  ├─ VALIDATING (blind validators score output)
  │    ├─ APPROVE → DONE
  │    └─ REJECT  → FIXING → loop back to VALIDATING
  └─ DONE / FAILED
```

## From cluster to bounded mesh

The current implementation is cluster-oriented, but the architectural direction
should be a **bounded peer mesh**.

That means the orchestrator is not only spawning roles; it is shaping a
topology for how those roles exchange evidence and challenge one another.

### Why mesh, not only hierarchy

A strict hierarchy is simple, but brittle:

- planners can become bottlenecks
- validators arrive too late in the run
- workers can optimize for planner approval rather than actual correctness

A bounded mesh improves this by allowing controlled peer exchange during the
run:

- planner ↔ worker for intent clarification
- worker ↔ validator for early correctness pressure
- validator ↔ validator for adversarial comparison
- specialist ↔ specialist for local evidence sharing

### Topologies

| Topology | Shape | Use when |
|----------|-------|----------|
| hierarchy | planner-centered tree | low ambiguity, cheap tasks |
| council | deliberative peer rounds | architecture and design trade-offs |
| swarm | many parallel workers with weak coupling | exploration and search |
| adversarial mesh | workers under continuous validator pressure | correctness / security-critical tasks |
| healing mesh | peers replaced or isolated dynamically | degraded runs, instability, anomaly recovery |

The orchestrator should eventually choose topology the same way it chooses
strategy: as a policy decision, not a hardcoded shape.

### Mesh invariants

Even in a mesh, four invariants remain:

1. Chitragupta remains the control plane.
2. Mesh coordination is runtime state, not canonical truth.
3. Durable memory only receives promoted conclusions.
4. Integrity signals can override mesh autonomy.

## Key Components

### ClusterOrchestrator (`cluster/orchestrator.ts`)

Central coordinator.  Owns cluster state, isolation context, checkpointing, and
event dispatch.  Key methods:

| Method       | Purpose                                         |
|--------------|-------------------------------------------------|
| `spawn()`    | Create cluster state, agents, isolation sandbox |
| `execute()`  | Run phases as an `AsyncGenerator<ClusterEvent>` |
| `resume()`   | Restore from a persisted checkpoint             |
| `shutdown()` | Persist state and clean up isolation resources  |

### ClusterPhaseRunner (`cluster/phases.ts`)

Delegates actual LLM calls to the four phase modules:

- **phases-execution.ts** — planning + execution, with optional ensemble
  decoding and progressive refinement.
- **phases-validation.ts** — blind validation, optional Mixture-of-Agents
  multi-round consensus, weighted voting aggregation.
- **phases-fixing.ts** — reflexion-based self-critique loop.
- **phases.ts** — glue that wires phase context and temperature injection.

### Agent Roles

Defined in `AgentRole` (cluster/types.ts):

| Role                      | Count (CRITICAL) | Purpose                        |
|---------------------------|------------------|--------------------------------|
| `PLANNER`                 | 1                | Decompose task into steps      |
| `WORKER`                  | 1                | Produce the work product       |
| `VALIDATOR_REQUIREMENTS`  | 1                | Check acceptance criteria      |
| `VALIDATOR_CODE`          | 1                | Check code quality / patterns  |
| `VALIDATOR_SECURITY`      | 1                | Spot security issues           |
| `VALIDATOR_TESTS`         | 1                | Verify test coverage           |
| `VALIDATOR_ADVERSARIAL`   | 1                | Try to break the output        |

Simpler tasks use fewer agents (TRIVIAL=1, SIMPLE=2, STANDARD=4).

## ArXiv Strategies

Six research-backed strategies are integrated and selectable per-run:

| Strategy                | Paper / Inspiration         | Module                       |
|-------------------------|-----------------------------|------------------------------|
| Self-Consistency        | arXiv:2203.11171            | `ensemble.ts`                |
| Weighted Voting         | —                           | `weighted-voting.ts`         |
| Reflexion               | arXiv:2303.11366            | `reflexion.ts`               |
| Mixture-of-Agents       | arXiv:2406.04692            | `mixture-of-agents.ts`       |
| Progressive Refinement  | AlphaCodium / Constitutional AI | `progressive-refinement.ts` |
| Tree-of-Thoughts        | arXiv:2305.10601            | `tot-planner.ts`             |

All strategies are gated behind `OrchestrationConfig` flags and can be
enabled/disabled independently.

## Lucy and Scarlett in orchestration

Multi-agent orchestration should not be thought of as raw parallelism.
Two higher-order concepts govern where Takumi goes next.

### Lucy — cognitive progression

Lucy describes the maturity of orchestration behavior:

| Lucy level | Orchestration meaning |
|------------|------------------------|
| reflex | route events and tools quickly |
| learn | remember which topologies and validator mixes work |
| evolve | generate better strategies, extension packs, or role mixes |
| intuition | predict likely next failures or missing files before they happen |
| self-heal | reconfigure or collapse the mesh when instability rises |

Lucy is what turns orchestration from “many agents” into “cumulative collective reasoning.”

### Scarlett — integrity supervision

Scarlett is the guardrail over orchestration quality:

- detects route degradation
- detects peer instability
- detects repeated-failure loops
- detects anomalous cost or context growth
- escalates weak consensus or compromised runs

In practice, Scarlett should influence orchestration policy by:

- reducing mesh width during degraded operation
- requiring stronger consensus before promotion
- quarantining unstable peers or tools
- escalating to Sabha or human review when trust falls below threshold

### Combined effect

Lucy expands orchestration capability.
Scarlett preserves orchestration trust.

That pair is the real architectural upgrade path for Takumi's future mesh.

## Bandit Strategy Selection

When Chitragupta's Niyanta library is available, a **Thompson-sampling
multi-armed bandit** selects the execution strategy at runtime:

1. `registerStrategies()` registers available arms.
2. `selectStrategy()` picks the best arm given observed task stats.
3. After completion, `recordBanditOutcome()` feeds back success/failure, token
   counts, and latency so future selections improve.

State is persisted to `~/.takumi/bandit-state.json`.

## Configuration

```jsonc
// takumi.config.json (orchestration section)
{
  "orchestration": {
    "enabled": true,
    "defaultMode": "multi",
    "complexityThreshold": "STANDARD",
    "maxValidationRetries": 3,
    "isolationMode": "worktree",
    "ensemble": {
      "enabled": false,
      "workerCount": 3,
      "temperature": 0.7,
      "parallel": true
    },
    "weightedVoting": {
      "minConfidenceThreshold": 0.6
    },
    "reflexion": {
      "enabled": true,
      "useAkasha": true,
      "maxHistorySize": 3
    },
    "moA": {
      "enabled": false,
      "rounds": 2,
      "validatorCount": 3,
      "allowCrossTalk": true,
      "temperatures": [0.2, 0.4]
    },
    "progressiveRefinement": {
      "enabled": false,
      "maxIterations": 3,
      "minImprovement": 0.05,
      "useCriticModel": true,
      "targetScore": 0.9
    },
    "adaptiveTemperature": {
      "enabled": true
    },
    "modelRouting": {
      "classifier": "claude-haiku-4-20250514",
      "validators": "claude-haiku-4-20250514",
      "taskTypes": {
        "REVIEW": {
          "worker": "claude-sonnet-4-20250514"
        },
        "RESEARCH": {
          "worker": "claude-sonnet-4-20250514"
        }
      }
    },
    "mesh": {
      "defaultTopology": "hierarchical",
      "lucyAdaptiveTopology": true,
      "scarlettAdaptiveTopology": true,
      "sabhaEscalation": {
        "enabled": true,
        "integrityThreshold": "critical",
        "minValidationAttempts": 1
      }
    }
  }
}
```

### Model routing notes

- `modelRouting.classifier` lets the task-classification pass run on a cheaper model.
- `modelRouting.validators` can pin all validators to an inexpensive review model.
- `modelRouting.taskTypes.REVIEW` and `modelRouting.taskTypes.RESEARCH` let helper agents stay cheaper than the main interactive model.
- If no override is provided, Takumi now defaults the classifier to the provider's fast tier and automatically downgrades planner/worker models for review-heavy or research-heavy tasks.

## Slash Commands

| Command              | Action                                    |
|----------------------|-------------------------------------------|
| `/cluster`           | Show current cluster status               |
| `/code <task>`       | Start a coding run through the orchestrator |
| `/validate`          | Trigger manual validation round           |
| `/retry`             | Retry last rejected validation            |
| `/checkpoint`        | List or save checkpoints                  |
| `/resume <id>`       | Resume from a saved checkpoint            |
| `/isolation <mode>`  | Switch isolation mode (none/worktree/docker) |

## Events

`ClusterOrchestrator.execute()` yields `ClusterEvent` objects:

- `phase_change` — transition between phases
- `agent_update` — agent status change (idle → working → done)
- `validation_complete` — per-validator result
- `cluster_complete` — terminal success
- `cluster_error` — terminal failure
- `moa_validation_complete` — MoA-specific round data

Wire an event listener via `orchestrator.on(event => { ... })` for TUI updates.
