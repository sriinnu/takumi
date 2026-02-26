# Blind Validation Pattern

Takumi validators are deliberately **blind** — they receive only the task
description and the final output, never the worker's intermediate reasoning or
conversation history.  This prevents anchoring bias and forces independent
quality assessment.

## Why Blind?

| Without blind validation | With blind validation |
|---|---|
| Validator sees worker's chain-of-thought → anchors on it | Validator forms independent judgement |
| "Looks reasonable" bias | Must verify claims from scratch |
| Single point of failure in reasoning | True redundancy |

## Validator Pipeline

```
Task description + Work product
        │
        ▼
  ┌─────────────────────────────────────────┐
  │  Heuristic Pre-filter (AgentEvaluator)  │
  │  Score < 4.0 → auto-REJECT             │
  └─────────────┬───────────────────────────┘
                │ ≥ 4.0
                ▼
  ┌─────────────────────────────────────────┐
  │  N Validators run in parallel           │
  │  Each gets:                             │
  │    • Task description                   │
  │    • Work product summary               │
  │    • Role-specific system prompt        │
  │  Each returns:                          │
  │    • APPROVE / REJECT / NEEDS_REVISION  │
  │    • Confidence (0–1)                   │
  │    • Findings list                      │
  └─────────────┬───────────────────────────┘
                │
                ▼
        Aggregation Strategy
```

## Aggregation Strategies

### Simple Majority (default)

Each validator casts a vote. Decision = most common vote.  Ties break toward
REJECT (fail-safe).

### Weighted Majority (`weighted-voting.ts`)

Votes are weighted by validator **confidence** (0–1).  Confidence is derived
from the `AgentEvaluator` which scores the validator's own response for
correctness, completeness, relevance, clarity, and efficiency.

```typescript
import { weightedMajority, type ValidatorVote } from "./weighted-voting.js";

const votes: ValidatorVote[] = [
  { decision: ValidationDecision.APPROVE, confidence: 0.92, validatorId: "req" },
  { decision: ValidationDecision.REJECT,  confidence: 0.45, validatorId: "code" },
  { decision: ValidationDecision.APPROVE, confidence: 0.88, validatorId: "sec" },
];

const result = weightedMajority(votes);
// result.decision = APPROVE (weighted sum favors approval)
```

### Mixture-of-Agents (`mixture-of-agents.ts`)

Multi-round consensus inspired by arXiv:2406.04692:

1. **Round 1** — Independent blind validation (standard).
2. **Round 2** — Each validator refines their assessment after seeing
   anonymised Round 1 outputs (cross-talk).
3. **Round 3** — Final aggregated decision.

Enable via `orchestration.moA.enabled = true`.  The number of rounds and
consensus threshold are configurable.

## `calculateConfidence()`

The confidence score for each validator is computed by `AgentEvaluator`:

```typescript
const evaluation = evaluator.evaluate(
  "validator",          // role
  clusterId,            // context id
  taskDescription,      // what was asked
  validatorResponse,    // what the validator said
);
// evaluation.overallScore is normalised to 0–1 → confidence
```

Short or empty responses are penalised (0.7× multiplier) to prevent
rubber-stamp approvals.

## Validation Results

Each `ValidationResult` contains:

```typescript
interface ValidationResult {
  validatorId: string;
  validatorRole: AgentRole;
  decision: ValidationDecision;   // APPROVE | REJECT | NEEDS_REVISION
  confidence: number;             // 0–1
  findings: string[];             // Specific issues found
  timestamp: number;
}
```

Results accumulate in `ClusterState.validationResults` across retry attempts.

## Rejection → Fix Loop

When validators reject:

1. Findings are collected from all rejecting validators.
2. If reflexion is enabled, a self-critique is generated and stored in Akasha.
3. Past critiques (if any) are injected into the worker's retry prompt.
4. The worker produces a revised output.
5. Validation re-runs (up to `maxRetries`).

See [ORCHESTRATION.md](ORCHESTRATION.md) for the full phase flow.
