<p align="center">
  <img src="https://raw.githubusercontent.com/sriinnu/takumi/main/docs/logo.svg" alt="Takumi logo" width="200" />
</p>

<h1 align="center">Takumi (匠)</h1>

<p align="center">
  <strong>Terminal-native AI coding agent with a custom renderer, multi-agent orchestration, and deep Chitragupta integration.</strong>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/sriinnu/takumi/main/docs/badge.svg" alt="takumi badge" />
</p>

<p align="center">
  <a href="#what-is-live-today">What is live today</a> &bull;
  <a href="#quickstart">Quickstart</a> &bull;
  <a href="#runtime-modes">Runtime modes</a> &bull;
  <a href="#commands-and-keys">Commands and keys</a> &bull;
  <a href="#docs-map">Docs map</a> &bull;
  <a href="#development">Development</a>
</p>

---

## What is live today

Takumi is a TypeScript monorepo for a terminal coding agent with:

- a custom renderer (`@takumi/render`) instead of React/Ink
- a streaming agent loop and built-in tool runtime (`@takumi/agent`)
- Chitragupta bridge integration for memory, predictions, routing, and health (`@takumi/bridge`)
- a full-screen terminal UI (`@takumi/tui`)
- operational CLI surfaces for sessions, jobs, daemon health, platform checks, and packages

### Truth-first note

This README describes what is implemented on `main` today.

- **Current reality:** Takumi already supports direct providers, optional Darpana proxying, and daemon-first Chitragupta integration.
- **Architecture direction:** some docs describe a stronger future control-plane model where Chitragupta owns more routing/auth authority than it does today.

When a doc is aspirational, it should be read as design direction, not as a claim that the migration is fully complete.

## Highlights

- **Custom renderer** with Yoga layout, reactive signals, double-buffered ANSI output, and diff-based screen updates
- **Streaming coding agent** with read/write/edit/bash/glob/grep plus higher-level orchestration tools
- **Multi-agent orchestration** with planner/worker/validator roles, blind validation, checkpointing, and mesh policy
- **Operational CLI** with `doctor`, `platform`, `daemon`, `jobs`, `watch`, `attach`, `stop`, and package management commands
- **Live runtime switching** so you can change provider and model after launch with `/provider` and `/model`
- **Takumi packages** discovered from `.takumi/packages`, global package roots, and configured paths
- **Chitragupta integration** for session tracking, observations, predictions, routing decisions, and integrity signals
- **Scarlett integrity surface** in the TUI status bar and diagnostic commands

### At a glance

| Area | Current reality on `main` |
|---|---|
| UI stack | custom terminal renderer, not React/Ink |
| model access | direct providers, optional Darpana proxy, daemon-first bridge path, and in-app provider/model switching |
| execution style | single-agent and multi-agent coding flows |
| extensibility | packages, slash commands, prompt/config surfaces |
| docs stance | tries to separate shipped behavior from target direction |

## Why Takumi

Choose Takumi if you want a coding agent that is:

- **terminal-native** rather than a web app wrapped in a shell
- **renderer-first** with its own UI stack instead of React/Ink
- **orchestration-aware** for planner / worker / validator flows on harder tasks
- **truthful about runtime reality**: direct providers, optional proxying, and daemon-first bridge mode all exist today
- **extensible** through packages, prompt assets, command surfaces, and control-plane integrations

### Good fit

Takumi is a strong fit when you want to:

- work mostly from the terminal
- inspect and edit real files with explicit tool/runtime visibility
- use multi-agent validation on non-trivial coding tasks
- keep a path open for Chitragupta-backed memory and control-plane features

If you mainly want a browser-first chat product, Takumi is probably not the cozy couch. It is much more workshop than lounge.

## Quickstart

### Prerequisites

- Node.js 22+
- one of:
  - a supported authenticated CLI (`claude`, `gh`, `gcloud`, `codex`)
  - a provider API key
  - a local Ollama instance

### Install

```bash
npm install -g takumi
takumi --help
```

### Run from source

```bash
git clone https://github.com/sriinnu/takumi.git
cd takumi
pnpm install
pnpm build
pnpm takumi
```

### Common startup paths

```bash
# zero-config when a supported CLI is already authenticated
takumi

# direct provider key
ANTHROPIC_API_KEY=sk-ant-... takumi

# GitHub Models via gh auth
gh auth login
takumi --provider github

# Ollama local runtime
takumi --provider ollama

# one-shot stdout mode
takumi --print "summarize this repository"

# headless automation / IPC mode
takumi exec --headless --stream=ndjson "fix the login bug"
```

### Simple `.env` setup

Takumi reads provider credentials from normal shell env vars and from `.env` files.

Lookup order is:

1. shell environment
2. project `.env`
3. `.takumi/.env`
4. `~/.takumi/.env`
5. `~/.config/takumi/.env`

Recommended pattern when you keep more than one provider key around:

```bash
TAKUMI_PROVIDER=anthropic
TAKUMI_MODEL=claude-sonnet-4-20250514
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
XAI_API_KEY=...
ZAI_API_KEY=...
```

Recognized provider env vars include:

- `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`
- `OPENAI_API_KEY`
- `GITHUB_TOKEN`
- `GEMINI_API_KEY`, `GOOGLE_API_KEY`
- `GROQ_API_KEY`
- `XAI_API_KEY`, `GROK_API_KEY`
- `DEEPSEEK_API_KEY`
- `MISTRAL_API_KEY`
- `TOGETHER_API_KEY`
- `OPENROUTER_API_KEY`
- `ALIBABA_API_KEY`, `DASHSCOPE_API_KEY`
- `ZAI_API_KEY`, `KIMI_API_KEY`, `MOONSHOT_API_KEY`
- `BEDROCK_API_KEY`, `AWS_BEARER_TOKEN`

For providers that need a custom compatible endpoint, Takumi also recognizes:

- `TAKUMI_ENDPOINT`
- `XAI_ENDPOINT`, `GROK_ENDPOINT`
- `ALIBABA_ENDPOINT`, `DASHSCOPE_ENDPOINT`
- `ZAI_ENDPOINT`
- `BEDROCK_ENDPOINT`, `AWS_BEDROCK_ENDPOINT`

### Current surface model

Takumi is intentionally **terminal-first**, but it is not terminal-only.

| Surface | Status | What it is |
|---|---|---|
| **Terminal TUI** | ✅ current primary surface | Full-screen coding/runtime UI started with `takumi` |
| **Headless / exec** | ✅ current | Automation / orchestration mode via `takumi exec ...` |
| **Desktop companion** | ⚠️ early | `apps/desktop/` operator shell that can observe and steer a running Takumi instance via the local bridge |

What Takumi does **not** have yet is a fully productized, packaged native **Takumi Build Window** with a stable release/install/update story. That is now part of the accepted productization roadmap.

### Startup matrix

| Launch path | Status today | Notes |
|---|---|---|
| macOS / Linux terminal | ✅ | primary supported mode |
| Ghostty / WezTerm / iTerm / Terminal.app | ✅ | good fit for the terminal-first runtime |
| tmux-hosted session | ✅ | good fit for long-running and side-agent workflows |
| Windows Terminal / PowerShell / CMD | ⚠️ partial | CLI can start, but shell-backed tools should be treated as bash-first and validated against Git Bash / WSL |
| WSL | ⚠️ target support path | intended path for strong Windows support |
| Native packaged desktop app | 🚧 in progress | desktop shell exists, packaging/distribution still needs to be completed |

### Build Window direction

Takumi should follow a **companion-surface architecture**:

- **Takumi terminal runtime** remains the privileged local executor
- **Takumi Build Window** becomes the desktop/operator shell for visibility, approvals, artifacts, and steering
- **Headless / bridge mode** supports automation and remote control

This means the Build Window should not replace the terminal runtime; it should attach to it, supervise it, and make it easier to operate across Ghostty, tmux, desktop, and Windows/WSL workflows.

After Takumi is running, you can switch runtimes from inside the app with `/provider` and `/model`.

### First run in 30 seconds

If you just want to verify the app is alive without reading the entire README:

1. install or build Takumi
2. run `takumi --help`
3. launch `takumi`
4. open `/help` inside the TUI
5. try `/code review the README for clarity`

### First useful session

After launch, a practical first session looks like this:

1. use `/provider` or `/model` if you want to switch runtime after login/startup
2. ask a small repo question such as `summarize the package layout`
3. try `/diff` to inspect local changes
4. try `/memory scopes` if Chitragupta is connected
5. try `/code improve the docs map for new users` for an orchestration flow

## Runtime modes

Takumi can talk to models in three practical ways today:

### 1. Direct provider mode

Takumi can construct providers directly for:

- Anthropic
- OpenAI
- Gemini
- GitHub Models
- Groq
- xAI / Grok-compatible endpoints
- DeepSeek
- Mistral
- Together
- OpenRouter
- Alibaba / DashScope-compatible endpoints
- Bedrock-compatible gateway endpoints
- Ollama

### 2. Darpana proxy mode

If you pass `--proxy` or configure `proxyUrl`, Takumi can route requests through Darpana.

```bash
takumi --proxy http://localhost:8082
```

### 3. Chitragupta daemon-first bridge mode

For memory/control-plane features, Takumi now probes the local Chitragupta daemon socket first, performs an authenticated handshake, and falls back to spawning `chitragupta-mcp` over stdio only when the daemon path is unavailable.

That means the current bridge story is:

```text
Takumi → daemon socket (preferred) → stdio MCP fallback
```

The new headless `exec` path uses the same daemon-first bootstrap and emits a
stable NDJSON protocol envelope stream (`takumi.exec.v1`) so external
orchestrators can parse:

- run start
- Chitragupta bootstrap status
- streamed agent events
- final completion or failure

## CLI surface

The current CLI supports:

```text
takumi [prompt...]
takumi --print [prompt...]
takumi exec [prompt...]
takumi list
takumi status <id>
takumi logs <id>
takumi export <id>
takumi delete <id>
takumi jobs
takumi watch [job-id]
takumi attach <job-id>
takumi stop <job-id>
takumi daemon [start|stop|status|restart|logs]
takumi doctor [--json] [--fix]
takumi platform [watch] [--json] [--fix]
takumi package [list|inspect|doctor|scaffold]
```

Useful flags include:

- `--provider <name>`
- `--model <name>`
- `--api-key <key>`
- `--endpoint <url>`
- `--proxy <url>`
- `--headless`
- `--stream <text|ndjson>`
- `--resume <id>`
- `--detach`
- `--issue <url|#n>`
- `--pr`
- `--ship`
- `--json`
- `--fix`

Run `takumi --help` for the canonical live surface.

### Useful day-one commands

| Command | Why you would use it |
|---|---|
| `takumi --help` | confirm installed CLI surface |
| `takumi` | start the full TUI |
| `takumi --print "..."` | run one-shot output without the TUI |
| `takumi exec --headless --stream=ndjson "..."` | drive Takumi from another process with structured events |
| `takumi doctor --json` | inspect environment and runtime readiness |
| `takumi package list` | verify package discovery |

## Commands and keys

### Built-in tools

Takumi currently registers **14 built-in tools** in the agent runtime:

- `read`
- `write`
- `edit`
- `bash`
- `glob`
- `grep`
- `worktree_create`
- `worktree_exec`
- `worktree_merge`
- `worktree_destroy`
- `ast_grep`
- `ast_patch`
- `compose`
- `diff_review`

### Core keybindings

| Key | Action |
|---|---|
| `Ctrl+Q` | Quit |
| `Ctrl+C` | Cancel active run or quit |
| `Ctrl+L` | Clear / invalidate screen |
| `Ctrl+P` or `Ctrl+K` | Command palette |
| `Ctrl+M` | Model picker |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+O` | Session list |
| `Ctrl+Shift+C` | Toggle cluster panel |
| `Ctrl+D` | Quit if the editor is empty |

### Selected slash commands

| Command | Purpose |
|---|---|
| `/help` | Show the live slash command list |
| `/model`, `/provider`, `/theme` | Runtime model/provider/theme controls |
| `/session ...` | Local sessions plus Chitragupta-backed `dates`, `projects`, and `delete` |
| `/fork` | Fork the active session into a new branch |
| `/replay <id>` | Step through a past session turn-by-turn |
| `/memory <query>` / `/memory scopes` | Search memory or inspect available scopes |
| `/code <task>` | Start coding agent flow |
| `/index [--rebuild]` | Index codebase for RAG context |
| `/cluster`, `/validate`, `/checkpoint`, `/resume`, `/isolation` | Multi-agent operations |
| `/budget [amount]` | Show or set session spend limit |
| `/cost`, `/status` | Cost breakdown and session statistics |
| `/tree [path] [depth]` | Print directory tree (filesystem) |
| `/day`, `/vidhi`, `/facts`, `/daemon`, `/turns`, `/predict`, `/patterns` | Chitragupta surfaces |
| `/capabilities`, `/route`, `/healthcaps`, `/integrity` | Control-plane and Scarlett diagnostics |
| `/branch`, `/session-tree`, `/switch`, `/siblings`, `/parent` | Session tree navigation |
| `/steer`, `/interrupt`, `/steerq` | Mid-run steering queue controls |

For the fuller reference, see [`docs/KEYBINDINGS.md`](docs/KEYBINDINGS.md).

## Safety and permissions

Takumi is designed to operate with explicit guardrails:

- sensitive files such as `.env` and credential-like paths are guarded
- command execution flows through permission checks and sandbox rules
- isolation modes can keep risky multi-agent work in a worktree or container
- docs in this repo try to distinguish clearly between **implemented behavior** and **target direction**

## Configuration

Takumi looks for config in:

1. `.takumi/config.json`
2. `takumi.config.json`
3. `~/.takumi/config.json`
4. `~/.config/takumi/config.json`

Example:

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "thinking": false,
  "theme": "default",
  "proxyUrl": "",
  "statusBar": {
    "left": ["model", "mesh", "scarlett"],
    "center": ["status"],
    "right": ["metrics", "keybinds"]
  },
  "packages": [{ "name": "./examples/packages" }],
  "orchestration": {
    "enabled": true,
    "defaultMode": "multi",
    "complexityThreshold": "STANDARD",
    "maxValidationRetries": 3,
    "isolationMode": "worktree",
    "modelRouting": {
      "classifier": "claude-haiku-4-20250514",
      "validators": "claude-haiku-4-20250514",
      "taskTypes": {
        "REVIEW": {
          "worker": "claude-sonnet-4-20250514"
        },
        "RESEARCH": {
          "worker": "claude-sonnet-4-20250514"
        }
      }
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
    }
  }
}
```

The main `model` still sets your default interactive agent, but orchestration can now route cheaper models for the classifier, validators, and task-specific helper agents.

## Architecture summary

```text
Takumi TUI
  ├─ @takumi/render   → custom renderer and signals
  ├─ @takumi/agent    → agent loop, tools, orchestration
  ├─ @takumi/bridge   → Chitragupta and control-plane bridge
  └─ @takumi/core     → config, types, sessions, logger
```

Current high-level integration shape:

```text
Takumi
  ├─ direct providers (supported)
  ├─ Darpana proxy (optional)
  └─ Chitragupta daemon-first bridge (preferred) with stdio MCP fallback
```

For details, see:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/control-plane-spec.md`](docs/control-plane-spec.md)
- [`docs/orchestration.md`](docs/orchestration.md)

## Repository layout

The repo is organized as a small monorepo with clear package boundaries:

| Path | Purpose |
|---|---|
| `bin/` | CLI entrypoints and top-level commands |
| `packages/core` | config, types, sessions, logger, shared primitives |
| `packages/render` | the custom terminal renderer |
| `packages/bridge` | Chitragupta, Darpana, and git-facing bridge code |
| `packages/agent` | agent loop, tools, routing, and orchestration |
| `packages/tui` | the application shell, panels, dialogs, and slash commands |
| `docs/` | user docs, architecture docs, and design notes |
| `examples/packages` | example Takumi packages |

## Packages

Takumi packages are reusable workflow bundles discovered from:

- `.takumi/packages/*`
- `~/.config/takumi/packages/*`
- configured package roots in `takumi.config.json`

The repo includes example packages under [`examples/packages`](examples/packages):

- `@takumi/counterfactual-scout`
- `@takumi/invariant-loom`
- `@takumi/negative-space-radar`

See [`docs/packages.md`](docs/packages.md).

## Performance

Takumi is explicitly built for low-latency terminal interaction, but this README avoids hard benchmark claims unless they are backed by repeatable measurement.

See [`docs/PERFORMANCE_INPUT_LATENCY.md`](docs/PERFORMANCE_INPUT_LATENCY.md) for the current analysis and performance intent.

## Docs map

Start here:

- [`docs/README.md`](docs/README.md) — user docs map and status guide
- [`docs/KEYBINDINGS.md`](docs/KEYBINDINGS.md) — current user reference
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — current + target architecture overview
- [`docs/review-packet.md`](docs/review-packet.md) — executive architecture/review packet for serious design discussions
- [`docs/agent-hub-boundary.md`](docs/agent-hub-boundary.md) — who owns the agent hub vs execution vs integrity supervision
- [`docs/takumi-executor-backlog-implementation-note.md`](docs/takumi-executor-backlog-implementation-note.md) — backlog-to-code mapping for the executor retrofit
- [`docs/orchestration.md`](docs/orchestration.md) — cluster and mesh execution model
- [`docs/chitragupta-takumi-exec-handoff.md`](docs/chitragupta-takumi-exec-handoff.md) — parent-side spawn contract for Chitragupta
- [`docs/cli-adapter-contract.md`](docs/cli-adapter-contract.md) — generic contract for delegated CLIs
- [`docs/ui-ux-roadmap.md`](docs/ui-ux-roadmap.md) — where the UX goes beyond today’s terminal-first operator surface
- [`docs/packages.md`](docs/packages.md) — Takumi package lifecycle

## Development

```bash
pnpm build
pnpm test
pnpm check
pnpm takumi
```

Useful package-level commands:

```bash
pnpm --filter @takumi/core build
pnpm --filter @takumi/agent test
pnpm --filter @takumi/tui build
```

## Ecosystem

Takumi is part of the broader Chitragupta / Darpana ecosystem:

| Project | Role |
|---|---|
| [Chitragupta](https://github.com/sriinnu/chitragupta) | memory, sessions, daemon / MCP surfaces |
| [Darpana](https://github.com/sriinnu/chitragupta/tree/main/packages/darpana) | optional LLM proxy |
| Takumi | terminal coding runtime and UI |

## Acknowledgements

Takumi benefits from ideas, patterns, and healthy pressure from the wider agent tooling community, including work around `pi` and related ecosystem experiments.

That said, Takumi's core concepts, architecture, naming, renderer, orchestration model, and product direction are its own. Inspiration is shared; implementation and system design here are original to Takumi.

## License

MIT
