# Role Matrix

This matrix makes the current state explicit:

- **Canonical source** — the authoring file under `agents/`
- **Generated mirror** — the workspace-discovery file under `.github/agents/`
- **Takumi runtime concept** — whether there is real Takumi code or architecture
  backing the role
- **Upstream OMC source** — where the role exists in the `tmp/oh-my-claudecode-main`
  snapshot

## Active Takumi custom agents

| Role | Canonical source | Generated mirror | Takumi runtime concept | Upstream OMC source | Status |
|------|------------------|------------------|------------------------|---------------------|--------|
| `Team` | `agents/orchestration/team.agent.md` | `.github/agents/team.agent.md` | topology and role-shaping concepts in `docs/orchestration.md` and `packages/agent/src/classifier.ts` | team is an OMC workflow/mode, not a direct agent file | active custom agent; runtime concept is partial |
| `Coordinator` | `agents/orchestration/coordinator.agent.md` | `.github/agents/coordinator.agent.md` | coordinator/orchestrator concept in `docs/orchestration.md` | OMC coordinator is command/orchestration-driven, not an agent file | active custom agent; runtime concept is mostly doc-level |
| `Ralph` | `agents/orchestration/ralph.agent.md` | `.github/agents/ralph.agent.md` | no first-class Takumi runtime mode yet | `tmp/oh-my-claudecode-main/skills/ralph/SKILL.md` | active custom agent only |
| `Sabha` | `agents/orchestration/sabha.agent.md` | `.github/agents/sabha.agent.md` | Sabha command/defaults/outcome recording in `docs/takumi-executor-backlog-implementation-note.md` | no direct OMC agent file | active custom agent + runtime concept |
| `P2P Mesh` | `agents/orchestration/p2p-mesh.agent.md` | `.github/agents/p2p-mesh.agent.md` | bounded mesh architecture in `docs/orchestration.md` and `docs/ARCHITECTURE.md` | no direct OMC agent file | active custom agent + doc/runtime concept |
| `Tester` | `agents/orchestration/tester.agent.md` | `.github/agents/tester.agent.md` | testing and validation pressure exist, but no first-class tester runtime role | nearest OMC neighbors are `agents/test-engineer.md` and `agents/qa-tester.md` | active custom agent; runtime role is indirect |
| `Innovator` | `agents/orchestration/innovator.agent.md` | `.github/agents/innovator.agent.md` | no first-class runtime role yet | no direct OMC agent file | active custom agent only |
| `Planner` | `agents/specialists/planner.agent.md` | `.github/agents/planner.agent.md` | planner role in `packages/agent/src/classifier.ts` and `docs/orchestration.md` | `tmp/oh-my-claudecode-main/agents/planner.md` | active custom agent + runtime concept |
| `Executor` | `agents/specialists/executor.agent.md` | `.github/agents/executor.agent.md` | executor runtime and handoff surfaces in `docs/takumi-executor-backlog-implementation-note.md` | `tmp/oh-my-claudecode-main/agents/executor.md` | active custom agent + runtime concept |
| `Verifier` | `agents/specialists/verifier.agent.md` | `.github/agents/verifier.agent.md` | verifier/validation concepts in `docs/mission-runtime-spec.md` and `docs/orchestration.md` | `tmp/oh-my-claudecode-main/agents/verifier.md` | active custom agent + partial runtime concept |
| `Critic` | `agents/specialists/critic.agent.md` | `.github/agents/critic.agent.md` | critic role appears in mesh architecture docs (`docs/ARCHITECTURE.md`) | `tmp/oh-my-claudecode-main/agents/critic.md` | active custom agent + doc concept |
| `Architect` | `agents/specialists/architect.agent.md` | `.github/agents/architect.agent.md` | architect role appears in `docs/mission-runtime-spec.md`; not a first-class runtime module | `tmp/oh-my-claudecode-main/agents/architect.md` | active custom agent; runtime is mostly conceptual |
| `Debugger` | `agents/specialists/debugger.agent.md` | `.github/agents/debugger.agent.md` | debugger appears only indirectly (for example `docs/packages.md`) rather than as a first-class runtime role | `tmp/oh-my-claudecode-main/agents/debugger.md` | active custom agent; runtime is weak/indirect |
| `Explore` | `agents/specialists/explore.agent.md` | `.github/agents/explore.agent.md` | no first-class Takumi runtime role yet | `tmp/oh-my-claudecode-main/agents/explore.md` | active custom agent only |

## Upstream OMC specialist roles not yet active in Takumi

| Role | Canonical source | Generated mirror | Takumi runtime concept | Upstream OMC source | Status |
|------|------------------|------------------|------------------------|---------------------|--------|
| `Analyst` | — | — | no first-class Takumi runtime role yet | `tmp/oh-my-claudecode-main/agents/analyst.md` | upstream only |
| `Code Reviewer` | — | — | review prompts exist (for example `packages/tui/src/yagna/yagna-phase-verify.ts`), but no standalone Takumi role | `tmp/oh-my-claudecode-main/agents/code-reviewer.md` | upstream only |
| `Security Reviewer` | — | — | security validator concepts exist in `docs/orchestration.md`, but no standalone custom agent yet | `tmp/oh-my-claudecode-main/agents/security-reviewer.md` | upstream only |
| `Document Specialist` | — | — | no first-class Takumi runtime role yet | `tmp/oh-my-claudecode-main/agents/document-specialist.md` | upstream only |
| `Designer` | — | — | no first-class Takumi runtime role yet | `tmp/oh-my-claudecode-main/agents/designer.md` | upstream only |
| `Writer` | — | — | no first-class Takumi runtime role yet | `tmp/oh-my-claudecode-main/agents/writer.md` | upstream only |
| `Scientist` | — | — | no first-class Takumi runtime role yet | `tmp/oh-my-claudecode-main/agents/scientist.md` | upstream only |
| `Git Master` | — | — | no first-class Takumi runtime role yet | `tmp/oh-my-claudecode-main/agents/git-master.md` | upstream only |
| `Code Simplifier` | — | — | no first-class Takumi runtime role yet | `tmp/oh-my-claudecode-main/agents/code-simplifier.md` | upstream only |
| `QA Tester` | — | — | testing and verification surfaces exist, but no standalone Takumi custom agent yet | `tmp/oh-my-claudecode-main/agents/qa-tester.md` | upstream only |

## Reading the matrix correctly

- `canonical source` means the authoring file lives under `agents/`
- `generated mirror` means the invocable copy lives under `.github/agents/`
- `runtime concept` means the repo has real code or architecture seams for the
  role
- `upstream only` means the idea exists in the OMC snapshot but is not yet an
  active Takumi custom agent