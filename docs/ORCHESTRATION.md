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
    "ensemble": { "enabled": true, "k": 3, "votingMethod": "weighted" },
    "weightedVoting": { "enabled": true, "minConfidence": 0.6 },
    "reflexion": { "enabled": true, "useAkasha": true, "maxReflections": 3 },
    "moA": { "enabled": false, "rounds": 3, "consensusThreshold": 0.7 },
    "progressiveRefinement": { "enabled": true, "maxIterations": 5 },
    "adaptiveTemperature": { "enabled": true }
  }
}
```

## Slash Commands

| Command              | Action                                    |
|----------------------|-------------------------------------------|
| `/cluster`           | Show current cluster status               |
| `/validate`          | Trigger manual validation round           |
| `/retry`             | Retry last rejected validation            |
| `/checkpoint`        | Save checkpoint manually                  |
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
