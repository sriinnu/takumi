# CLAUDE.md — Takumi Project Rules for AI Agents

This file governs how AI coding agents (Claude, Copilot, Codex, Gemini, etc.) must behave when working in this repository.

---

## Commit Hygiene

**Never add `Co-Authored-By:` or `Co-authored-by:` trailers to commit messages.**

Commits in this repo must be authored solely by the developer. Do not append AI attribution footers of any kind. This includes:

```
# FORBIDDEN — never add these
Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
Co-authored-by: GitHub Copilot <copilot@github.com>
```

If you have added these in the past, they can be removed with:

```bash
git filter-branch -f --msg-filter \
  'grep -v "^Co-[Aa]uthored-[Bb]y:"' main..HEAD
git push --force-with-lease origin <branch>
```

---

## General Coding Rules

- Follow conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`
- Keep commit subject lines under 72 characters
- TypeScript strict mode is enforced — no `any` without justification
- All packages must pass `tsc --noEmit` before committing
- Run `pnpm check` (Biome lint + LOC guard) before pushing
- Node.js >= 22 required

---

## Repository Layout

See `AGENTS.md` for full layout, build commands, and coding conventions.
