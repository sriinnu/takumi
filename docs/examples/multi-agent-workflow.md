<p align="center">
  <img src="../logo.svg" alt="Takumi logo" width="140" />
</p>

# multi-agent workflow example

## basic usage

```bash
# Start takumi and use /code for orchestrated coding
pnpm takumi
匠> /code refactor the auth module to use JWT tokens
```

## task classification

Takumi automatically classifies tasks by complexity:

```
"fix a typo in README"          → TRIVIAL  (1 agent, no validation)
"add a helper function"         → SIMPLE   (worker + 1 validator)
"refactor auth to use JWT"      → STANDARD (planner + worker + 2 validators)
"rewrite the payment system"    → CRITICAL (planner + worker + 5 validators)
```

## cluster commands

```
/cluster          — show active cluster status
/validate         — trigger manual validation
/retry            — retry after failed validation
/checkpoint       — save checkpoint manually
/resume <id>      — resume from checkpoint
/isolation worktree — use git worktree isolation
/isolation docker   — use docker container isolation
```

## configuration

Add to `takumi.config.json`:

```json
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
      "maxHistorySize": 3,
      "useAkasha": true
    },
    "moA": {
      "enabled": false,
      "rounds": 2,
      "validatorCount": 3,
      "allowCrossTalk": true,
      "temperatures": [0.2, 0.4]
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
    },
    "adaptiveTemperature": {
      "enabled": true
    }
  }
}
```

## workflow phases

1. **classify** — analyze task complexity and type
2. **plan** — planner agent creates step-by-step plan
3. **execute** — worker agent implements the plan
4. **validate** — blind validators independently review output
5. **fix** — if rejected, worker receives specific feedback and retries
6. **commit** — if all approve, changes are committed

## blind validation pattern

Validators receive ONLY:
- the original task description
- the final file changes (diff)

They do NOT receive:
- the worker's conversation history
- the planner's reasoning
- other validators' opinions (except in MoA mode)

This prevents confirmation bias and ensures independent quality checks.

## checkpoint & resume

Long-running tasks are checkpointed after each phase:

```
~/.takumi/checkpoints/<cluster-id>.json
```

If the process crashes, resume with:

```bash
pnpm takumi
匠> /resume <cluster-id>
```

The orchestrator picks up from the last completed phase.

Related docs:

- [`../orchestration.md`](../orchestration.md)
- [`../validation.md`](../validation.md)
- [`../checkpoints.md`](../checkpoints.md)
