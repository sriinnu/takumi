# Specialist Roles

These roles shape **what kind of work** gets done.

## Canonical specialist agent sources

| Role | Canonical source | Generated mirror |
|------|------------------|------------------|
| `Planner` | `agents/specialists/planner.agent.md` | `.github/agents/planner.agent.md` |
| `Executor` | `agents/specialists/executor.agent.md` | `.github/agents/executor.agent.md` |
| `Verifier` | `agents/specialists/verifier.agent.md` | `.github/agents/verifier.agent.md` |
| `Critic` | `agents/specialists/critic.agent.md` | `.github/agents/critic.agent.md` |
| `Architect` | `agents/specialists/architect.agent.md` | `.github/agents/architect.agent.md` |
| `Debugger` | `agents/specialists/debugger.agent.md` | `.github/agents/debugger.agent.md` |
| `Explore` | `agents/specialists/explore.agent.md` | `.github/agents/explore.agent.md` |

## Upstream OMC specialist roles not yet active here

These exist in `tmp/oh-my-claudecode-main/agents/` but are not yet active
Takumi custom agents:

- `Analyst`
- `Code Reviewer`
- `Security Reviewer`
- `Document Specialist`
- `Designer`
- `Writer`
- `Scientist`
- `Git Master`
- `Code Simplifier`
- `QA Tester`

## Guidance

- If the role needs to be invocable now, add a `.github/agents/*.agent.md`
  file.
- If the role is only an idea or upstream reference, keep it in the matrix until
  we are ready to activate it.
- Avoid cloning the full OMC roster blindly. Add roles when Takumi has a real
  use for them.

After editing any source file in this folder, run:

`node scripts/sync-custom-agents.mjs`