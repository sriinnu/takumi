# Agent Catalog

This folder is the **canonical source of truth** for Takumi's custom-agent
definitions and role catalog.

It exists so the suite is easier to extend without forcing every discovery,
planning, and comparison note into `.github/agents/`.

## Important rule

The editor/runtime still discovers workspace custom agents from:

- `.github/agents/*.agent.md`

But those files are now treated as a **generated mirror**.

The canonical definitions live in:

- `agents/orchestration/*.agent.md`
- `agents/specialists/*.agent.md`

If `.github/` disappears, you can regenerate the active mirror from this folder.

## What lives here

- `orchestration/` — canonical council, mesh, persistence, and topology agent
   definitions
- `specialists/` — canonical implementation and review agent definitions
- `role-matrix.md` — explicit mapping of role → active agent file → Takumi
  runtime concept → upstream OMC source

## Maintenance workflow

When adding or changing an agent:

1. Decide whether it is:
   - an **active custom agent**,
   - a **runtime concept**,
   - or a **future candidate** only.
2. Update `role-matrix.md` first so the truth stays centralized.
3. Add or update the canonical source file in `orchestration/` or
   `specialists/`.
4. Run `node scripts/sync-custom-agents.mjs` to regenerate `.github/agents/`.
5. If a role becomes runtime-native, point the matrix at the actual code/docs
   seam rather than pretending markdown equals implementation.

## Quick links

- `./orchestration/README.md`
- `./specialists/README.md`
- `./role-matrix.md`