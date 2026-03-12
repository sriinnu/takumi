# Takumi Executor Backlog — Implementation Note

This note maps the original Takumi-side executor backlog bullets to the exact
code that now satisfies them, plus the places where the work is intentionally
partial or staged.

It is meant to answer a practical question:

> “Which code actually implements each backlog requirement?”

## Scope

This note covers the backlog items that drove the executor retrofit work:

1. consume engine-owned route envelopes, not single route hints
2. enforce the envelope during execution
3. bind every Takumi run to canonical Chitragupta sessions
4. report structured artifacts back to the hub
5. make slash commands hub-aware
6. participate in Sabha as a true executor peer
7. keep local sovereignty only where it belongs
8. use engine-owned packing/compression everywhere
9. expose a stable headless execution contract
10. prepare for post-run policy checks

## 1. Consume engine-owned route envelopes, not single route hints

### Delivered code

- `packages/bridge/src/control-plane.ts`
  - `ExecutionLaneAuthority`
  - `ExecutionLaneEnforcement`
  - `ExecutionLaneEnvelope`
- `packages/agent/src/task-routing.ts`
  - `RoutingOverridePlan.laneEnvelopes`
  - `resolveRoutingOverrides(...)`
  - `resolveConcreteModel(...)`
  - `buildLaneEnvelope(...)`
- `packages/tui/src/coding-agent-routing.ts`
  - legacy routing path now also returns `laneEnvelopes`

### What changed

Takumi no longer treats engine routing as only “pick this model if possible”.
It now preserves the routing decision as a durable executor-side envelope with:

- capability
- authority (`engine` vs `takumi-fallback`)
- enforcement mode
- selected capability id
- selected provider family / model
- fallback model
- applied model
- degraded / policy trace information

### Why this satisfies the backlog

This is the core migration from flattened routing hints to route-envelope-aware
execution planning.

## 2. Enforce the envelope during execution

### Delivered code

- `packages/agent/src/task-routing.ts`
  - `resolveConcreteModel(...)` enforces same-provider model application rules
- `packages/tui/src/coding-agent-routing.ts`
  - legacy route application only accepts same-provider overrides
- `bin/cli/one-shot.ts`
  - `resolveExecRouting(...)`
  - engine-routed model is applied only when provider-family constraints are safe
  - routing binding records:
    - `authority`
    - `enforcement`
    - `laneId`
    - `degraded`
- `packages/core/src/exec-protocol.ts`
  - `ExecRoutingBinding.authority`
  - `ExecRoutingBinding.enforcement`

### What changed

Takumi now enforces route decisions as execution-time constraints, not just as
pre-run suggestions. In particular, engine-selected models are only applied when
they are compatible with the active provider family; otherwise Takumi records a
fallback rather than silently pretending the engine choice was used.

### Why this satisfies the backlog

The route envelope is now honored through execution binding semantics rather
than disappearing after planning.

## 3. Bind every Takumi run to canonical Chitragupta sessions

### Delivered code

- `packages/tui/src/chitragupta-executor-runtime.ts`
  - `getBoundSessionId(...)`
  - `ensureCanonicalSessionBinding(...)`
- `packages/tui/src/app-chitragupta.ts`
  - binds canonical session on connect
  - uses bound session ids in heal/report flows
- `packages/tui/src/agent-runner.ts`
  - observation collector uses `getBoundSessionId(...)`
- `packages/tui/src/coding-agent.ts`
  - binds canonical session before starting a coding run
- `bin/cli/one-shot.ts`
  - `ensureExecCanonicalSession(...)`
  - `persistExecSession(...)`
- `packages/tui/src/state.ts`
  - `canonicalSessionId`

### What changed

Takumi no longer relies only on local runtime session ids. TUI runs and headless
exec runs now prefer a canonical Chitragupta session binding whenever the bridge
is available.

### Why this satisfies the backlog

This makes Chitragupta the durable session authority while Takumi remains the
executor.

## 4. Report structured artifacts back to the hub

### Delivered code

- `packages/bridge/src/observation-types.ts`
  - `ExecutorRunEvent`
  - `ExecutorArtifactEvent`
- `packages/tui/src/chitragupta-executor-runtime.ts`
  - `observeExecutorEvents(...)`
- `packages/tui/src/coding-agent.ts`
  - emits `executor_run` events on start / completion / failure
  - emits `executor_artifact` events for summary / postmortem
- `bin/cli/one-shot.ts`
  - `buildExecArtifacts(...)`
  - completion event includes artifacts and changed files
- `packages/core/src/exec-protocol.ts`
  - `ExecArtifact`

### What changed

Executor outcomes are now pushed back to the hub in structured form rather than
being recoverable only through prose or local state.

### Why this satisfies the backlog

This provides a machine-readable artifact/reporting path for future recall,
audit, and policy layers.

## 5. Make slash commands hub-aware

### Delivered code

- `packages/tui/src/app-command-macros.ts`
  - `buildSessionContext(...)` now includes:
    - canonical session id
    - hub connectivity
    - recent route lanes
- `packages/tui/src/app-commands-core.ts`
  - `/compact` refreshes hub context after local compaction
- `packages/tui/src/app-commands-productivity.ts`
  - `/context-prune` refreshes hub context after pruning
- `packages/tui/src/app-commands-chitragupta.ts`
  - `/sabha` shows tracked Sabha, working agents, available lanes, and default council

### What changed

Slash commands now expose and react to hub state more explicitly, rather than
acting as isolated local macros.

### Why this satisfies the backlog

The operator surface now reflects hub/session/routing state and refreshes hub
memory after local context-pack changes.

## 6. Participate in Sabha as a true executor peer

### Delivered code

- `packages/tui/src/state.ts`
  - `lastSabhaId`
- `packages/tui/src/app-chitragupta.ts`
  - records `lastSabhaId` from Sabha notifications
- `packages/tui/src/coding-agent.ts`
  - `recordSabhaOutcome(...)`
  - records executor outcome into the active Sabha via `sabhaRecord(...)`
- `packages/tui/src/sabha-defaults.ts`
  - shared default Sabha council definitions
- `packages/tui/src/coding-agent-mesh.ts`
  - mesh escalation uses the shared default Sabha participant set

### What changed

Takumi now records executor outcomes back into Sabha and uses a shared default
council definition for mesh-triggered Sabha escalations.

### Status

**Partially complete by design.**

Takumi is now an actual executor participant, but this is still a lightweight
peer integration. There is not yet a richer executor-specific Sabha payload
protocol beyond `sabhaRecord(...)` and shared participant defaults.

## 7. Keep local sovereignty only where it belongs

### Delivered code

- `packages/agent/src/task-routing.ts`
  - records `takumi-fallback` explicitly when engine routing cannot be safely applied
- `bin/cli/one-shot.ts`
  - `resolveExecRouting(...)` consults Chitragupta first when bootstrap succeeds
- `packages/tui/src/chitragupta-executor-runtime.ts`
  - canonical session binding moves durable identity to the hub
- `packages/tui/src/agent-runner.ts`
  - observation session id now resolves through hub binding

### What changed

Takumi still retains local fallback behavior, but that fallback is now explicit,
recorded, and subordinate to engine-owned routing/session authority when the hub
is available.

### Why this satisfies the backlog

Takumi remains sovereign over repo-local execution, but not over durable route
authority or canonical session truth.

## 8. Use engine-owned packing/compression everywhere

### Delivered code

- `packages/tui/src/app-commands-core.ts`
  - `/compact` refreshes hub context after local compaction
- `packages/tui/src/app-commands-productivity.ts`
  - `/context-prune` refreshes hub context after pruning

### Status

**Partially complete.**

### What changed

Takumi now informs and refreshes hub context after local context packing and
pruning operations.

### Remaining gap

Compression policy is still partly local. The daemon/hub is not yet the sole
owner of packing strategy. This is improved, but not fully centralized.

## 9. Expose a stable headless execution contract

### Delivered code

- `packages/core/src/exec-protocol.ts`
  - defines `takumi.exec.v1`
  - `ExecRunStartedEvent`
  - `ExecBootstrapStatusEvent`
  - `ExecAgentEventEnvelope`
  - `ExecRunCompletedEvent`
  - `ExecRunFailedEvent`
- `bin/cli/exec-protocol.ts`
  - CLI-facing protocol export layer
- `bin/takumi.ts`
  - `exec` subcommand
  - `--headless`
  - `--stream <text|ndjson>`
- `bin/cli/one-shot.ts`
  - emits protocol envelopes during headless runs
- `packages/bridge/src/takumi-exec-contract.ts`
  - parent-side spawn contract
- `packages/bridge/src/takumi-exec-runner.ts`
  - parent-side NDJSON parser / transport validator
- `packages/bridge/src/takumi-capability.ts`
  - Takumi capability now advertises `local-process` invocation and protocol metadata

### What changed

Takumi now exposes a process-stable, structured automation contract instead of
requiring orchestration through in-process assumptions or ad-hoc stdout parsing.

### Why this satisfies the backlog

This is the exact headless execution contract the backlog called for.

## 10. Prepare for post-run policy checks

### Delivered code

- `packages/core/src/exec-protocol.ts`
  - `ExecPostRunPolicy`
  - completion events now carry `postRunPolicy`
- `bin/cli/one-shot.ts`
  - completion event includes validation and policy metadata
- `packages/bridge/src/observation-types.ts`
  - executor artifact/run events give the hub material for later checks

### What changed

The protocol now carries an explicit post-run policy section with default checks
such as:

- provider-model consistency
- session binding
- artifact reporting

### Why this satisfies the backlog

The runtime is now prepared for post-run policy evaluation without needing a
second incompatible protocol revision just to carry those outcomes.

## Supporting work that enabled the backlog

These changes were not separate backlog bullets, but they support the executor
retrofit directly.

### Generic CLI-backed lane support

- `packages/bridge/src/cli-adapter-contract.ts`
- `packages/bridge/src/cli-capabilities.ts`
- `docs/cli-adapter-contract.md`

This broadens the control-plane model beyond Takumi alone and keeps the Takumi
executor path consistent with other local-process lanes.

### Chitragupta handoff documentation

- `docs/agent-hub-boundary.md`
- `docs/chitragupta-takumi-exec-handoff.md`
- `docs/control-plane-spec.md`

These explain where the route/session/artifact authority belongs and how the
parent-side Takumi spawn contract should be consumed.

## Validation performed

The changed surfaces were validated with:

- `pnpm build`
- targeted Vitest coverage for routing, exec protocol, TUI routing, headless exec,
  bridge runner behavior, Chitragupta integration, coding-agent behavior, and
  workflow/slash-command paths

Representative files from the focused matrix:

- `packages/agent/test/task-routing.test.ts`
- `packages/tui/test/coding-agent-routing.test.ts`
- `bin/test/exec-protocol.test.ts`
- `packages/bridge/test/takumi-exec-runner.test.ts`
- `bin/test/exec-e2e.test.ts`
- `packages/tui/test/chitragupta-integration.test.ts`
- `packages/tui/test/chitragupta-sabha-command.test.ts`
- `packages/tui/test/coding-agent.test.ts`
- `packages/tui/test/agent-runner.test.ts`

## Bottom line

The executor backlog is now implemented across the main required seams:

- engine-owned route envelopes are preserved
- execution-time enforcement is explicit
- canonical Chitragupta session binding is wired
- structured artifact/run reporting exists
- slash commands are more hub-aware
- Sabha participation exists and defaults are shared
- Takumi fallback authority is explicit rather than silent
- the headless `takumi.exec.v1` contract is stable and typed
- post-run policy metadata is carried forward

The two intentionally partial areas remain:

1. fully centralizing packing/compression policy in the hub
2. richer executor-specific Sabha payload participation beyond lightweight outcome recording