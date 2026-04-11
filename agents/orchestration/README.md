# Orchestration Roles

These roles shape **how** work is coordinated.

## Canonical orchestration agent sources

| Role | Canonical source | Generated mirror |
|------|------------------|------------------|
| `Team` | `agents/orchestration/team.agent.md` | `.github/agents/team.agent.md` |
| `Coordinator` | `agents/orchestration/coordinator.agent.md` | `.github/agents/coordinator.agent.md` |
| `Ralph` | `agents/orchestration/ralph.agent.md` | `.github/agents/ralph.agent.md` |
| `Sabha` | `agents/orchestration/sabha.agent.md` | `.github/agents/sabha.agent.md` |
| `P2P Mesh` | `agents/orchestration/p2p-mesh.agent.md` | `.github/agents/p2p-mesh.agent.md` |
| `Tester` | `agents/orchestration/tester.agent.md` | `.github/agents/tester.agent.md` |
| `Innovator` | `agents/orchestration/innovator.agent.md` | `.github/agents/innovator.agent.md` |

## Runtime reality

These roles are **not all equally runtime-native**.

- `Sabha`, mesh, planner/worker/validator topologies, and executor/reporting
  surfaces have real Takumi architecture backing.
- `Ralph`, `Team`, `Coordinator`, `Tester`, and `Innovator` currently exist
  mainly as custom-agent roles and operating patterns.

Use `../role-matrix.md` for the precise truth per role.

After editing any source file in this folder, run:

`node scripts/sync-custom-agents.mjs`

## When to add a new orchestration role

Add one only if it changes one of these:

- topology choice
- delegation rules
- escalation rules
- persistence / retry semantics
- peer challenge or council behavior

If it mainly changes **what kind of work** gets done, it probably belongs under
`../specialists/` instead.