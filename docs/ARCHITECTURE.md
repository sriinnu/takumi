<p align="center">
  <img src="./logo.svg" alt="Takumi logo" width="160" />
</p>

# Architecture — Takumi (匠)

> High-level architecture of the Takumi terminal coding agent.

> Status note: this document mixes **current implementation** with **target architecture direction**. When a section says “should”, read it as intent rather than a claim that the migration is already complete.

## Overview

Takumi is a **terminal-native AI coding agent** built from scratch in TypeScript.
It owns the full rendering stack (no React/Ink dependency), speaks to LLMs via a
provider-agnostic abstraction, and integrates with Chitragupta for persistent
memory and session management.

On `main` today, the system is in a **hybrid state**:

- Takumi already has direct provider integrations and optional Darpana proxying.
- Chitragupta already participates as the daemon-first memory/control-plane bridge.
- The stronger model where Chitragupta fully owns more routing/auth authority is underway, but not complete.

The important authority boundary is:

- **Chitragupta is the emerging integration control plane**
- **Takumi is a privileged consumer and coding executor**
- **Vaayu is a consumer-facing UX layer**
- **Scarlett is the integrity and health observer across the plane**

Takumi may perform specialized coding behavior, but it is **not** the sovereign
owner of durable routing, auth, provider inventory, or long-lived memory.

## System Roles

| System | Role |
|---|---|
| Chitragupta | Owns provider registry, CLI registry, routing policy, credential references, health view, and canonical session/memory hooks |
| Takumi | Consumes engine capabilities, executes coding-specific loops, reports observations back to the engine |
| Vaayu | Consumes engine capabilities and renders user-facing controls / interaction UX |
| Scarlett | Monitors provider, CLI, bridge, auth, session, and memory integrity across the system |

### Authority split

Current implementation reality:

- Chitragupta already owns daemon-side memory, observations, prediction, health/status, and control-plane query surfaces.
- Takumi still constructs providers and handles several auth paths locally.
- Routing/capability surfaces now exist, but the full inversion of authority is still in progress.

| Concern | Owner |
|---|---|
| provider registry | Chitragupta |
| CLI integration registry | Chitragupta |
| routing policy | Chitragupta |
| auth / credential references | Chitragupta |
| health / cost / availability | Chitragupta |
| user-facing controls | Takumi / Vaayu |
| specialized execution behavior | Takumi |
| integrity monitoring | Scarlett |

### Consumer model

Consumers should ask for **capabilities**, not vendors.

Examples:

| Consumer ask | Engine resolves |
|---|---|
| `coding.patch-and-validate` | local CLI, Takumi executor, local model, or cloud model depending on policy and health |
| `chat.high-reliability` | best-fit conversational lane under trust, budget, and availability policy |
| `classification.local-fast` | deterministic logic, local classifier, or minimal-cost local lane |

That keeps the system from splitting into separate routing brains per app.

## Extensions

Takumi is a first-class extension host. The extension system is **implemented** in `@takumi/agent` (Phase 42+) and provides:

- typed event subscription across session, agent-loop, tool, and multi-agent cluster lifecycles
- side-tool registration (tools the LLM can call, contributed by extensions)
- slash command and keyboard shortcut registration
- cancellable / result-returning hooks on key lifecycle transitions

### Extension entry points

Extensions are discovered and loaded from:

- `<cwd>/.takumi/extensions/`
- `~/.config/takumi/extensions/`
- package-provided extensions declared in `takumi.config.json`
- explicitly configured `extensions` paths in config

Each extension exports a factory function matching `ExtensionFactory`:

```ts
import type { ExtensionAPI } from "@takumi/agent";

export default function myExtension(api: ExtensionAPI): void {
  api.on("turn_end", (e, ctx) => {
    // e.usage.inputTokens, e.usage.outputTokens, ctx.model, ...
  });

  api.registerTool({
    name: "my_tool",
    description: "...",
    inputSchema: { ... },
    execute: async (args, signal, ctx) => ({ output: "..." })
  });

  api.registerCommand("/my-cmd", {
    description: "does a thing",
    handler: async (args, ctx) => { ... }
  });
}
```

### ExtensionAPI surface

| Method | Purpose |
|---|---|
| `on(event, handler)` | Subscribe to a typed lifecycle event |
| `registerTool(def)` | Contribute a tool the LLM can call |
| `registerCommand(name, opts)` | Register a `/slash-command` |
| `registerShortcut(key, opts)` | Register a keyboard shortcut |
| `sendUserMessage(text)` | Inject a user turn into the agent loop |
| `getActiveTools()` | List currently enabled tool names |
| `setActiveTools(names)` | Enable/disable tools for the session |
| `exec(cmd, args?)` | Run a shell command from the extension |

Handlers receive an `ExtensionContext` (read-only session state + `abort()`, `compact()`, `shutdown()`). Command handlers additionally receive `ExtensionCommandContext` which adds `waitForIdle()`, `newSession()`, and `switchSession()`.

### Event categories

**Session events** — lifecycle of the TUI session:

| Event | Cancellable | Description |
|---|---|---|
| `session_start` | — | Session loaded |
| `session_before_switch` | ✓ | Before switching to another session |
| `session_switch` | — | After session switch completes |
| `session_before_compact` | ✓ (supply custom summary) | Before context compaction |
| `session_compact` | — | After compaction |
| `session_shutdown` | — | Process exiting |

**Agent loop events** — per-turn LLM interaction:

| Event | Modifiable | Description |
|---|---|---|
| `context` | ✓ (replace messages) | Before each LLM call |
| `before_agent_start` | ✓ (replace system prompt, inject message) | After user submits, before loop starts |
| `agent_start` | — | Loop begins |
| `agent_end` | — | Loop ends |
| `turn_start` | — | Turn index + timestamp |
| `turn_end` | — | Token usage for the turn |
| `message_update` | — | Streaming delta from LLM |

**Tool events** — around each tool execution:

| Event | Modifiable | Description |
|---|---|---|
| `tool_call` | ✓ (block with reason) | Before a tool runs |
| `tool_result` | ✓ (rewrite output) | After a tool returns |

**Other events:**

| Event | Description |
|---|---|
| `model_select` | Model changed (source: `set`, `cycle`, `restore`, `failover`) |
| `input` | User input received; handler can `transform` or mark as `handled` |

**Cluster events** — multi-agent orchestration (Phase 42–44):

| Event | Description |
|---|---|
| `cluster_start` | Cluster spawned with topology and agent count |
| `cluster_end` | Cluster finished (success/failure, duration, total tokens) |
| `cluster_phase_change` | Transition between orchestration phases |
| `cluster_topology_adapt` | Lucy/Scarlett rerouted the active topology mid-run |
| `cluster_validation_attempt` | Per-validation-cycle conclusion (approvals, rejections, decision) |
| `cluster_budget` | Token spend crossed `warning` or `exceeded` threshold |
| `agent_spawn` | Individual agent spawned within the cluster |
| `agent_message` | Message published on the inter-agent bus |
| `agent_complete` | Individual agent finished |
| `agent_profile_updated` | Capability profiles persisted after the run |
| `sabha_escalation` | Weak consensus triggered a Sabha escalation attempt |

### Implementation files

| File | Role |
|---|---|
| `packages/agent/src/extensions/extension-types.ts` | Full `ExtensionAPI`, all event interfaces, context types, result types |
| `packages/agent/src/extensions/cluster-events.ts` | Cluster and multi-agent event interfaces and `ClusterExtensionEvent` union |
| `packages/agent/src/extensions/extension-loader-types.ts` | `ExtensionFactory`, `LoadedExtension`, `LoadExtensionsResult`, `ExtensionError` — loader meta-types |
| `packages/tui/src/agent-runner.ts` | `emitExtensionEvent()` bridge — forwards events from `CodingAgent` to `ExtensionRunner` |

### Authority boundary

Rule: put Takumi-specific behavior in Takumi extensions; put engine-wide policy, memory, and authority in Chitragupta.

Chitragupta should **not** push consumer-local behavior into the engine. The engine owns:

- durable memory and canonical session truth
- bridge auth, provider and CLI inventory, routing policy
- Scarlett integrity and Lucy intuition as engine faculties

## Ecosystem innovation direction

Takumi should not stop at "extensions" in the old editor-plugin sense.

The more ambitious model is a **governed workflow ecosystem**:

| Layer | Role |
|---|---|
| skills | reusable review / coding / planning behavior |
| tool adapters | executable integrations and MCP-backed capabilities |
| policy bundles | tool rules, trust defaults, and guardrails |
| orchestration packs | planner / validator / routing strategies |
| eval packs | replayable checks, scorecards, and hidden-benchmark coverage |

That is how Takumi goes beyond Pi: not by copying a marketplace UI, but by
building a package economy with provenance, compatibility, evaluation, and
promotion / quarantine semantics.

### Package governance model

Takumi packages now have room for governance metadata alongside resources:

- provenance tier (`builtin`, `verified`, `community`, `local`)
- semantic capability requests
- compatibility against Takumi and package API generations
- evaluation coverage metadata
- maintainer ownership

The intended lifecycle is:

1. discover
2. inspect
3. validate
4. scaffold
5. verify
6. evaluate
7. activate or quarantine
8. promote or publish

This keeps Takumi innovative on the app/runtime side without violating the
authority boundary where Chitragupta still owns durable routing, auth, and
integration sovereignty.

## P2P mesh agent concept

Takumi should grow beyond a simple planner → worker → validator tree.
The stronger long-term model is a **bounded peer-to-peer execution mesh**.

Important nuance: this is **not** a fully sovereign decentralized swarm.
The mesh is **execution-local and ephemeral**. Chitragupta still owns the
control plane.

### What “mesh” means here

In Takumi, a mesh means agents can exchange:

- intermediate hypotheses
- file-level observations
- validator challenges
- confidence scores
- repair suggestions

without routing every small judgment back through a single planner node.

That creates a topology closer to a workshop council than a command chain:

- planners can broadcast strategy
- workers can ask validators for early challenge
- validators can challenge each other
- specialist peers can publish partial findings into a shared working fabric

The result is faster convergence, better adversarial checking, and less planner
fragility.

### Bounded, not anarchic

The mesh must stay bounded by four rules:

1. **Authority remains centralized**
  - Chitragupta owns routing, durable memory, trust, identity, auth, and
    policy.
2. **Mesh state is ephemeral**
  - peer exchange is runtime state, not canonical truth.
3. **Promotion requires adjudication**
  - only promoted conclusions enter durable memory, package governance, or
    final output.
4. **Integrity can override speed**
  - Scarlett-style findings can slow, quarantine, or collapse the mesh.

### Mesh layers

| Layer | Role |
|---|---|
| transport mesh | peer-to-peer exchange of claims, challenges, and local evidence |
| deliberation mesh | debate, consensus, and counterfactual pressure among roles |
| memory spine | Chitragupta-mediated persistence of only promoted outcomes |
| integrity overlay | Scarlett monitoring for drift, loops, or compromised peers |

### Mesh roles

Takumi's current role system already points in this direction. In a richer mesh,
roles become communication personalities rather than fixed pipeline steps:

| Role type | Mesh behavior |
|---|---|
| planner | sets intent, constraints, decomposition, and stopping conditions |
| worker | explores candidate implementations and local fixes |
| validator | attacks assumptions and scores correctness from a discipline-specific lens |
| critic | injects counterfactuals, edge cases, and ambiguity pressure |
| librarian | recalls prior Akasha / package / repo knowledge into the mesh |
| governor | applies policy, budget, and trust constraints before promotion |

Not every run needs every role. The mesh should be elastic: tiny for simple
tasks, dense for high-risk tasks.

### Mesh operating modes

| Mode | Shape | Best for |
|---|---|---|
| spoke | planner-centered | routine tasks, low coordination overhead |
| council | peers deliberate in rounds | medium ambiguity, architecture choices |
| swarm | broad parallel exploration | discovery, search, variant generation |
| adversarial mesh | validators challenge workers continuously | security, migration, correctness-critical work |
| healing mesh | failing peers get replaced or quarantined | degraded or unstable runs |

Takumi should select these topologies intentionally, not accidentally.

## Lucy concepts

Lucy is best understood as the **cognitive doctrine** behind Takumi +
Chitragupta cooperation. She is not one more agent role inside the mesh. She is
the model for how capability matures.

### Lucy levels

| Level | Name | Meaning in Takumi |
|---|---|---|
| L1 | reflex | extensions, tool hooks, event handlers, immediate reactions |
| L2 | learn | observation capture, pattern accumulation, preference memory |
| L3 | evolve | self-authoring, strategy adaptation, configuration mutation |
| L4 | intuition | predictions, likely-next actions, likely-failure warnings |
| L5 | self-heal | anomaly response, quarantine, rollback, mesh repair |

### Lucy in a mesh architecture

Lucy gives the mesh a progression path:

- **L1 reflex** keeps peers responsive
- **L2 learn** turns repeated mesh behavior into reusable patterns
- **L3 evolve** lets the system generate new extensions, tools, or orchestration habits
- **L4 intuition** lets peers act on likely-next-state predictions before failure happens
- **L5 self-heal** lets the mesh recover from instability without human micromanagement

Without Lucy, a mesh is just parallelism.
With Lucy, the mesh becomes cumulative cognition.

### Lucy split across the plane

| Faculty | Primary home |
|---|---|
| reflex execution | Takumi runtime |
| observation memory | Chitragupta |
| patterning and prediction | Chitragupta |
| self-authoring and local adaptation | Takumi |
| healing decisions | shared — Scarlett can force guardrails, Takumi can execute repairs |

That split matters. Lucy should emerge from the cooperation of runtime and
control plane, not from shoving every cognitive function into one process.

## Scarlett concepts

Scarlett is the **integrity doctrine** of the system.
If Lucy asks “how can the system become more capable?”, Scarlett asks “how do we
know the system is still trustworthy while doing that?”

### Scarlett responsibilities

- detect bridge or capability degradation
- detect auth drift and routing anomalies
- detect repetitive failure loops
- detect cost or context pressure anomalies
- detect compromised or low-trust mesh participants
- force escalation, slowdown, quarantine, or stop conditions

### Scarlett in a mesh

In a peer mesh, Scarlett becomes more important, not less.
Peer autonomy creates new failure classes:

- echo chambers
- false consensus
- runaway retries
- cheap-but-wrong routing cascades
- cross-peer contamination of bad assumptions

Scarlett should therefore behave like an immune system layered above the mesh:

- score peer health
- flag degraded nodes
- isolate suspicious peers
- reduce mesh breadth when instability rises
- require stronger consensus before promotion during degraded operation

### Lucy and Scarlett together

Lucy without Scarlett becomes reckless adaptation.
Scarlett without Lucy becomes sterile caution.

Takumi should treat them as paired faculties:

| Faculty pair | Function |
|---|---|
| Lucy learns | Scarlett verifies |
| Lucy predicts | Scarlett sanity-checks |
| Lucy evolves | Scarlett quarantines bad evolution |
| Lucy heals | Scarlett judges whether the heal actually worked |

## Mesh + Lucy + Scarlett operating model

The strongest Takumi-native concept is this:

1. **Chitragupta convenes and remembers**
2. **Takumi executes through a bounded peer mesh**
3. **Lucy turns repeated experience into better behavior**
4. **Scarlett prevents capability growth from destroying trust**

That gives Takumi a path beyond a normal coding agent:

- not a single assistant
- not an ungoverned swarm
- but a **governed cognitive workshop**

## Future architecture implications

If Takumi continues in this direction, the mesh concept suggests future work in:

- peer-to-peer challenge and rebuttal protocols between agent roles
- mesh-scoped ephemeral memory separate from canonical Akasha memory
- promotion gates from mesh consensus into durable memory
- Scarlett integrity scoring per peer and per topology
- Lucy-driven topology adaptation: spoke → council → adversarial mesh → healing mesh
- Sabha-backed escalation when mesh consensus is weak or integrity is degraded

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
├── chitragupta daemon socket          ← primary control-plane path (authenticated, fast path)
├── chitragupta-mcp (child, stdio)     ← fallback bridge when daemon socket is unavailable
├── darpana (HTTP, localhost:8082)     ← LLM proxy (external or auto-launched)
└── tool subprocesses (bash, git)      ← short-lived, sandboxed
```

Takumi is now **daemon-first** for Chitragupta integration. It probes the local
daemon socket, performs `auth.handshake` with the shared bridge token, and only
falls back to spawning `chitragupta-mcp` over stdio when the daemon path is not
available. Darpana runs as a separate daemon. Tool subprocesses are ephemeral
and sandboxed.

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
- **bridge** — Depends on `core`. Integration layer: Chitragupta daemon-first socket client with stdio fallback,
  control-plane types, Darpana HTTP health check / auto-launch, and Git operations (status, branch, diff, commit).
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

### Extension System

The extension host implemented in `@takumi/agent` (Phase 42+). See the [Extensions](#extensions) section for the full event reference.

| Module | Role |
|--------|------|
| `extensions/extension-types.ts` | `ExtensionAPI`, all event interfaces, context and result types |
| `extensions/cluster-events.ts` | Cluster-tier events — 11-member `ClusterExtensionEvent` union |
| `extensions/extension-loader-types.ts` | Loader meta-types (`ExtensionFactory`, `LoadedExtension`, etc.) |
| `extensions/extension-runner.ts` | Dispatches events to registered handlers in load order |
| `extensions/extension-loader.ts` | Discovers and dynamically imports extension packages |

### Bridge — Integration Layer

| Module | Role |
|--------|------|
| `chitragupta.ts` | daemon-first bridge — authenticated Unix socket fast path, MCP stdio fallback |
| `darpana.ts` | HTTP health check, auto-launch, connection management |
| `git.ts` | Git operations: status, branch detection, diff, commit |

Takumi's bridge is intentionally **consumer-oriented**, not a second control plane.
It should:

- forward session and task context
- request capabilities and engine decisions
- consume predictions, memory recall, and push notifications
- report observations, heal outcomes, and preference signals back upstream

The TUI now also derives a **Scarlett-style integrity view** from control-plane
capabilities, capability-health snapshots, routing traces, anomaly alerts, and
bridge connectivity. That gives Takumi a concrete runtime surface for integrity
monitoring without turning Takumi itself into the control plane.

It should **not** become:

- a second provider registry
- a second credential broker
- a second routing engine
- a second source of truth for external health

#### Bridge contract

| Direction | Methods |
|---|---|
| Takumi → Chitragupta | `session.create`, `turn.add`, `observe.batch`, `heal.report`, `preference.update` |
| Chitragupta → Takumi | `prediction`, `pattern_detected`, `anomaly_alert`, `heal_reported`, `sabha.consult`, `preference_update` |
| Shared | `bridge.info`, `capabilities`, `route.resolve`, `health.status` |

For the longer-term engine-owned integration model, see [control-plane-spec.md](./control-plane-spec.md).

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
3. Probe Chitragupta daemon socket
4. Perform `auth.handshake` with the shared bridge token on the socket path
5. Fall back to spawning `chitragupta-mcp` over stdio only if the daemon path is unavailable
6. Health-check Darpana (auto-launch if needed)
7. Load session history from Chitragupta
8. Initialize Yoga WASM
9. Create `TakumiApp` — root view, keybinds, slash commands, state
10. Enter alternate screen, hide cursor, enable raw mode / mouse / bracketed paste
11. Start render scheduler — first frame rendered
12. Ready for user input

## Security Model

- **API keys may be used directly by Takumi** when direct providers are enabled; they may also be routed through Darpana when proxy mode is configured.
- **File access** is restricted to the working tree; sensitive files such as `.env` and credential-like paths are guarded.
- **Bash tool** execution is sandboxed with allowlist and permission gates.
- **Permission engine** supports scoped decisions such as one-off and session-level approvals.
- **Process isolation** separates the TUI runtime, Chitragupta bridge path, and short-lived tool subprocesses.

If you want the target end-state for provider/auth/control-plane ownership, read [`control-plane-spec.md`](./control-plane-spec.md) as the intended direction rather than the already-complete state.

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
