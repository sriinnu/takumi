# Takumi (匠) — Master Architecture Specification

> **匠** (たくみ / Takumi) — Master craftsman. The one who builds with precision and mastery.

## Table of Contents

1. [Vision & Philosophy](#1-vision--philosophy)
2. [System Architecture](#2-system-architecture)
3. [Package Structure](#3-package-structure)
4. [Custom Renderer — Kagami (鏡)](#4-custom-renderer--kagami-)
5. [Component Model](#5-component-model)
6. [Reactivity System — Myaku (脈)](#6-reactivity-system--myaku-)
7. [Input System](#7-input-system)
8. [Agent Loop — Shigoto (仕事)](#8-agent-loop--shigoto-)
9. [Tool System](#9-tool-system)
10. [Streaming & Output](#10-streaming--output)
11. [Permission System](#11-permission-system)
12. [Integration: Chitragupta & Darpana](#12-integration-chitragupta--darpana)
13. [Session Management](#13-session-management)
14. [Configuration](#14-configuration)
15. [CLI Interface](#15-cli-interface)
16. [State Diagrams](#16-state-diagrams)
17. [Sequence Diagrams](#17-sequence-diagrams)
18. [Performance Targets](#18-performance-targets)
19. [Security Model](#19-security-model)
20. [References](#20-references)

---

## 1. Vision & Philosophy

Takumi is a **high-performance terminal coding agent** — a rich TUI that serves as the primary
interface for interacting with LLMs for software engineering tasks.

### Design Principles

1. **Own the stack** — Custom renderer, no React/Ink dependency. Full control over every pixel.
2. **Performance is correctness** — <16ms render cycle (60fps capable), <50ms input-to-display latency.
3. **Chitragupta-native** — Memory, sessions, knowledge graph built in from day one.
4. **Provider-agnostic** — Through Darpana, any LLM backend works identically.
5. **Craftsman's tool** — Opinionated, sharp, minimal. Not a framework — a product.

### What Takumi Is NOT

- Not a general-purpose TUI framework (that's `packages/render`)
- Not a chatbot UI (it's a coding agent with tool use)
- Not a wrapper around Claude Code (it's a ground-up alternative)

### Inspirations

| Project | What We Take | What We Skip |
|---------|-------------|-------------|
| Claude Code | Permission UX, tool visualization, streaming feel | React+Ink overhead, closed source |
| OpenCode | Elm architecture, panel layout, session management | Go language, Bubble Tea dependency |
| NanoCoder | Token awareness, @-references, local-first | React+Ink again |
| Helix Editor | Custom renderer, performance-first, terminal mastery | Not an AI agent |
| Zed | GPU rendering philosophy (we do CPU, but same spirit) | Desktop app, not terminal |

---

## 2. System Architecture

### High-Level Data Flow

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
│  │         Yoga Layout → Signal Reactivity → ANSI Diff   │  │
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
│   Darpana (दर्पण)  │            │ Chitragupta (चित्र) │
│   LLM Proxy      │            │ Memory & MCP      │
│   localhost:8082  │            │ stdio transport    │
└────────┬─────────┘            └──────────────────┘
         │
    ┌────┴────┬──────────┐
    ▼         ▼          ▼
 OpenAI    Gemini     Ollama
```

### Process Architecture

```
takumi (main process)
├── chitragupta-mcp (child process, stdio)     ← MCP server
├── darpana (HTTP, localhost:8082)              ← LLM proxy (may be external)
└── tool subprocesses (bash, git, etc.)         ← sandboxed, per-tool
```

Takumi spawns chitragupta-mcp as a child process using MCP stdio transport.
Darpana runs as a separate daemon (started independently or auto-launched by takumi).
Tool subprocesses are short-lived, sandboxed, and monitored.

---

## 3. Package Structure

```
takumi/
├── packages/
│   ├── core/                  ← Types, config, errors, constants
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── types.ts       ← All shared type definitions
│   │   │   ├── config.ts      ← Config loading (takumi.json, env vars)
│   │   │   ├── errors.ts      ← Typed error hierarchy
│   │   │   ├── constants.ts   ← Key codes, ANSI sequences, limits
│   │   │   └── logger.ts      ← Structured logger (file-based, not stdout)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── render/                ← Custom renderer engine — Kagami (鏡)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── yoga.ts        ← Yoga WASM bindings + layout helpers
│   │   │   ├── signals.ts     ← Reactive signal system (Myaku)
│   │   │   ├── renderer.ts    ← Layout tree → ANSI diff pipeline
│   │   │   ├── screen.ts      ← Double-buffered terminal screen
│   │   │   ├── component.ts   ← Base component class
│   │   │   ├── reconciler.ts  ← Dirty-checking + partial re-render
│   │   │   ├── ansi.ts        ← ANSI escape code primitives
│   │   │   ├── color.ts       ← 256-color + truecolor utilities
│   │   │   ├── text.ts        ← Unicode-aware text measurement + wrapping
│   │   │   ├── theme.ts       ← Theme system (color palettes)
│   │   │   └── components/    ← Built-in components
│   │   │       ├── box.ts     ← Flexbox container (maps to Yoga node)
│   │   │       ├── text.ts    ← Text with style (bold, dim, color)
│   │   │       ├── input.ts   ← Text input with cursor
│   │   │       ├── scroll.ts  ← Scrollable viewport
│   │   │       ├── list.ts    ← Virtual list (renders visible items only)
│   │   │       ├── table.ts   ← Table with column alignment
│   │   │       ├── spinner.ts ← Animated spinner
│   │   │       ├── border.ts  ← Box-drawing border decorator
│   │   │       ├── markdown.ts ← Markdown → component tree
│   │   │       ├── syntax.ts  ← Syntax-highlighted code blocks
│   │   │       └── diff.ts    ← Unified/side-by-side diff view
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── tui/                   ← The TUI application
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── app.ts         ← Root app — layout, panels, lifecycle
│   │   │   ├── state.ts       ← Global app state (signals)
│   │   │   ├── keybinds.ts    ← Key binding registry
│   │   │   ├── commands.ts    ← Slash command registry
│   │   │   ├── views/
│   │   │   │   ├── chat.ts    ← Main chat view (messages + input)
│   │   │   │   ├── code.ts    ← Code-focused view (diff + preview)
│   │   │   │   └── logs.ts    ← Log viewer
│   │   │   ├── panels/
│   │   │   │   ├── message-list.ts  ← Scrollable message history
│   │   │   │   ├── editor.ts        ← Multiline input editor
│   │   │   │   ├── sidebar.ts       ← File tree / session info
│   │   │   │   ├── status-bar.ts    ← Bottom status bar
│   │   │   │   ├── header.ts        ← Top bar (model, project, branch)
│   │   │   │   └── tool-output.ts   ← Tool call result display
│   │   │   ├── dialogs/
│   │   │   │   ├── command-palette.ts ← Fuzzy command search (Ctrl+K)
│   │   │   │   ├── model-picker.ts   ← Model selection
│   │   │   │   ├── permission.ts     ← Tool approval prompt
│   │   │   │   ├── session-list.ts   ← Session browser
│   │   │   │   └── file-picker.ts    ← @-reference file search
│   │   │   └── formatters/
│   │   │       ├── message.ts   ← Format assistant/user messages
│   │   │       ├── tool-call.ts ← Format tool invocations
│   │   │       ├── thinking.ts  ← Format thinking/reasoning blocks
│   │   │       └── error.ts     ← Format error displays
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── agent/                 ← LLM agent loop — Shigoto (仕事)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── loop.ts        ← Core agent loop (send → receive → act)
│   │   │   ├── message.ts     ← Message builder (system, user, assistant)
│   │   │   ├── stream.ts      ← Streaming response handler
│   │   │   ├── tools/
│   │   │   │   ├── registry.ts    ← Tool registry + dispatch
│   │   │   │   ├── read.ts        ← Read file
│   │   │   │   ├── write.ts       ← Write file
│   │   │   │   ├── edit.ts        ← Edit file (search/replace)
│   │   │   │   ├── bash.ts        ← Execute shell command
│   │   │   │   ├── glob.ts        ← File pattern search
│   │   │   │   ├── grep.ts        ← Content search
│   │   │   │   ├── ask.ts         ← Ask user question
│   │   │   │   └── mcp.ts         ← Forward to MCP tools
│   │   │   ├── context/
│   │   │   │   ├── builder.ts     ← System prompt construction
│   │   │   │   ├── project.ts     ← Project detection + CLAUDE.md loading
│   │   │   │   └── compact.ts     ← Context compaction (summarize old turns)
│   │   │   ├── providers/
│   │   │   │   ├── darpana.ts     ← Darpana HTTP client
│   │   │   │   └── direct.ts      ← Direct API client (Anthropic SDK)
│   │   │   └── safety/
│   │   │       ├── sandbox.ts     ← Command execution sandbox
│   │   │       ├── permissions.ts ← Permission rule engine
│   │   │       └── allowlist.ts   ← Safe command allowlist
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── bridge/                ← Integration bridges
│       ├── src/
│       │   ├── index.ts
│       │   ├── chitragupta.ts ← Chitragupta MCP client (stdio spawn)
│       │   ├── darpana.ts     ← Darpana HTTP health check + auto-launch
│       │   └── git.ts         ← Git operations (status, branch, diff, commit)
│       ├── package.json
│       └── tsconfig.json
│
├── bin/
│   └── takumi.ts              ← CLI entry point
│
├── soul/                      ← Identity & personality (not a package)
│   ├── personality.md
│   ├── preferences.md
│   └── identity.md
│
├── docs/
│   ├── ARCHITECTURE.md        ← This file (symlinked)
│   ├── ALGORITHMS.md          ← Renderer algorithms, layout, diffing
│   ├── KEYBINDINGS.md         ← All keyboard shortcuts
│   └── diagrams/              ← Rendered Mermaid diagrams (PNG/SVG)
│
├── TAKUMI_MASTER_SPEC.md      ← This file
├── TODO.md                    ← Implementation checklist
├── package.json               ← Root workspace package
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.config.ts
└── biome.json
```

### Package Dependency Graph

```
core ←──── render ←──── tui ────► bin/takumi.ts
  ▲           ▲          │
  │           │          │
  └───────── agent ◄─────┘
              ▲
              │
            bridge
```

- **core**: zero dependencies (types, config, logger)
- **render**: depends on core + yoga-wasm-web
- **agent**: depends on core (tool definitions, message types)
- **tui**: depends on core + render + agent (wires everything together)
- **bridge**: depends on core (chitragupta MCP client, darpana health)

---

## 4. Custom Renderer — Kagami (鏡)

> **鏡** (かがみ / Kagami) — Mirror. The rendering engine that reflects your component tree onto the terminal.

### Why Custom

| Approach | Render Overhead | Layout | Control | Dependencies |
|----------|----------------|--------|---------|-------------|
| React + Ink | ~8ms (reconciler + Yoga) | Flexbox | Medium | react, ink, yoga |
| Blessed | ~12ms (full DOM) | Absolute | High | blessed |
| **Kagami** | ~2ms (signals + Yoga) | Flexbox | Full | yoga-wasm-web only |

### Rendering Pipeline

```
Signal Change
    │
    ▼
Dirty Marking ──► Which components changed?
    │
    ▼
Yoga Layout ───► Compute positions & sizes (flexbox)
    │
    ▼
Render Pass ───► Component.render() → cell grid
    │
    ▼
Diff Pass ────► Compare with previous frame
    │
    ▼
ANSI Output ──► Write only changed cells to stdout
```

### The Screen Buffer

Two-dimensional grid of `Cell` objects:

```typescript
interface Cell {
    char: string;        // Single grapheme (Unicode-aware)
    fg: number;          // Foreground color (256 or truecolor)
    bg: number;          // Background color
    bold: boolean;
    dim: boolean;
    italic: boolean;
    underline: boolean;
    strikethrough: boolean;
}
```

Double-buffered: `current` and `previous` grids. On each render cycle:
1. Clear `current` grid
2. Render component tree into `current`
3. Diff `current` vs `previous`
4. Emit ANSI escape sequences for changed cells only
5. Swap buffers

### Yoga Integration

[Yoga](https://www.yogalayout.dev/) is Facebook's cross-platform flexbox layout engine,
compiled to WebAssembly. It gives us:

- `flexDirection: row | column`
- `justifyContent: flex-start | center | flex-end | space-between`
- `alignItems: stretch | flex-start | center | flex-end`
- `flexGrow`, `flexShrink`, `flexBasis`
- `padding`, `margin`, `border`
- `width`, `height`, `minWidth`, `maxWidth`
- `overflow: hidden | scroll | visible`
- `position: relative | absolute`

Each component creates a Yoga node. The layout tree mirrors the component tree.

```typescript
// Example: split pane layout
const root = Yoga.Node.create();
root.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
root.setWidth(terminalWidth);
root.setHeight(terminalHeight);

const main = Yoga.Node.create();
main.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
main.setFlexGrow(1);

const messages = Yoga.Node.create();
messages.setFlexGrow(1);     // Takes remaining space

const sidebar = Yoga.Node.create();
sidebar.setWidth(30);         // Fixed 30 columns

const input = Yoga.Node.create();
input.setHeight(3);           // Fixed 3 rows

main.insertChild(messages, 0);
main.insertChild(sidebar, 1);
root.insertChild(main, 0);
root.insertChild(input, 1);

root.calculateLayout(terminalWidth, terminalHeight, Yoga.DIRECTION_LTR);
// Now each node has computed: left, top, width, height
```

### Text Measurement

Terminal text measurement is non-trivial:
- CJK characters are **2 columns wide** (fullwidth)
- Emoji may be 1 or 2 columns depending on terminal
- ANSI escape sequences have **0 width** (invisible)
- Combining characters (accents, etc.) have **0 width**

We use `east-asian-width` categorization + grapheme cluster segmentation:

```typescript
function measureText(text: string): number {
    let width = 0;
    for (const grapheme of segmentGraphemes(text)) {
        if (isANSIEscape(grapheme)) continue;
        width += isFullwidth(grapheme) ? 2 : 1;
    }
    return width;
}
```

References:
- Unicode Standard Annex #11: East Asian Width
- Unicode Standard Annex #29: Grapheme Cluster Boundaries

---

## 5. Component Model

### Base Component

```typescript
abstract class Component {
    // Identity
    readonly id: string;

    // Yoga layout node
    readonly node: YogaNode;

    // Reactive state
    protected signals: Map<string, Signal<unknown>>;

    // Lifecycle
    abstract mount(): void;
    abstract unmount(): void;
    abstract render(area: Rect): Cell[][];

    // Children
    children: Component[];
    parent: Component | null;

    // Dirty tracking
    isDirty: boolean;
    markDirty(): void;
}
```

### Component Lifecycle

```
Constructor → mount() → [render cycle...] → unmount()
                ▲              │
                │              ▼
            Signal change → markDirty() → re-render
```

### Built-in Components

| Component | Purpose | Key Features |
|-----------|---------|-------------|
| `Box` | Flexbox container | Direction, padding, border, overflow |
| `Text` | Styled text span | Color, bold, dim, italic, word-wrap |
| `Input` | Text input field | Cursor, selection, history, multiline |
| `Scroll` | Scrollable viewport | Virtual scrolling, scroll indicators |
| `List` | Virtual list | Only renders visible items, O(visible) |
| `Table` | Aligned columns | Auto-width, truncation, alignment |
| `Spinner` | Animated indicator | Braille/dots/line styles, customizable |
| `Border` | Box-drawing decorator | Single/double/rounded/heavy borders |
| `Markdown` | Markdown renderer | Headings, lists, code, links, tables |
| `Syntax` | Code highlighting | Per-language tokenizer, theme colors |
| `Diff` | Diff viewer | Unified + side-by-side, line numbers |

### Composition Example

```typescript
// The main TUI layout
const app = new Box({ flexDirection: "column", width: "100%", height: "100%" }, [
    // Header
    new Box({ height: 1, flexDirection: "row", padding: { left: 1 } }, [
        new Text({ content: "匠 takumi", bold: true, color: "cyan" }),
        new Text({ content: ` │ ${model}`, dim: true }),
        new Text({ content: ` │ ${branch}`, color: "green" }),
    ]),

    // Main area
    new Box({ flexDirection: "row", flexGrow: 1 }, [
        // Message list (takes remaining space)
        new Scroll({ flexGrow: 1 }, [
            new MessageList({ messages: state.messages }),
        ]),

        // Sidebar (fixed width)
        new Box({ width: 30, borderLeft: true }, [
            new Sidebar({ files: state.modifiedFiles, session: state.session }),
        ]),
    ]),

    // Input area
    new Box({ height: 3, borderTop: true }, [
        new Editor({ prompt: "匠>", onSubmit: handleSubmit }),
    ]),

    // Status bar
    new Box({ height: 1, flexDirection: "row" }, [
        new StatusBar({ tokens: state.tokens, cost: state.cost, model: state.model }),
    ]),
]);
```

---

## 6. Reactivity System — Myaku (脈)

> **脈** (みゃく / Myaku) — Pulse. The reactive heartbeat that flows through the component tree.

### Why Signals (Not React)

| Feature | React Hooks | Signals (Myaku) |
|---------|------------|-----------------|
| Overhead | Virtual DOM diff (~5ms) | Direct invalidation (~0.1ms) |
| Granularity | Component-level re-render | Cell-level dirty marking |
| Dependencies | Manual dependency arrays | Auto-tracked |
| Memory | Fiber tree + closure chain | Flat signal graph |
| Bundle | react + react-reconciler (~40KB) | ~200 lines |

### Signal Primitives

```typescript
// Create a reactive value
const count = signal(0);

// Read (auto-tracks dependency)
console.log(count.value); // 0

// Write (triggers dependents)
count.value = 1;

// Computed (derived, lazy, cached)
const doubled = computed(() => count.value * 2);

// Effect (side-effect on change)
effect(() => {
    statusBar.setTokenCount(tokens.value);
});

// Batch (multiple writes, single update)
batch(() => {
    messages.value = [...messages.value, newMsg];
    tokens.value += newTokens;
    cost.value += newCost;
});
```

### Implementation (~150 lines)

Based on the Preact signals algorithm (see References §20):

```typescript
// Dependency tracking via global stack
let currentObserver: Computation | null = null;

class Signal<T> {
    private _value: T;
    private subscribers = new Set<Computation>();

    get value(): T {
        if (currentObserver) {
            this.subscribers.add(currentObserver);
            currentObserver.dependencies.add(this);
        }
        return this._value;
    }

    set value(newVal: T) {
        if (newVal === this._value) return;
        this._value = newVal;
        for (const sub of this.subscribers) {
            sub.markDirty();
        }
    }
}
```

### How Signals Drive Rendering

```
User types "hello"
    │
    ▼
inputBuffer.value = "hello"    ← Signal write
    │
    ▼
Editor component subscribed → markDirty()
    │
    ▼
Render scheduler picks up dirty components
    │
    ▼
Only Editor re-renders (not entire screen)
    │
    ▼
Diff against previous frame
    │
    ▼
ANSI output: only the input area changes
```

---

## 7. Input System

### Raw Terminal Input

```typescript
// Enable raw mode
process.stdin.setRawMode(true);
process.stdin.resume();

// Parse key sequences
process.stdin.on("data", (data: Buffer) => {
    const keys = parseKeySequence(data);
    for (const key of keys) {
        dispatch(key);
    }
});
```

### Key Sequence Parser

Terminal input arrives as byte sequences:
- Simple chars: `a` → `[0x61]`
- Ctrl+C: `[0x03]`
- Arrow up: `[0x1b, 0x5b, 0x41]` (ESC [ A)
- Ctrl+Arrow: `[0x1b, 0x5b, 0x31, 0x3b, 0x35, 0x41]` (ESC [ 1;5 A)
- Bracketed paste: `ESC[200~` ... `ESC[201~`

```typescript
interface KeyEvent {
    name: string;        // "a", "enter", "up", "tab", etc.
    char?: string;       // Printable character if applicable
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
    sequence: string;    // Raw byte sequence
}
```

### Input Modes

```
┌─────────────────────────────────────┐
│           Normal Mode               │
│  Type text, submit with Enter       │
│  / → Slash command mode             │
│  @ → File reference mode            │
│  ! → Shell command mode             │
│  Ctrl+K → Command palette           │
│  Ctrl+C → Cancel / Clear            │
│  Esc → Close dialog / Cancel        │
│  Tab → Autocomplete                 │
│  Shift+Enter → Newline              │
├─────────────────────────────────────┤
│         Slash Command Mode          │
│  /model, /session, /clear, etc.     │
│  Tab → Cycle completions            │
│  Enter → Execute command            │
│  Esc → Back to normal               │
├─────────────────────────────────────┤
│        File Reference Mode          │
│  @filename → Fuzzy search files     │
│  Tab → Accept completion            │
│  Enter → Insert reference           │
│  Esc → Cancel                       │
├─────────────────────────────────────┤
│          Dialog Mode                │
│  Arrow keys → Navigate options      │
│  Enter → Select                     │
│  Esc → Dismiss                      │
│  Type → Filter/search               │
├─────────────────────────────────────┤
│        Permission Mode              │
│  y / Enter → Allow                  │
│  a → Allow for session              │
│  n → Deny                           │
│  Esc → Deny                         │
└─────────────────────────────────────┘
```

### Multiline Editing

The editor component supports:
- `Shift+Enter` or `\` at line end → newline
- Cursor movement: arrows, Home/End, Ctrl+A/E
- Word-level: Ctrl+Left/Right, Ctrl+W (delete word back)
- Line-level: Ctrl+U (delete to start), Ctrl+K (delete to end)
- History: Up/Down arrows cycle through previous inputs
- Undo/Redo: Ctrl+Z / Ctrl+Shift+Z

---

## 8. Agent Loop — Shigoto (仕事)

> **仕事** (しごと / Shigoto) — Work. The job that must be done.

### Core Loop

```typescript
async function agentLoop(userMessage: string, context: AgentContext): AsyncIterable<AgentEvent> {
    const messages = context.buildMessages(userMessage);

    while (true) {
        // 1. Send to LLM (via Darpana or direct)
        const stream = await context.provider.stream(messages);

        // 2. Accumulate response
        let response = { content: [], stopReason: null, toolCalls: [] };

        for await (const event of stream) {
            yield event;  // Stream to TUI in real-time
            response = accumulate(response, event);
        }

        // 3. Check if done
        if (response.stopReason === "end_turn") {
            messages.push({ role: "assistant", content: response.content });
            break;
        }

        // 4. Execute tool calls
        if (response.stopReason === "tool_use") {
            messages.push({ role: "assistant", content: response.content });

            const toolResults = [];
            for (const toolCall of response.toolCalls) {
                // Request permission if needed
                const permitted = await context.permissions.check(toolCall);
                if (!permitted) {
                    toolResults.push({ id: toolCall.id, error: "Permission denied" });
                    continue;
                }

                yield { type: "tool_start", tool: toolCall };
                const result = await context.tools.execute(toolCall);
                yield { type: "tool_end", tool: toolCall, result };

                toolResults.push({ id: toolCall.id, content: result });
            }

            messages.push({ role: "user", content: toolResults });
            continue;  // Loop back to LLM
        }

        break;  // Unknown stop reason
    }
}
```

### Agent Events (Stream → TUI)

```typescript
type AgentEvent =
    | { type: "message_start"; model: string; id: string }
    | { type: "text_delta"; text: string }
    | { type: "thinking_delta"; text: string }
    | { type: "tool_start"; tool: ToolCall }
    | { type: "tool_end"; tool: ToolCall; result: ToolResult }
    | { type: "tool_error"; tool: ToolCall; error: Error }
    | { type: "permission_request"; tool: ToolCall }
    | { type: "permission_response"; tool: ToolCall; allowed: boolean }
    | { type: "message_end"; stopReason: string; usage: Usage }
    | { type: "error"; error: Error }
    | { type: "context_compact"; summary: string }
    ;
```

### Context Window Management

```
200K token budget (typical)
├── System prompt           ~2K tokens (fixed)
├── Project context         ~1K tokens (CLAUDE.md, etc.)
├── Chitragupta memory      ~1K tokens (relevant past sessions)
├── Tool definitions        ~3K tokens (fixed per tool set)
├── Conversation history    ~180K tokens (growing)
│   └── When >80% full → compact oldest turns into summary
└── Reserved for response   ~13K tokens
```

Compaction strategy:
1. At 80% context usage, summarize oldest N turns into a single summary message
2. Use chitragupta's `chitragupta_handover` tool to preserve work state
3. Keep most recent 10 turns uncompacted for continuity
4. Tool results are aggressively truncated (keep first/last 200 lines)

---

## 9. Tool System

### Built-in Tools

| Tool | Description | Permission Default |
|------|-------------|-------------------|
| `Read` | Read file contents | `allow` |
| `Glob` | Find files by pattern | `allow` |
| `Grep` | Search file contents | `allow` |
| `Write` | Create/overwrite file | `ask` |
| `Edit` | Search & replace in file | `ask` |
| `Bash` | Execute shell command | `ask` (allowlisted: `allow`) |
| `Ask` | Ask user a question | `allow` |
| `MCP` | Forward to MCP server | varies |

### Tool Definition

```typescript
interface ToolDefinition {
    name: string;
    description: string;
    parameters: JSONSchema;
    permission: "allow" | "ask" | "deny";
    execute: (params: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}

interface ToolResult {
    content: string;
    isError?: boolean;
    metadata?: {
        duration: number;
        bytesRead?: number;
        filesModified?: string[];
    };
}

interface ToolContext {
    cwd: string;
    permissions: PermissionEngine;
    emit: (event: AgentEvent) => void;
    signal: AbortSignal;
}
```

### Command Sandboxing

For `Bash` tool execution:

```typescript
const SAFE_COMMANDS = new Set([
    // Package managers
    "npm", "npx", "pnpm", "yarn", "bun", "deno",
    // Build tools
    "tsc", "esbuild", "vite", "webpack", "rollup",
    // Test runners
    "vitest", "jest", "mocha", "pytest",
    // Linters
    "eslint", "prettier", "biome", "clippy",
    // VCS
    "git",
    // Languages
    "node", "python", "python3", "ruby", "go", "cargo", "rustc",
    // File ops
    "ls", "cat", "head", "tail", "wc", "find", "grep", "rg",
    "mkdir", "cp", "mv", "touch",
]);

const DANGEROUS_PATTERNS = /[;&|`$(){}!><\n\r]/;
const DANGEROUS_COMMANDS = new Set(["rm", "rmdir", "kill", "shutdown", "reboot", "dd", "mkfs"]);
```

---

## 10. Streaming & Output

### Streaming Architecture

```
LLM Provider (via Darpana)
    │
    │  SSE events (Anthropic format)
    ▼
Stream Parser
    │
    │  AgentEvent objects
    ▼
Agent Loop (accumulates + yields)
    │
    │  AgentEvent objects
    ▼
TUI Event Handler
    │
    ├── text_delta → append to message signal → MessageList re-renders
    ├── thinking_delta → append to thinking signal → ThinkingBlock re-renders
    ├── tool_start → add to active tools signal → ToolOutput re-renders
    ├── tool_end → update tool result signal → ToolOutput re-renders
    └── message_end → finalize message, update status bar signals
```

### Incremental Rendering During Stream

Key insight: during streaming, only the **last message** changes.
We don't re-render the entire message list — just append to the current message.

```typescript
// Efficient streaming render
function onTextDelta(text: string) {
    // Append to current message buffer
    currentMessage.value += text;

    // Only the last line of the message might change
    // (word wrapping can affect the last 1-2 lines)
    const lastLines = rewrapLastLines(currentMessage.value, messageWidth);
    screen.writeRegion(messageArea.bottom - lastLines.length, lastLines);
}
```

### Markdown Rendering

Markdown is rendered **after** the message is complete (or on pause during streaming):

```
Raw text → Markdown AST → Component tree → Cell grid
```

During streaming, we render raw text for speed. When the stream pauses (>200ms gap)
or ends, we re-render with full markdown formatting.

### Syntax Highlighting

Per-language tokenizers using regex-based rules:

```typescript
interface TokenRule {
    pattern: RegExp;
    type: TokenType;
}

type TokenType =
    | "keyword" | "string" | "comment" | "number"
    | "operator" | "type" | "function" | "variable"
    | "decorator" | "property" | "tag" | "attribute";
```

Languages supported at MVP:
- TypeScript / JavaScript
- Python
- Go
- Rust
- Bash / Shell
- JSON / YAML / TOML
- HTML / CSS
- Markdown (meta: highlighting code blocks within markdown)

---

## 11. Permission System

### Permission Rules

```typescript
interface PermissionRule {
    tool: string;           // Tool name or glob ("Bash", "Edit", "*")
    pattern?: string;       // Argument pattern ("npm *", "*.test.ts")
    action: "allow" | "ask" | "deny";
    scope: "once" | "session" | "project" | "global";
}
```

### Default Permissions

```typescript
const DEFAULT_PERMISSIONS: PermissionRule[] = [
    // Read-only tools: always allow
    { tool: "Read", action: "allow", scope: "global" },
    { tool: "Glob", action: "allow", scope: "global" },
    { tool: "Grep", action: "allow", scope: "global" },

    // Write tools: ask
    { tool: "Write", action: "ask", scope: "session" },
    { tool: "Edit", action: "ask", scope: "session" },

    // Bash: allow safe commands, ask for others
    { tool: "Bash", pattern: "npm *", action: "allow", scope: "session" },
    { tool: "Bash", pattern: "git status*", action: "allow", scope: "session" },
    { tool: "Bash", pattern: "git diff*", action: "allow", scope: "session" },
    { tool: "Bash", pattern: "git log*", action: "allow", scope: "session" },
    { tool: "Bash", action: "ask", scope: "session" },

    // Dangerous: deny by default
    { tool: "Bash", pattern: "rm -rf*", action: "deny", scope: "global" },
    { tool: "Bash", pattern: "git push --force*", action: "deny", scope: "global" },
];
```

### Permission Dialog

When a tool requires `ask` permission:

```
┌─────────────────────────────────────────────┐
│  ⚠ Permission Required                     │
│                                             │
│  Tool: Bash                                 │
│  Command: npm run build                     │
│                                             │
│  [y] Allow once                             │
│  [a] Allow for this session                 │
│  [n] Deny                                   │
│                                             │
│  Press y/a/n or Esc to deny                 │
└─────────────────────────────────────────────┘
```

---

## 12. Integration: Chitragupta & Darpana

### Chitragupta MCP Client

Takumi spawns chitragupta's MCP server as a child process:

```typescript
import { spawn } from "node:child_process";

const mcp = spawn("chitragupta-mcp", ["--transport", "stdio"], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, CHITRAGUPTA_PROJECT: cwd },
});

// JSON-RPC over stdio
mcp.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name: "chitragupta_memory_search", arguments: { query: "auth module" } },
    id: 1,
}));
```

### Which Chitragupta Tools Takumi Uses

| Tool | When | Why |
|------|------|-----|
| `chitragupta_memory_search` | Session start + architectural decisions | Load relevant past context |
| `chitragupta_session_list` | Session start | Show recent sessions |
| `chitragupta_session_show` | Resume session | Restore previous context |
| `chitragupta_handover` | Context compaction | Preserve work state |
| `akasha_traces` | Before major decisions | Check collective knowledge |
| `akasha_deposit` | After completing work | Record solutions + patterns |
| `vasana_tendencies` | Periodically | Adapt behavior to learned preferences |
| `health_status` | Status bar | Show system health indicator |

### Darpana Integration

Darpana is consumed as an HTTP API:

```typescript
// Health check on startup
const health = await fetch("http://localhost:8082/");
if (!health.ok) {
    // Auto-launch darpana if not running
    spawn("darpana", ["--port", "8082", "--daemon"], { detached: true, stdio: "ignore" });
}

// All LLM calls go through Darpana
const response = await fetch("http://localhost:8082/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
        model: "sonnet",  // Alias → resolved by Darpana
        messages: [...],
        max_tokens: 8192,
        stream: true,
    }),
});
```

### Fallback: Direct API

If Darpana is unavailable, Takumi can call the Anthropic API directly
using the `@anthropic-ai/sdk` package. This is the fallback path.

---

## 13. Session Management

### Session Lifecycle

```
takumi                          → New session created
│
├── Load chitragupta context    → memory_search, session_list
├── Set up system prompt        → project context + personality
│
├── User message #1             → Agent loop processes
│   ├── Tool calls              → Recorded in session
│   └── Response                → Displayed + recorded
│
├── User message #2...N
│
├── Context compaction           → When >80% context used
│   └── chitragupta_handover    → Preserve work state
│
└── Session end                  → Record final state
    └── akasha_deposit           → Record solutions/patterns
```

### Session Storage

Sessions are stored via chitragupta (not duplicated in takumi):
- Full conversation history in chitragupta's SQLite
- File modifications tracked via git diff
- Tool call results summarized

Takumi only keeps in-memory state for the current session.

### Session Resume

```bash
# Resume last session
takumi --resume

# Resume specific session
takumi --resume session-2026-02-12-abc1

# List sessions
takumi --sessions
```

---

## 14. Configuration

### Config File: `takumi.json`

```json
{
    "theme": "default",
    "model": "sonnet",
    "provider": "darpana",
    "darpana": {
        "url": "http://localhost:8082",
        "autoLaunch": true
    },
    "chitragupta": {
        "enabled": true,
        "binary": "chitragupta-mcp"
    },
    "editor": {
        "tabSize": 4,
        "wordWrap": true,
        "multiline": true
    },
    "permissions": {
        "defaultBash": "ask",
        "defaultWrite": "ask",
        "safeCommands": ["npm *", "pnpm *", "git status*"]
    },
    "sidebar": {
        "visible": true,
        "width": 30
    },
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

### Config Resolution Order

1. CLI flags (`--model`, `--port`, etc.)
2. Environment variables (`TAKUMI_MODEL`, `TAKUMI_THEME`, etc.)
3. Project config (`./takumi.json`)
4. User config (`~/.config/takumi/config.json`)
5. Defaults (hardcoded)

---

## 15. CLI Interface

### Usage

```bash
# Start interactive TUI
takumi

# Start with specific model
takumi --model opus

# Resume last session
takumi --resume

# Start with a prompt
takumi "refactor the auth module to use JWT"

# Non-interactive mode (pipe-friendly)
echo "explain this code" | takumi --print

# Show version
takumi --version
```

### Slash Commands

| Command | Description | Shortcut |
|---------|------------|----------|
| `/model` | Switch model | Ctrl+M |
| `/clear` | Clear conversation | Ctrl+L |
| `/compact` | Compact context | — |
| `/session` | Session management | Ctrl+O |
| `/diff` | Show file changes | Ctrl+D |
| `/status` | Show status | — |
| `/cost` | Show token/cost info | — |
| `/help` | Show help | Ctrl+? |
| `/quit` | Exit | Ctrl+Q |
| `/theme` | Switch theme | — |
| `/undo` | Undo last change | Ctrl+Z |
| `/memory` | Search chitragupta memory | — |
| `/permission` | Manage permissions | — |
| `/config` | Open config | — |

### @ References

```
@filename.ts        → Attach file content to message
@src/               → Attach directory listing
@filename.ts#10-20  → Attach specific line range
```

### ! Shell Commands

```
!git status         → Run command, show output
!npm test           → Run command, output becomes context
```

---

## 16. State Diagrams

### Application State Machine

```
                    ┌──────────┐
                    │  INIT    │
                    └────┬─────┘
                         │ load config, spawn MCP
                         ▼
                    ┌──────────┐
            ┌───── │  READY   │ ◄─────────────────┐
            │      └────┬─────┘                    │
            │           │ user submits message      │
            │           ▼                           │
            │      ┌──────────┐                    │
            │      │ SENDING  │                    │
            │      └────┬─────┘                    │
            │           │ stream starts             │
            │           ▼                           │
            │      ┌──────────┐    tool_use        │
   Ctrl+C   │      │STREAMING │ ──────────┐       │
   cancel   │      └────┬─────┘           │       │
            │           │                  ▼       │
            │           │          ┌────────────┐  │
            │           │          │  TOOL_EXEC │  │
            │           │          └──────┬─────┘  │
            │           │                 │        │
            │           │     ┌───────────┤        │
            │           │     │ needs     │ auto   │
            │           │     │ approval  │ allowed│
            │           │     ▼           │        │
            │           │  ┌──────────┐   │        │
            │           │  │PERMISSION│   │        │
            │           │  └────┬─────┘   │        │
            │           │       │ y/n     │        │
            │           │       ▼         │        │
            │           │  back to LLM ◄──┘        │
            │           │       │                  │
            │           │       │ end_turn         │
            │           ▼       ▼                  │
            │      ┌──────────┐                    │
            └─────►│COMPLETE  │ ───────────────────┘
                   └──────────┘   ready for next input
```

### Input Mode State Machine

```
                    ┌──────────┐
            ┌─────►│  NORMAL  │◄──── Esc (from any)
            │      └──┬─┬─┬───┘
            │         │ │ │
            │    "/" ──┘ │ └── "@"
            │         │ │         │
            │         ▼ │         ▼
            │  ┌────────┐│  ┌──────────┐
            │  │COMMAND ││  │FILE_REF  │
            │  └────┬───┘│  └────┬─────┘
            │       │    │       │
            │  Enter │    │  Enter │
            │       ▼    │       ▼
            │   execute  │   insert ref
            │       │    │       │
            └───────┘    │  ┌────┘
                         │  │
                    "!" ─┘  │
                         │  │
                         ▼  │
                  ┌────────┐│
                  │ SHELL  ││
                  └────┬───┘│
                       │    │
                  Enter │    │
                       ▼    │
                   execute  │
                       │    │
                       └────┘
```

### Renderer Pipeline State Machine

```
┌───────┐   signal    ┌────────┐   all dirty   ┌────────┐
│ IDLE  │ ──change──► │ DIRTY  │ ──collected──► │ LAYOUT │
└───▲───┘             └────────┘                └───┬────┘
    │                                               │
    │                                          yoga compute
    │                                               │
    │    ┌────────┐    diff      ┌────────┐         ▼
    └────│ FLUSH  │ ◄──done──── │ RENDER │ ◄───────┘
         └────────┘             └────────┘
              │
         write ANSI to stdout
              │
              ▼
           IDLE (wait for next signal change)
```

---

## 17. Sequence Diagrams

### User Message → LLM Response (Non-Streaming)

```
User        Editor       AgentLoop      Darpana       Provider     Chitragupta
 │            │              │              │             │              │
 │──"hello"──►│              │              │             │              │
 │            │──submit()───►│              │             │              │
 │            │              │──memory_search────────────────────────────►│
 │            │              │◄──past_context────────────────────────────│
 │            │              │──POST /v1/messages──►│             │      │
 │            │              │              │──POST /chat/completions──►│
 │            │              │              │◄──response───────────────│
 │            │              │◄──anthropic response──│             │      │
 │            │◄──display────│              │             │              │
 │◄──render───│              │              │             │              │
```

### User Message → Tool Use → Response (Streaming)

```
User    TUI         AgentLoop    Darpana    Provider    ToolExec    Permission
 │       │              │           │          │           │            │
 │──msg─►│              │           │          │           │            │
 │       │──submit()───►│           │          │           │            │
 │       │              │──stream──►│──stream─►│           │            │
 │       │              │◄─text_delta──────────│           │            │
 │       │◄─render_text─│           │          │           │            │
 │       │              │◄─text_delta──────────│           │            │
 │       │◄─render_text─│           │          │           │            │
 │       │              │◄─tool_use────────────│           │            │
 │       │              │           │          │           │            │
 │       │              │──check_permission──────────────────────────►│
 │       │◄─show_dialog─│           │          │           │            │
 │──"y"─►│              │           │          │           │            │
 │       │──allowed────►│           │          │           │            │
 │       │              │──execute─────────────────────────►│            │
 │       │◄─tool_start──│           │          │           │            │
 │       │              │◄─result──────────────────────────│            │
 │       │◄─tool_end────│           │          │           │            │
 │       │              │           │          │           │            │
 │       │              │──stream──►│──stream─►│           │            │
 │       │              │◄─text_delta──────────│           │            │
 │       │◄─render_text─│           │          │           │            │
 │       │              │◄─msg_end─────────────│           │            │
 │       │◄─finalize────│           │          │           │            │
```

### Context Compaction Flow

```
AgentLoop              TUI              Chitragupta
    │                   │                    │
    │──context >80%────►│                    │
    │                   │◄─show_warning──────│
    │                   │                    │
    │──handover()──────────────────────────►│
    │                   │                    │──save work state
    │◄──handover_result────────────────────│
    │                   │                    │
    │──summarize old turns                   │
    │──replace with summary                  │
    │──continue with compact context         │
    │                   │                    │
    │──update_status───►│                    │
    │                   │◄─render_status─────│
```

### Startup Sequence

```
CLI         Config       Chitragupta     Darpana      TUI
 │            │               │              │          │
 │──parse_args│               │              │          │
 │──load()───►│               │              │          │
 │◄─config────│               │              │          │
 │            │               │              │          │
 │──spawn_mcp─────────────────►│              │          │
 │◄─connected────────────────│              │          │
 │            │               │              │          │
 │──health_check──────────────────────────►│          │
 │◄─ok/launch───────────────────────────│          │
 │            │               │              │          │
 │──session_list──────────────►│              │          │
 │◄─sessions────────────────│              │          │
 │            │               │              │          │
 │──memory_search─────────────►│              │          │
 │◄─context──────────────────│              │          │
 │            │               │              │          │
 │──create_app───────────────────────────────────────►│
 │            │               │              │          │──init layout
 │            │               │              │          │──render first frame
 │            │               │              │          │──show prompt
 │◄───────────────────────────────────────────────────│
 │  ready                     │              │          │
```

---

## 18. Performance Targets

### Latency Budgets

| Operation | Target | Budget Breakdown |
|-----------|--------|-----------------|
| Keystroke → display | <16ms | parse: 0.1ms, signal: 0.1ms, layout: 1ms, render: 2ms, flush: 1ms |
| Full screen render | <8ms | layout: 2ms, render: 4ms, diff: 1ms, flush: 1ms |
| Stream token → display | <5ms | parse: 0.5ms, signal: 0.1ms, append: 0.5ms, flush: 1ms |
| Message submit → first token | <200ms | build: 1ms, HTTP: 50ms, LLM TTFT: ~150ms |
| Tool call start → display | <2ms | event: 0.5ms, render: 1ms, flush: 0.5ms |
| Permission dialog → display | <5ms | construct: 1ms, layout: 2ms, render: 2ms |

### Memory Budgets

| Component | Target | Notes |
|-----------|--------|-------|
| Idle memory | <50MB | Before any conversation |
| Per message (rendered) | <10KB | Cell grid for visible area only |
| Scroll buffer | <20MB | Virtual list, only visible items in memory |
| Yoga layout tree | <1MB | ~1000 nodes typical |
| Signal graph | <500KB | ~200 signals typical |

### Throughput

| Metric | Target |
|--------|--------|
| Render FPS (idle) | 0 (no unnecessary renders) |
| Render FPS (streaming) | 30-60 (adaptive) |
| Max concurrent tool calls | 8 |
| Max message history (in-memory) | 1000 messages |
| Max file size for @-reference | 1MB |

---

## 19. Security Model

### Process Isolation

```
takumi (main)
├── No network access needed (delegates to darpana)
├── File access: CWD + home config only
├── No root/sudo operations
│
├── chitragupta-mcp (child, stdio)
│   └── SQLite access: ~/.chitragupta/ only
│
├── tool: Bash (child, per-command)
│   ├── Allowlisted commands only
│   ├── No shell metacharacters
│   ├── Timeout: 120s default
│   └── Kill on cancel
│
└── darpana (separate process)
    └── API keys stay in darpana, never sent to takumi
```

### API Key Handling

- Takumi **never** sees API keys directly
- All LLM calls go through Darpana (which holds keys)
- Chitragupta MCP uses stdio (no keys needed)
- If using direct Anthropic SDK fallback, key comes from env var only

### File Access Control

- Read tools: any file in CWD tree
- Write tools: any file in CWD tree (with permission)
- No writes outside CWD without explicit permission
- `.env`, credentials files: blocked by default
- Binary files: blocked by default

---

## 20. References

### Core Technologies

1. **Yoga Layout Engine**
   - https://www.yogalayout.dev/
   - https://github.com/nicolo-ribaudo/yoga-wasm-web
   - Flexbox implementation compiled to WebAssembly

2. **ANSI Escape Codes**
   - ECMA-48: Control Functions for Coded Character Sets (5th edition, 1991)
   - https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
   - XTerm control sequences — the canonical reference

3. **Unicode Text**
   - UAX #11: East Asian Width — https://unicode.org/reports/tr11/
   - UAX #29: Text Segmentation — https://unicode.org/reports/tr29/
   - UAX #14: Line Breaking — https://unicode.org/reports/tr14/

### Reactivity & Rendering

4. **Signals Algorithm**
   - Preact Signals: https://preactjs.com/blog/signal-boosting/
   - "Primitives of Reactivity" — Ryan Carniato (SolidJS author)
   - https://dev.to/ryansolid/a-hands-on-introduction-to-fine-grained-reactivity-3ndf

5. **Terminal Rendering**
   - "Building a Terminal Emulator" — https://viewsourcecode.org/snaptoken/kilo/
   - Notcurses: high-performance TUI library (C) — https://github.com/dankamongmen/notcurses
   - Ratatui (Rust) — https://ratatui.rs/ (architecture reference)

6. **Differential Rendering**
   - Myers diff algorithm for screen buffers
   - Patience diff for code visualization
   - https://blog.jcoglan.com/2017/02/12/the-myers-diff-algorithm-part-1/

### Agent Architecture

7. **ReAct: Synergizing Reasoning and Acting in Language Models**
   - Yao et al., 2022
   - https://arxiv.org/abs/2210.03629
   - Foundation for tool-use agent loops

8. **Toolformer: Language Models Can Teach Themselves to Use Tools**
   - Schick et al., 2023
   - https://arxiv.org/abs/2302.04761
   - Self-taught tool use in LLMs

9. **Tree of Thoughts: Deliberate Problem Solving with Large Language Models**
   - Yao et al., 2023
   - https://arxiv.org/abs/2305.10601
   - Structured reasoning for complex coding tasks

10. **SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering**
    - Yang et al., 2024
    - https://arxiv.org/abs/2405.15793
    - Agent-computer interface design for coding

11. **CodeAct: Integrating Code Actions with LLM Agents**
    - Wang et al., 2024
    - https://arxiv.org/abs/2402.01030
    - Code execution as agent action space

### TUI Architecture

12. **The Elm Architecture**
    - https://guide.elm-lang.org/architecture/
    - Model-Update-View pattern used by Bubble Tea

13. **Immediate Mode GUIs**
    - "Immediate-Mode Graphical User Interfaces" — Casey Muratori, 2005
    - https://caseymuratori.com/blog_0001
    - Rendering philosophy: compute layout + draw every frame

14. **Terminal UI Best Practices**
    - "Terminals are Sexy" — terminal.sexy (theme design)
    - Charm.sh design philosophy: https://charm.sh/
    - "Why TUIs?" — https://blog.bethcodes.com/why-tui

### LLM Proxy & Routing

15. **Semantic Router: Superfast Decision Layer for LLMs**
    - https://arxiv.org/abs/2402.02575
    - Embedding-based query classification for model routing

16. **FrugalGPT: How to Use Large Language Models While Reducing Cost**
    - Chen et al., 2023
    - https://arxiv.org/abs/2305.05176
    - LLM cascade strategies — try cheap model first, escalate if needed

17. **RouteLLM: Learning to Route LLMs with Preference Data**
    - Ong et al., 2024
    - https://arxiv.org/abs/2406.18665
    - Trained router for model selection based on query difficulty

### Memory & Context

18. **MemGPT: Towards LLMs as Operating Systems**
    - Packer et al., 2023
    - https://arxiv.org/abs/2310.08560
    - Virtual context management — relevant to our compaction strategy

19. **Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks**
    - Lewis et al., 2020
    - https://arxiv.org/abs/2005.11401
    - Foundation for chitragupta's memory retrieval

### Permission & Safety

20. **Constitutional AI: Harmlessness from AI Feedback**
    - Bai et al., 2022
    - https://arxiv.org/abs/2212.08073
    - Principles for AI safety constraints

21. **Sandboxing and Workload Isolation**
    - Google gVisor architecture: https://gvisor.dev/docs/
    - Relevant to command execution sandboxing

---

## Appendix A: Naming Convention

Following the project tradition of meaningful names:

| Internal Name | Script | Meaning | Component |
|--------------|--------|---------|-----------|
| **Takumi** | 匠 | Master craftsman | The project itself |
| **Kagami** | 鏡 | Mirror | Renderer (reflects components to screen) |
| **Myaku** | 脈 | Pulse | Reactivity system (heartbeat of state changes) |
| **Shigoto** | 仕事 | Work/job | Agent loop (does the actual work) |

External-facing names use English (following Chitragupta convention):
- Package: `@takumi/core`, `@takumi/render`, `@takumi/tui`, `@takumi/agent`
- CLI command: `takumi`
- Config file: `takumi.json`

## Appendix B: Comparison with Existing Tools

| Feature | Claude Code | OpenCode | Takumi (Target) |
|---------|------------|---------|-----------------|
| Framework | React + Ink | Bubble Tea (Go) | Kagami (custom TS) |
| Render overhead | ~8ms | ~3ms | <2ms (target) |
| Layout | Yoga (via Ink) | Lipgloss | Yoga (direct) |
| Reactivity | React hooks | Elm messages | Signals (Myaku) |
| Memory | File-based | SQLite | Chitragupta (GraphRAG) |
| Provider | Anthropic only | 75+ via config | Any (via Darpana) |
| Permission | 3-tier hierarchy | Pattern-matched | Pattern-matched + scope |
| Session mgmt | File resume | SQLite + fork | Chitragupta sessions |
| Tool viz | Collapsible | 4-state lifecycle | Collapsible + streaming |
| Code highlight | Regex-based | Chroma | Regex-based (extensible) |
| Mouse support | No | Yes | Phase 2 |
| Themes | Status line only | 9 built-in | Extensible (Phase 2) |

## Appendix C: Technology Stack Summary

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Language | TypeScript | 5.7+ | Type safety, ecosystem |
| Runtime | Node.js | 22+ | LTS, native ESM |
| Package Manager | pnpm | 9+ | Workspace, strict |
| Layout | yoga-wasm-web | 0.3+ | Flexbox in WASM |
| Testing | vitest | 4+ | Fast, ESM-native |
| Linting | biome | 1.9+ | Fast, all-in-one |
| Build | tsc | 5.7+ | Simple, no bundler needed |
| LLM Access | Darpana | 0.1+ | Provider-agnostic proxy |
| Memory | Chitragupta MCP | 0.1+ | Sessions, knowledge, patterns |
