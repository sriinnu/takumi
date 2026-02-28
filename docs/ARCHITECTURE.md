# Architecture — Takumi (匠)

> High-level architecture of the Takumi terminal coding agent.

## Overview

Takumi is a **terminal-native AI coding agent** built from scratch in TypeScript.
It owns the full rendering stack (no React/Ink dependency), speaks to LLMs via a
provider-agnostic abstraction, and integrates with Chitragupta for persistent
memory and session management.

## System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     TAKUMI (匠)                             │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │  Editor   │  │  Chat    │  │  Tools   │  │  Status   │  │
│  │  Input    │  │  Output  │  │  Viewer  │  │  Bar      │  │
│  └────┬─────┘  └────▲─────┘  └────▲─────┘  └─────▲─────┘  │
│       │              │              │              │         │
│  ┌────▼──────────────┴──────────────┴──────────────┴─────┐  │
│  │              Kagami Renderer (鏡)                      │  │
│  │     Signal Change → Yoga Layout → Diff → ANSI Flush   │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │                                   │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │              Shigoto Agent Loop (仕事)                 │  │
│  │    Prompt → LLM → Parse → Tool Execute → Repeat       │  │
│  └──────┬────────────────────────────────┬───────────────┘  │
│         │                                │                   │
└─────────┼────────────────────────────────┼───────────────────┘
          │                                │
          ▼                                ▼
┌──────────────────┐            ┌──────────────────┐
│  Darpana (दर्पण)  │            │ Chitragupta (चित्र) │
│  LLM Proxy       │            │ Memory & MCP      │
└────────┬─────────┘            └──────────────────┘
         │
    ┌────┴────┬──────────┐
    ▼         ▼          ▼
 OpenAI    Gemini     Ollama
```

## Process Architecture

```
takumi (main process)
├── chitragupta-mcp (child, stdio)     ← MCP server for memory / sessions
├── darpana (HTTP, localhost:8082)     ← LLM proxy (external or auto-launched)
└── tool subprocesses (bash, git)      ← short-lived, sandboxed
```

Takumi spawns `chitragupta-mcp` as a child process over MCP stdio transport.
Darpana runs as a separate daemon. Tool subprocesses are ephemeral and sandboxed.

## Package Structure

```
packages/
├── core/     ← Types, config, errors, constants, logger (zero deps)
├── render/   ← Custom renderer engine — Kagami (鏡)
├── bridge/   ← Chitragupta MCP client, Darpana health, Git helpers
├── agent/    ← LLM agent loop — Shigoto (仕事), tools, providers
└── tui/      ← Application shell — panels, dialogs, keybinds, commands
```

### Dependency Graph

```
core ←──── render ←──── tui ────► bin/takumi.ts
  ▲           ▲          │
  │           │          │
  └───────── agent ◄─────┘
              ▲
              │
            bridge
```

- **core** — Zero external dependencies. Shared types (`Message`, `AgentEvent`, `TakumiConfig`),
  configuration loading, typed error hierarchy, ANSI escape constants, and a structured file logger.
- **render** — Depends on `core` + `yoga-wasm-web`. The Kagami rendering engine: Yoga-based flexbox
  layout, reactive signals (Myaku), double-buffered screen, cell-level diff, component model, and
  the `Renderer` orchestrator.
- **bridge** — Depends on `core`. Integration layer: Chitragupta MCP client (stdio spawn),
  Darpana HTTP health check / auto-launch, and Git operations (status, branch, diff, commit).
- **agent** — Depends on `core`. The Shigoto agent loop: prompt construction, LLM streaming,
  tool registry and dispatch, permission engine, safety sandbox, model classification, and
  multi-agent cluster orchestration.
- **tui** — Depends on `core` + `render` + `agent`. The complete TUI application: root view
  layout, chat/code/log views, dialogs (command palette, model picker, permission prompt),
  key bindings, slash commands, and state management.

## Key Subsystems

### Kagami — Renderer (鏡)

The custom rendering engine that reflects the component tree onto the terminal.

| Module | Role |
|--------|------|
| `renderer.ts` | Pipeline orchestrator — owns terminal init/cleanup, RenderScheduler |
| `reconciler.ts` | Render loop — Yoga layout → component render → screen diff → ANSI flush |
| `screen.ts` | Double-buffered cell grid with minimal-diff patching |
| `signals.ts` | Myaku (脈) reactive system — `signal`, `computed`, `effect`, `batch` |
| `component.ts` | Base component class with lifecycle, dirty tracking, Yoga node |
| `yoga.ts` | Yoga WASM bindings and layout computation helpers |
| `ansi.ts` | Low-level ANSI escape code primitives |
| `terminal.ts` | Terminal capability detection and synchronized output |

### Shigoto — Agent Loop (仕事)

The core LLM interaction loop that does the actual coding work.

| Module | Role |
|--------|------|
| `loop.ts` | Send → receive → tool execute → repeat cycle |
| `stream.ts` | Streaming response handler (SSE → AgentEvent) |
| `message.ts` | Message builder (system, user, assistant, tool results) |
| `context/builder.ts` | System prompt construction with project context |
| `context/compact.ts` | Context compaction — summarize old turns at 80% capacity |
| `tools/registry.ts` | Tool registry and dispatch |
| `safety/sandbox.ts` | Command execution sandbox with timeouts |
| `safety/permissions.ts` | Permission rule engine (allow / ask / deny) |
| `safety/allowlist.ts` | Safe command allowlist for Bash tool |
| `providers/` | LLM provider adapters (Darpana, direct Anthropic, etc.) |

### Myaku — Reactivity (脈)

Signal-based reactive system that drives rendering.

```
Signal write → subscriber notification → component markDirty()
    → RenderScheduler picks up dirty components
    → only affected area re-renders → cell-level diff → minimal ANSI output
```

Key primitives: `signal(value)`, `computed(fn)`, `effect(fn)`, `batch(fn)`, `untrack(fn)`.

### Bridge — Integration Layer

| Module | Role |
|--------|------|
| `chitragupta.ts` | MCP client — spawns `chitragupta-mcp` over stdio, JSON-RPC |
| `darpana.ts` | HTTP health check, auto-launch, connection management |
| `git.ts` | Git operations: status, branch detection, diff, commit |

## Data Flow

### User Message → LLM Response

```
User types → Editor signal → submit
  → AgentLoop.send(messages, system, tools)
    → Provider.stream() → SSE events
      → AgentEvent objects → TUI event handler
        → text_delta → append to message signal → MessageList re-renders
        → tool_start → ToolOutput re-renders
        → tool_end → result displayed
        → message_end → finalize, update status bar
```

### Rendering Pipeline

```
Signal Change → Dirty Marking → Yoga Layout → Render Pass → Diff → ANSI Flush
```

See [ALGORITHMS.md](ALGORITHMS.md) for detailed algorithm descriptions.

## Startup Sequence

1. Parse CLI arguments (`bin/cli/args.ts`)
2. Load configuration (CLI flags → env vars → project config → user config → defaults)
3. Spawn Chitragupta MCP child process (stdio transport)
4. Health-check Darpana (auto-launch if needed)
5. Load session history from Chitragupta
6. Initialize Yoga WASM
7. Create `TakumiApp` — root view, keybinds, slash commands, state
8. Enter alternate screen, hide cursor, enable raw mode / mouse / bracketed paste
9. Start render scheduler — first frame rendered
10. Ready for user input

## Security Model

- **API keys** never touch Takumi — all LLM calls go through Darpana
- **File access** restricted to CWD tree; `.env` and credential files blocked
- **Bash tool** sandboxed: allowlisted commands auto-approved, dangerous patterns denied
- **Permission engine** supports scopes: `once`, `session`, `project`, `global`
- **Process isolation**: main process, MCP child process, tool subprocesses are separate

## Performance Targets

| Operation | Target |
|-----------|--------|
| Keystroke → display | <16 ms |
| Full screen render | <8 ms |
| Stream token → display | <5 ms |
| Idle memory | <50 MB |

See [ALGORITHMS.md](ALGORITHMS.md) for budget breakdowns.

## Naming Convention

| Name | Script | Meaning | Component |
|------|--------|---------|-----------|
| **Takumi** | 匠 | Master craftsman | The project |
| **Kagami** | 鏡 | Mirror | Renderer |
| **Myaku** | 脈 | Pulse | Reactivity system |
| **Shigoto** | 仕事 | Work / job | Agent loop |

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Language | TypeScript 5.7+ | Type safety, strict mode |
| Runtime | Node.js 22+ | LTS, native ESM |
| Package Manager | pnpm 9+ | Workspace, strict |
| Layout | yoga-wasm-web | Flexbox in WASM |
| Testing | Vitest 4+ | Fast, ESM-native |
| Linting | Biome 1.9+ | Fast, all-in-one |
| LLM Access | Darpana | Provider-agnostic proxy |
| Memory | Chitragupta MCP | Sessions, knowledge graph |
