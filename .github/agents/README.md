# Takumi Agent Suite

Reusable custom agents for coding, review, orchestration, and high-risk
decision work.

> Maintainer note: `.github/agents/` is now the **generated mirror** required
> for workspace discovery. The **canonical source** lives under `/agents/`.
> If `.github/` gets deleted, regenerate the mirror with:
>
> `node scripts/sync-custom-agents.mjs`
>
> Edit the source files in `/agents/`, not the mirrored copies here.

These agents are tuned for this repo's working style:

- respect `AGENTS.md` rules
- keep production files under the 450 LOC guardrail
- prefer small, testable changes
- separate builders from checkers when risk is high
- use mesh or Sabha-style review only when the task actually deserves it

## Orchestration and council agents

| Agent | Use when | Strength |
|-------|----------|----------|
| `Team` | you need a full role plan before execution | designs the smallest effective squad |
| `Coordinator` | several workstreams or subagents need alignment | keeps scope, order, and handoffs clean |
| `Ralph` | the task must keep going until verified done | persistence with verify/fix loops |
| `Sabha` | the decision is risky, architectural, or contentious | structured council with dissent and consensus |
| `P2P Mesh` | the task benefits from bounded peer challenge | cross-checks assumptions across peers |
| `Tester` | you need focused regression coverage or test authoring | turns risk into executable tests |
| `Innovator` | you want stronger options or simplification | explores bolder paths without losing rigor |

## Specialist implementation agents

These are closer to the `oh-my-claudecode` specialist layer.

| Agent | Use when | Strength |
|-------|----------|----------|
| `Planner` | you need an actionable plan before coding | turns vague requests into 3-6 concrete steps |
| `Executor` | a scoped change is ready to implement | makes the smallest viable diff and verifies it |
| `Verifier` | completion claims need fresh proof | separate approval lane with evidence |
| `Critic` | plans or changes need hard-nosed challenge | finds missing assumptions and weak reasoning |
| `Architect` | a root cause or design trade-off needs evidence | read-only structural analysis with file references |
| `Debugger` | a bug or build failure needs root-cause isolation | minimal fix thinking instead of thrash |
| `Explore` | you need to find code fast | broad-to-narrow codebase search and relationships |

## Notes

- `Ralph` is aligned to the `oh-my-claudecode` persistence idea: keep going
  until the task is actually verified complete.
- `Planner`, `Executor`, `Verifier`, `Critic`, `Architect`, `Debugger`, and
  `Explore` are the OMC-inspired specialist layer.
- `Sabha` and `P2P Mesh` follow the orchestration vocabulary already used in
  `docs/orchestration.md`.
- `Team` is for choosing the right topology.
- `Coordinator` is orchestration-first: it should delegate, sequence, and
  verify, not quietly turn into an implementation worker.
- `Tester` writes or strengthens tests. `Verifier` is the separate approval
  pass that checks evidence.

## Good starting points

- Ask `Team` to shape a multi-agent plan for a feature or refactor.
- Ask `Coordinator` to stabilize a messy effort with multiple dependencies.
- Ask `Ralph` when you need persistence, verify/fix loops, and no silent
  partial completion.
- Ask `Sabha` before making an irreversible architecture choice.
- Ask `P2P Mesh` when you need bounded adversarial pressure during design.
- Ask `Tester` to reproduce, lock, and verify a bug fix.
- Ask `Innovator` to propose higher-leverage options before implementation.
- Ask `Planner` to turn a request into an executor-ready work plan.
- Ask `Executor` for the smallest correct implementation diff.
- Ask `Verifier` for a separate evidence-based completion check.
- Ask `Critic` to pressure-test a plan or a patch before approval.
- Ask `Architect` for read-only root-cause or design analysis.
- Ask `Debugger` when the fastest path is root-cause isolation and a minimal
  fix.
- Ask `Explore` when you first need to know where the code actually lives.

## Suggested pairing patterns

- `Team` → `Coordinator` → `Tester`
- `Team` → `Planner` → `Executor` → `Verifier`
- `Innovator` → `Sabha` → `Coordinator`
- `Ralph` → `Tester`
- `Ralph` → `Executor` → `Verifier`
- `Coordinator` → `Debugger` → `Verifier`
- `Sabha` → `Architect` → `Critic`
- `P2P Mesh` → `Sabha`

If you want to extend the suite later, keep each agent sharply scoped. A good
agent is a scalpel, not a Swiss Army chainsaw.