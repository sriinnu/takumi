<p align="center">
    <img src="./logo.svg" alt="Takumi logo" width="160" />
</p>

# Takumi (匠) — Architecture Diagrams

> All diagrams use Mermaid syntax. Render with any Mermaid-compatible viewer
> (GitHub, VS Code Mermaid extension, mermaid.live, etc.)

---

## 1. System Architecture — High Level

```mermaid
graph TB
    subgraph Takumi["匠 Takumi"]
        TUI["TUI Application<br/>(panels, dialogs, keybinds)"]
        Kagami["Kagami Renderer 鏡<br/>(Yoga + Signals + ANSI)"]
        Shigoto["Shigoto Agent Loop 仕事<br/>(send → stream → tool → repeat)"]
        Tools["Built-in Tools<br/>(Read, Write, Edit, Bash, Glob, Grep)"]
        Bridge["Bridge Layer<br/>(MCP client, HTTP client, Git)"]
    end

    User((User)) --> TUI
    TUI --> Kagami
    TUI --> Shigoto
    Shigoto --> Tools
    Shigoto --> Bridge

    subgraph External["External Services"]
        Darpana["Darpana दर्पण<br/>LLM Proxy<br/>localhost:8082"]
        Chitragupta["Chitragupta चित्र<br/>Memory & MCP<br/>stdio transport"]
    end

    Bridge --> Darpana
    Bridge --> Chitragupta

    subgraph Providers["LLM Providers"]
        OpenAI["OpenAI"]
        Gemini["Gemini"]
        Groq["Groq"]
        Ollama["Ollama"]
    end

    Darpana --> OpenAI
    Darpana --> Gemini
    Darpana --> Groq
    Darpana --> Ollama

    style Takumi fill:#1e1e2e,stroke:#cba6f7,color:#cdd6f4
    style External fill:#181825,stroke:#89b4fa,color:#cdd6f4
    style Providers fill:#181825,stroke:#a6e3a1,color:#cdd6f4
```

---

## 2. Application State Machine

```mermaid
stateDiagram-v2
    [*] --> INIT: launch takumi
    INIT --> READY: config loaded, MCP connected

    READY --> SENDING: user submits message
    SENDING --> STREAMING: stream starts

    STREAMING --> TOOL_EXEC: tool_use stop reason
    STREAMING --> COMPLETE: end_turn
    STREAMING --> READY: Ctrl+C cancel

    TOOL_EXEC --> PERMISSION: needs approval
    TOOL_EXEC --> STREAMING: auto allowed, result sent to LLM

    PERMISSION --> TOOL_EXEC: allowed (y or a)
    PERMISSION --> STREAMING: denied (n), error sent to LLM

    COMPLETE --> READY: ready for next input

    state INIT {
        [*] --> LoadConfig
        LoadConfig --> SpawnMCP
        SpawnMCP --> CheckDarpana
        CheckDarpana --> LoadSession
        LoadSession --> [*]
    }

    state STREAMING {
        [*] --> ReceiveDelta
        ReceiveDelta --> RenderText: text_delta
        ReceiveDelta --> RenderThinking: thinking_delta
        RenderText --> ReceiveDelta
        RenderThinking --> ReceiveDelta
        ReceiveDelta --> [*]: stop_reason received
    }
```

---

## 3. Renderer Pipeline State Machine

```mermaid
stateDiagram-v2
    [*] --> IDLE

    IDLE --> DIRTY: signal change detected
    DIRTY --> DIRTY: more signals batched
    DIRTY --> LAYOUT: microtask fires
    LAYOUT --> RENDER: Yoga positions computed
    RENDER --> DIFF: cells written to buffer
    DIFF --> FLUSH: changes found
    DIFF --> IDLE: no changes (skip)
    FLUSH --> IDLE: ANSI written to stdout

    note right of DIRTY: Collect all dirty components\nin a single microtask batch
    note right of LAYOUT: Yoga WASM calculates\nflexbox positions and sizes
    note right of DIFF: Compare current vs previous\nscreen buffer cell by cell
```

---

## 4. Agent Loop Sequence Diagram

```mermaid
sequenceDiagram
    participant U as User
    participant TUI as Takumi TUI
    participant Agent as Agent Loop (Shigoto)
    participant D as Darpana
    participant P as LLM Provider
    participant C as Chitragupta MCP

    Note over TUI: === STARTUP ===
    TUI->>C: spawn chitragupta-mcp (stdio)
    C-->>TUI: connected
    TUI->>D: GET / (health check)
    D-->>TUI: status ok
    TUI->>C: memory_search(current task)
    C-->>TUI: relevant past context

    Note over U,TUI: === USER MESSAGE ===
    U->>TUI: "refactor auth module"
    TUI->>Agent: submit(message)
    Agent->>D: POST /v1/messages (stream=true)
    D->>P: POST /chat/completions (stream)

    loop SSE Streaming
        P-->>D: SSE chunk (text delta)
        D-->>Agent: Anthropic SSE event
        Agent-->>TUI: AgentEvent(text_delta)
        TUI-->>U: render incremental text
    end

    Note over Agent: === TOOL USE ===
    P-->>D: SSE chunk (tool_use, stop)
    D-->>Agent: tool_use event
    Agent-->>TUI: AgentEvent(tool_start: Read)
    TUI-->>U: show tool card (spinner)

    Agent->>Agent: execute Read tool
    Agent-->>TUI: AgentEvent(tool_end: result)
    TUI-->>U: update tool card (done)

    Note over Agent: === CONTINUE WITH TOOL RESULT ===
    Agent->>D: POST /v1/messages (tool result)
    D->>P: POST /chat/completions (stream)

    loop SSE Streaming
        P-->>D: SSE chunk
        D-->>Agent: event
        Agent-->>TUI: AgentEvent(text_delta)
        TUI-->>U: render text
    end

    Agent-->>TUI: AgentEvent(message_end)
    TUI->>C: akasha_deposit(solution)
    TUI-->>U: prompt ready (匠>)
```

---

## 5. Input Mode State Machine

```mermaid
stateDiagram-v2
    [*] --> NORMAL

    NORMAL --> SLASH_CMD: types "/"
    NORMAL --> FILE_REF: types "@"
    NORMAL --> SHELL_CMD: types "!"
    NORMAL --> DIALOG: Ctrl+K

    SLASH_CMD --> NORMAL: Esc
    SLASH_CMD --> NORMAL: Enter (execute cmd)

    FILE_REF --> NORMAL: Esc
    FILE_REF --> NORMAL: Enter (insert ref)

    SHELL_CMD --> NORMAL: Esc
    SHELL_CMD --> NORMAL: Enter (run command)

    DIALOG --> NORMAL: Esc
    DIALOG --> NORMAL: Enter (select item)

    state NORMAL {
        [*] --> Typing
        Typing --> Typing: printable chars
        Typing --> Submit: Enter
        Submit --> [*]
    }

    state SLASH_CMD {
        [*] --> Filtering
        Filtering --> Filtering: type to filter
        Filtering --> TabComplete: Tab
        TabComplete --> Filtering
    }

    state FILE_REF {
        [*] --> FuzzySearch
        FuzzySearch --> FuzzySearch: type to narrow
        FuzzySearch --> Preview: highlight file
    }

    state DIALOG {
        [*] --> Navigate
        Navigate --> Navigate: arrow keys
        Navigate --> Search: type to filter
        Search --> Navigate
    }
```

---

## 6. TUI Layout Structure

```mermaid
graph TB
    subgraph Root["Root Layout (100% x 100%)"]
        direction TB
        subgraph Header["Header Bar (h=1)"]
            Logo["匠 takumi"]
            Model["claude-sonnet-4"]
            Branch["main*"]
            Session["session-2026-02-12"]
        end

        subgraph Main["Main Area (flex-grow=1)"]
            direction LR
            subgraph Messages["Message List (flex-grow=1)"]
                M1["👤 User: refactor auth..."]
                M2["🤖 Assistant: I'll help..."]
                T1["⚙ Read src/auth.ts (23ms)"]
                M3["🤖 Here's the plan..."]
            end
            subgraph Sidebar["Sidebar (w=30)"]
                Files["Modified Files:<br/>src/auth.ts<br/>src/jwt.ts"]
                Info["Session: 5 turns<br/>Tokens: 12.4K<br/>Cost: $0.04"]
            end
        end

        subgraph Input["Editor (h=3)"]
            Prompt["匠> |"]
        end

        subgraph Status["Status Bar (h=1)"]
            SModel["sonnet"]
            Tokens["12.4K tokens"]
            Cost["$0.04"]
            Context["62% context"]
            GitB["main*"]
        end
    end

    style Root fill:#1e1e2e,stroke:#585b70,color:#cdd6f4
    style Header fill:#181825,stroke:#585b70,color:#bac2de
    style Main fill:#1e1e2e,stroke:#585b70,color:#cdd6f4
    style Messages fill:#1e1e2e,stroke:#45475a,color:#cdd6f4
    style Sidebar fill:#181825,stroke:#45475a,color:#bac2de
    style Input fill:#181825,stroke:#cba6f7,color:#cdd6f4
    style Status fill:#11111b,stroke:#585b70,color:#a6adc8
```

---

## 7. Permission Flow

```mermaid
sequenceDiagram
    participant Agent as Agent Loop
    participant Perm as Permission Engine
    participant TUI as TUI
    participant User as User

    Agent->>Perm: check(tool=Bash, cmd="npm test")

    alt Matches allow rule
        Perm-->>Agent: ALLOWED
        Agent->>Agent: execute tool
    else Matches deny rule
        Perm-->>Agent: DENIED
        Agent->>Agent: return error to LLM
    else Matches ask rule
        Perm-->>Agent: ASK
        Agent->>TUI: show permission dialog
        TUI->>User: display tool + args

        alt User presses y
            User->>TUI: allow once
            TUI->>Agent: ALLOWED (scope=once)
        else User presses a
            User->>TUI: allow for session
            TUI->>Perm: addRule(allow, scope=session)
            TUI->>Agent: ALLOWED (scope=session)
        else User presses n or Esc
            User->>TUI: deny
            TUI->>Agent: DENIED
        end
    end
```

---

## 8. Context Compaction Flow

```mermaid
sequenceDiagram
    participant Agent as Agent Loop
    participant Context as Context Manager
    participant TUI as TUI
    participant C as Chitragupta MCP

    Agent->>Context: checkUsage()
    Context-->>Agent: 82% (above threshold)

    Agent->>TUI: show compaction warning
    Agent->>C: chitragupta_handover()
    C-->>Agent: work state saved

    Agent->>Context: compact(keep=10 recent turns)
    Context->>Context: summarize turns 1..N-10
    Context->>Context: replace with summary message
    Context-->>Agent: compacted (82% → 35%)

    Agent->>TUI: update context % in status bar
```

---

## 9. Package Dependency Graph

```mermaid
graph LR
    Core["@takumi/core<br/>(types, config, logger)"]
    Render["@takumi/render<br/>(Yoga, signals, ANSI)"]
    Agent["@takumi/agent<br/>(loop, tools, safety)"]
    Bridge["@takumi/bridge<br/>(MCP, HTTP, git)"]
    TUI["@takumi/tui<br/>(app, panels, dialogs)"]
    Bin["bin/takumi.ts<br/>(CLI entry)"]

    Core --> Render
    Core --> Agent
    Core --> Bridge
    Render --> TUI
    Agent --> TUI
    Bridge --> TUI
    TUI --> Bin

    Yoga["yoga-wasm-web"] -.-> Render

    style Core fill:#cba6f7,stroke:#1e1e2e,color:#1e1e2e
    style Render fill:#89b4fa,stroke:#1e1e2e,color:#1e1e2e
    style Agent fill:#a6e3a1,stroke:#1e1e2e,color:#1e1e2e
    style Bridge fill:#f9e2af,stroke:#1e1e2e,color:#1e1e2e
    style TUI fill:#f38ba8,stroke:#1e1e2e,color:#1e1e2e
    style Bin fill:#fab387,stroke:#1e1e2e,color:#1e1e2e
```

---

## 10. Startup Sequence

```mermaid
sequenceDiagram
    participant CLI as bin/takumi.ts
    participant Config as Config Loader
    participant Bridge as Bridge Layer
    participant C as Chitragupta MCP
    participant D as Darpana
    participant TUI as TUI App
    participant Screen as Kagami Renderer

    CLI->>Config: parseArgs + loadConfig()
    Config-->>CLI: TakumiConfig

    CLI->>Bridge: initChitragupta()
    Bridge->>C: spawn(stdio)
    C-->>Bridge: JSON-RPC ready
    Bridge-->>CLI: MCP connected

    CLI->>Bridge: initDarpana()
    Bridge->>D: GET / (health)
    alt Darpana running
        D-->>Bridge: ok
    else Not running
        Bridge->>D: spawn darpana --daemon
        D-->>Bridge: started
    end
    Bridge-->>CLI: Darpana ready

    CLI->>Bridge: loadSession()
    Bridge->>C: session_list()
    C-->>Bridge: recent sessions
    Bridge->>C: memory_search(project context)
    C-->>Bridge: relevant memories

    CLI->>TUI: createApp(config, bridges)
    TUI->>Screen: initScreen(width, height)
    Screen-->>TUI: double buffer ready

    TUI->>TUI: buildLayout()
    TUI->>Screen: renderFirstFrame()
    Screen-->>TUI: ANSI output

    TUI-->>CLI: ready
    Note over TUI: 匠> prompt shown
```

---

## 11. Signal Reactivity Data Flow

```mermaid
graph TD
    subgraph Signals["Myaku Signal Graph"]
        Input["inputBuffer<br/>signal('')"]
        Messages["messages<br/>signal([])"]
        Tokens["tokenCount<br/>signal(0)"]
        Cost["cost<br/>computed(tokens * rate)"]
        ContextPct["contextPct<br/>computed(tokens / max)"]
        StatusText["statusText<br/>computed(format)"]
    end

    subgraph Components["Subscribed Components"]
        Editor["Editor Panel"]
        MsgList["Message List"]
        StatusBar["Status Bar"]
    end

    Input -->|"subscribes"| Editor
    Messages -->|"subscribes"| MsgList
    Tokens --> Cost
    Tokens --> ContextPct
    Cost --> StatusText
    ContextPct --> StatusText
    StatusText -->|"subscribes"| StatusBar

    subgraph Render["Render Cycle"]
        Dirty["Dirty Set"]
        Layout["Yoga Layout"]
        Paint["Paint Cells"]
        Diff["Diff Buffers"]
        Flush["ANSI Output"]
    end

    Editor -->|"markDirty()"| Dirty
    MsgList -->|"markDirty()"| Dirty
    StatusBar -->|"markDirty()"| Dirty
    Dirty --> Layout --> Paint --> Diff --> Flush

    style Signals fill:#1e1e2e,stroke:#cba6f7,color:#cdd6f4
    style Components fill:#1e1e2e,stroke:#89b4fa,color:#cdd6f4
    style Render fill:#1e1e2e,stroke:#a6e3a1,color:#cdd6f4
```

---

## 12. Tool Execution Pipeline

```mermaid
flowchart TD
    A["LLM returns tool_use"] --> B{"Parse tool call"}
    B --> C{"Tool registered?"}
    C -->|No| D["Return error to LLM"]
    C -->|Yes| E{"Check permissions"}

    E -->|deny| D
    E -->|allow| G["Execute tool"]
    E -->|ask| F["Show permission dialog"]

    F -->|y: once| G
    F -->|a: session| H["Add session rule"]
    H --> G
    F -->|n: deny| D

    G --> I{"Tool type?"}
    I -->|Read/Glob/Grep| J["File system read"]
    I -->|Write/Edit| K["File system write"]
    I -->|Bash| L{"Sandbox check"}
    I -->|Ask| M["User prompt"]
    I -->|MCP| N["Forward to MCP"]

    L -->|safe| O["Execute command"]
    L -->|dangerous| D

    J --> P["Return result to LLM"]
    K --> P
    O --> P
    M --> P
    N --> P

    style A fill:#cba6f7,stroke:#1e1e2e,color:#1e1e2e
    style D fill:#f38ba8,stroke:#1e1e2e,color:#1e1e2e
    style G fill:#a6e3a1,stroke:#1e1e2e,color:#1e1e2e
    style P fill:#89b4fa,stroke:#1e1e2e,color:#1e1e2e
```
