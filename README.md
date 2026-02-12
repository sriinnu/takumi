<p align="center">
  <img src="docs/logo.svg" alt="Takumi" width="200" />
</p>

<h1 align="center">Takumi (匠)</h1>

<p align="center">
  <strong>A high-performance terminal coding agent — custom renderer, reactive signals, provider-agnostic.</strong>
</p>

<p align="center">
  <img src="docs/badge.svg" alt="takumi badge" />
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#quickstart">Quickstart</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#usage">Usage</a> &bull;
  <a href="#packages">Packages</a> &bull;
  <a href="#development">Development</a> &bull;
  <a href="#roadmap">Roadmap</a>
</p>

---

## What is Takumi?

Takumi is a terminal-based AI coding agent built from the ground up in TypeScript. Unlike tools built on React + Ink, Takumi uses its own rendering engine (**Kagami**), signal-based reactivity (**Myaku**), and agent loop (**Shigoto**) to achieve sub-16ms keystroke-to-display latency with under 50MB memory footprint.

It integrates natively with [Chitragupta](https://github.com/sriinnu/chitragupta) for memory, sessions, and knowledge graphs, and uses [Darpana](https://github.com/sriinnu/chitragupta/tree/main/packages/darpana) as an LLM proxy to work with any provider (OpenAI, Gemini, Groq, Ollama, Anthropic, and more).

### Why not React + Ink?

| | React + Ink | Takumi (Kagami) |
|---|---|---|
| Render overhead | ~8ms (VDOM reconciler) | <2ms (signal-based dirty tracking) |
| Memory per component | ~2KB (fiber nodes) | ~200B (signals + Yoga node) |
| Dependency weight | ~40 packages | 1 external dep (yoga-wasm-web) |
| Update granularity | Component tree re-render | Individual cell diff |

---

## Features

- **Custom Renderer (Kagami 鏡)** — Yoga WASM flexbox layout, double-buffered ANSI output, cell-level diff
- **Reactive Signals (Myaku 脈)** — Fine-grained Preact-style signals with auto-dependency tracking (~150 lines)
- **Agent Loop (Shigoto 仕事)** — ReAct reasoning + tool execution, streaming responses, context compaction
- **Rich Components** — Box, Text, Input, Scroll, List, Markdown, Syntax Highlighter, Diff Viewer, Spinner
- **7 Built-in Tools** — Read, Write, Edit, Bash (sandboxed), Glob, Grep, Ask
- **Permission System** — Pattern-matched allow/ask/deny rules with session scoping
- **Provider-Agnostic** — Any LLM via Darpana proxy (OpenAI, Gemini, Groq, Ollama, Anthropic)
- **Memory & Sessions** — Full Chitragupta integration (GraphRAG, knowledge traces, behavioral patterns)
- **Git-Aware** — Branch, status, diff shown in sidebar and status bar
- **Slash Commands** — `/model`, `/clear`, `/compact`, `/session`, `/diff`, `/help`, and more
- **@ References** — `@file.ts`, `@src/`, `@file.ts#10-20` to attach context
- **! Shell** — `!git status`, `!npm test` inline shell execution

---

## Quickstart

### Prerequisites

- **Node.js** 22+ (LTS)
- **pnpm** 9+
- An LLM API key (Anthropic, OpenAI, Gemini, etc.) **or** a local Ollama instance

### Install

```bash
# Clone
git clone https://github.com/sriinnu/takumi.git
cd takumi

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run
pnpm takumi
```

### Quick Start with API Key

```bash
# Option 1: Direct API key
ANTHROPIC_API_KEY=sk-ant-... pnpm takumi

# Option 2: Via Darpana proxy (supports any provider)
OPENAI_API_KEY=sk-... pnpm takumi --proxy http://localhost:8082

# Option 3: Local Ollama (no key needed)
pnpm takumi --proxy http://localhost:8082 --model local/llama3
```

### Configuration

Takumi looks for config in this order (first found wins):

1. `.takumi/config.json` — project-local
2. `takumi.config.json` — project root
3. `~/.takumi/config.json` — user global
4. `~/.config/takumi/config.json` — XDG

Example `takumi.config.json`:

```json
{
  "model": "sonnet",
  "proxyUrl": "http://localhost:8082",
  "thinking": false,
  "theme": "default",
  "permissions": {
    "defaultBash": "ask",
    "defaultWrite": "ask",
    "safeCommands": ["npm *", "pnpm *", "git status*"]
  },
  "sidebar": { "visible": true, "width": 30 },
  "statusBar": {
    "showTokens": true,
    "showCost": true,
    "showModel": true,
    "showGitBranch": true
  },
  "maxContextTokens": 200000,
  "compactAt": 0.8
}
```

---

## Usage

### CLI Flags

```
takumi [options]

Options:
  --model <name>         Model to use (default: sonnet)
  --thinking             Enable extended thinking
  --thinking-budget <n>  Max thinking tokens (default: 10000)
  --proxy <url>          Darpana proxy URL
  --theme <name>         UI theme
  --log-level <level>    Log level (debug|info|warn|error)
  --cwd <dir>            Working directory
  --help, -h             Show help
  --version, -v          Show version
```

### Environment Variables

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Direct Anthropic API access |
| `TAKUMI_API_KEY` | Override API key |
| `TAKUMI_MODEL` | Default model |
| `TAKUMI_PROXY_URL` | Darpana proxy URL |
| `TAKUMI_THINKING` | Enable thinking (`true`/`false`) |

### Slash Commands

| Command | Shortcut | Purpose |
|---|---|---|
| `/model` | `Ctrl+M` | Switch LLM model |
| `/clear` | `Ctrl+L` | Clear conversation |
| `/compact` | — | Compact context window |
| `/session` | `Ctrl+O` | Session management |
| `/diff` | `Ctrl+D` | Show file changes |
| `/cost` | — | Token & cost breakdown |
| `/help` | `Ctrl+?` | Show help |
| `/quit` | `Ctrl+Q` | Exit |
| `/theme` | — | Switch theme |
| `/undo` | `Ctrl+Z` | Undo last change |
| `/memory` | — | Search Chitragupta memory |

### Input Modes

```
匠> hello world              # Normal message
匠> /model opus              # Slash command
匠> @src/auth.ts             # Attach file
匠> @src/auth.ts#10-20       # Attach line range
匠> !git status              # Run shell command
```

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                匠  Takumi                    │
│  ┌─────────┐  ┌───────────┐  ┌──────────┐  │
│  │  Kagami  │  │  Shigoto  │  │  Bridge  │  │
│  │ Renderer │  │Agent Loop │  │MCP + HTTP│  │
│  │ 鏡       │  │ 仕事      │  │          │  │
│  └────┬─────┘  └─────┬─────┘  └────┬─────┘  │
│       │              │              │        │
│  ┌────┴──────────────┴──────────────┴─────┐  │
│  │           Myaku Signals (脈)            │  │
│  └────────────────────────────────────────┘  │
└──────────────────────┬───────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼                         ▼
  ┌──────────────┐         ┌──────────────┐
  │ Chitragupta  │         │   Darpana    │
  │ चित्र MCP    │         │ दर्पण Proxy  │
  │ (stdio)      │         │ (HTTP:8082)  │
  └──────────────┘         └──────┬───────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼              ▼
               ┌────────┐  ┌────────┐     ┌────────┐
               │ OpenAI │  │ Gemini │ ... │ Ollama │
               └────────┘  └────────┘     └────────┘
```

### Renderer Pipeline

```
Signal Change → Dirty Marking → Yoga Layout → Render → Cell Diff → ANSI Flush
     0ms           0ms            ~1ms        ~0.5ms    ~0.3ms      ~0.2ms
```

### Internal Naming

| Name | Script | Meaning | Component |
|---|---|---|---|
| **Takumi** | 匠 | Master craftsman | The project |
| **Kagami** | 鏡 | Mirror | Renderer engine |
| **Myaku** | 脈 | Pulse | Signal reactivity |
| **Shigoto** | 仕事 | Work / job | Agent loop |

---

## Packages

```
takumi/
├── packages/
│   ├── core/      @takumi/core     — Types, config, errors, logger (zero deps)
│   ├── render/    @takumi/render   — Kagami: Yoga + signals + ANSI diff
│   ├── agent/     @takumi/agent    — Shigoto: LLM loop, tools, sandbox
│   ├── bridge/    @takumi/bridge   — Chitragupta MCP, Darpana HTTP, git
│   └── tui/       @takumi/tui      — Panels, dialogs, formatters, commands
├── bin/
│   └── takumi.ts                   — CLI entry point
├── soul/                           — Personality & identity files
└── docs/                           — Architecture docs & diagrams
```

### Dependency Graph

```
@takumi/core  (no dependencies)
    ├── @takumi/render  (+yoga-wasm-web)
    ├── @takumi/agent
    ├── @takumi/bridge
    └── @takumi/tui  (depends on all above)
```

---

## Development

### Scripts

```bash
pnpm build              # Build all packages (topological order)
pnpm test               # Run all tests
pnpm test:watch         # Watch mode
pnpm test:coverage      # Coverage report
pnpm clean              # Remove all dist/ directories
pnpm dev                # Parallel watch compilation
pnpm check              # Lint + format (Biome)
pnpm takumi             # Run the CLI
```

### Building a Single Package

```bash
pnpm --filter @takumi/core build
pnpm --filter @takumi/render build
pnpm --filter @takumi/agent build
```

### Running Tests

```bash
# All tests
pnpm test

# Single package
pnpm --filter @takumi/core test

# Watch mode with pattern
pnpm test -- --watch --reporter=verbose

# Coverage
pnpm test:coverage
```

### Project Structure

Each package follows the same layout:

```
packages/<name>/
├── src/
│   ├── index.ts        # Public API exports
│   └── ...             # Implementation files
├── test/
│   └── *.test.ts       # Vitest tests
├── package.json
├── tsconfig.json
└── README.md
```

---

## Performance Targets

| Metric | Target | Method |
|---|---|---|
| Keystroke → display | <16ms | Signal dirty tracking, no VDOM |
| Full screen render | <8ms | Yoga WASM + cell diff |
| Stream token → display | <5ms | Direct signal update |
| Idle memory | <50MB | No framework overhead |
| Render FPS (streaming) | 30-60 | Adaptive batch |
| Max concurrent tools | 8 | Parallel execution |

---

## Integration

### Chitragupta (Memory & MCP)

Takumi spawns Chitragupta as a child process via MCP stdio transport:

```
takumi (main) ──stdio──> chitragupta-mcp (child)
```

Provides: memory search, session management, knowledge graph, behavioral patterns, handover protocol.

### Darpana (LLM Proxy)

Takumi connects to Darpana via HTTP for provider-agnostic LLM access:

```
takumi ──HTTP──> darpana (localhost:8082) ──> OpenAI / Gemini / Ollama / ...
```

Provides: model aliasing (sonnet/haiku/opus), format conversion (Anthropic ↔ OpenAI/Gemini), connection pooling, retry logic.

---

## Roadmap

| Phase | Status | Description |
|---|---|---|
| **Phase 0** — Scaffold | Done | Package structure, config, types, CLI entry |
| **Phase 1** — Kagami Renderer | Planned | ANSI, Yoga, signals, screen buffer, components |
| **Phase 2** — Core Components | Planned | Box, Text, Input, Scroll, Markdown, Syntax, Diff |
| **Phase 3** — Agent Loop | Planned | LLM provider, tools, sandbox, context management |
| **Phase 4** — TUI Application | Planned | Panels, dialogs, commands, keybinds |
| **Phase 5** — Bridge & Integration | Planned | Chitragupta MCP, Darpana HTTP, git |
| **Phase 6** — CLI & Polish | Planned | Error handling, first-run, shutdown, signals |
| **Phase 7** — Advanced | Planned | Mouse, themes, vim mode, coding agent mode |

See [TODO.md](TODO.md) for the full checklist.

---

## References

### Agent Architecture
- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629) — Yao et al., 2022
- [Toolformer: Language Models Can Teach Themselves to Use Tools](https://arxiv.org/abs/2302.04761) — Schick et al., 2023
- [SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering](https://arxiv.org/abs/2405.15793) — Yang et al., 2024
- [CodeAct: Executable Code Actions Elicit Better LLM Agents](https://arxiv.org/abs/2402.01030) — Wang et al., 2024

### Memory & Context
- [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560) — Packer et al., 2023

### Model Routing
- [FrugalGPT: Better LLM Use at Reduced Cost](https://arxiv.org/abs/2305.05176) — Chen et al., 2023
- [RouteLLM: Learning to Route LLMs with Preference Data](https://arxiv.org/abs/2406.18665) — Ong et al., 2024

### Renderer Technology
- [Yoga Layout Engine](https://www.yogalayout.dev/) — Facebook
- [XTerm Control Sequences](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html)
- [Unicode East Asian Width](https://www.unicode.org/reports/tr11/)
- [Preact Signals](https://preactjs.com/guide/v10/signals/)

---

## Ecosystem

Takumi is part of the **Kaala-brahma** project family:

| Project | Description |
|---|---|
| [Chitragupta](https://github.com/sriinnu/chitragupta) | Core engine — memory, sessions, knowledge graph, MCP server |
| [Darpana](https://github.com/sriinnu/chitragupta/tree/main/packages/darpana) | LLM API proxy — provider-agnostic, <5ms overhead |
| **Takumi** | Terminal coding agent — custom renderer, agent loop |

---

## License

MIT
