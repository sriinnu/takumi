# Takumi — AI Coding Agent TUI

Terminal UI for AI coding agents with reactive rendering, double-buffered
output, and multi-provider agent orchestration.

## Repository Layout

```
takumi/
├── bin/cli/          # CLI entry-point, auth, provider wiring
├── packages/
│   ├── core/         # Config, types, constants, logger, sessions
│   ├── render/       # Reactive TUI renderer (yoga layout, ANSI, signals)
│   ├── bridge/       # Git helpers, MCP client, telemetry (chitragupta/darpana)
│   ├── agent/        # LLM loop, tools, providers, cluster orchestration
│   └── tui/          # App shell, panels, dialogs, keybinds, commands
├── scripts/          # guard-loc.mjs (LOC guardrail)
└── soul/             # Agent identity / personality / preferences
```

Package dependency order: `core → render → bridge → agent → tui`.

## Build & Test

| Command               | What it does                               |
|-----------------------|--------------------------------------------|
| `pnpm build`          | Build all packages (tsc per-package)       |
| `pnpm test`           | Run all tests via Vitest                   |
| `pnpm test:watch`     | Watch mode                                 |
| `pnpm check`          | LOC guard + Biome lint/format              |
| `pnpm clean`          | Remove dist/ in each package               |
| `pnpm fresh`          | Nuke node_modules, reinstall, rebuild      |
| `pnpm takumi`         | Run the CLI via tsx                        |

Run a single test file: `pnpm test -- packages/agent/test/loop.test.ts`

## Key Rules

### Collaboration Expectations
- Give honest, corrective guidance when a proposed idea risks making the system worse, more complex, or less coherent.
- Do not assume the developer's first idea is automatically the right one; challenge it respectfully when the evidence points elsewhere.
- Optimize for improving and preserving the system, not for agreeing quickly or following trends from posts without scrutiny.
- Prefer advice that increases clarity, maintainability, observability, and product value over changes that add novelty without payoff.

### File Size
No production source file may exceed **450 lines** (`scripts/guard-loc.mjs`).
Test files are exempt. If a file approaches the limit, split it.

### Line Endings
All text files use **LF** (enforced by `.gitattributes` and Biome
`lineEnding: "lf"`). Never commit CRLF.

### Formatting & Linting
- **Biome** for formatting and linting (see `biome.json`)
- Indent with **tabs**, line width **120**
- Run `pnpm check` before committing (also enforced by pre-commit hook)

### Module System
- ESM only (`"type": "module"` in all package.json files)
- TypeScript with `"module": "NodeNext"`, target ES2024
- Relative imports **must** use `.js` extension (e.g., `import { foo } from "./bar.js"`)

### Naming Conventions
- Files: `kebab-case.ts`
- Types/interfaces: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`

### Testing
- Test framework: **Vitest** with globals enabled
- Test files: `packages/*/test/*.test.ts`
- Aliases resolve `@takumi/*` to source (no build needed for tests)
- Prefer `vi.fn()` for mocks, avoid deep mocking

### Pre-Commit Hook
The `.husky/pre-commit` hook runs:
1. `lint-staged` (Biome check on staged .ts/.tsx files)
2. `tsc --noEmit` for all 5 packages in dependency order

### Dependencies
- `bin/` imports `@takumi/core`, `@takumi/agent`, `@takumi/tui` directly
- `@takumi/bridge` and `@takumi/render` are transitive
- Node.js >= 22 required

### Commit Messages
Follow conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`.
Keep the first line under 72 characters.

**Never include `Co-Authored-By:` or `Co-authored-by:` trailers in any commit message.** Commits must be authored solely by the developer. If an AI tool adds these automatically, strip them before pushing (use `git filter-branch` or `git rebase -i` to rewrite).
