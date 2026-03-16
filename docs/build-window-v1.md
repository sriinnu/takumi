# Takumi Build Window v1

> Concrete spec for Takumi’s desktop/operator shell.

This document describes the **next implementation target**, not a claim that the full Build Window is already shipped.

## Purpose

Takumi already has:

- a strong **terminal-native runtime**
- a **headless / exec** mode for automation
- an early `apps/desktop/` shell that can observe and send messages

What is still missing is a first-class, named, productized **Build Window** surface.

The Build Window should become the operator shell for:

- approvals
- artifact review
- routing and lane visibility
- health / context / cost visibility
- steering a running Takumi runtime without replacing it

## Product stance

Takumi should stay **terminal-first**, but not terminal-only.

The surface model should be:

1. **Takumi Runtime** — terminal/TUI executor
2. **Takumi Build Window** — desktop/operator shell
3. **Takumi Bridge** — headless / automation / remote control surface

The Build Window is a **companion surface**, not a rewrite of the runtime.

## Core principle

The Build Window must be able to **attach to** a running Takumi session started from:

- a normal terminal
- Ghostty
- tmux-hosted sessions
- Windows Terminal / PowerShell / CMD launch paths
- WSL-backed sessions

The runtime remains the source of execution truth. The Build Window consumes state and sends control actions over a typed local bridge.

The **primary bridge authority** should be the local **Chitragupta daemon**. The desktop shell should prefer Chitragupta session, health, routing, and memory snapshots over ad-hoc polling whenever those APIs already exist.

## v1 goals

### Must-have goals

1. Show that Takumi is running and what it is doing.
2. Attach to an existing local runtime session without fragile manual steps.
3. Let an operator review and act on risky moments.
4. Make routing / lane / context / approval state legible.
5. Work alongside Ghostty/tmux workflows rather than fighting them.

### Non-goals for v1

- replacing the terminal editor experience
- becoming a browser-first chat app
- full multi-user collaboration
- remote internet-exposed control surface
- complete fleet management beyond local-machine scope

## Target personas

### 1. Power operator
- runs Takumi in Ghostty, tmux, or a terminal multiplexer
- wants a visual control room without losing terminal speed

### 2. Review-first user
- wants approvals, artifacts, and diffs in a cleaner UI than the TUI alone

### 3. Windows/WSL user
- starts Takumi from Windows Terminal / PowerShell / WSL
- wants a proper companion window instead of juggling raw terminals only

## Launch model

### Supported launch patterns

#### A. Terminal-first
```text
user launches takumi in terminal
Build Window discovers the runtime via Chitragupta daemon state and attaches
```

#### B. Build Window first
```text
user opens Build Window
Build Window offers: attach existing runtime OR start new local runtime with daemon-first supervision
```

#### C. Headless runtime + window attach
```text
user launches takumi exec / daemon-backed process
Build Window attaches for observability and steering
```

## Daemon-first operating model

The first serious Build Window slice should be **macOS + terminal + tmux + daemon**.

That means:

- start from a normal local Takumi runtime
- let Chitragupta remain the source of session and health truth
- attach the Build Window through the daemon/bridge path before inventing a second state system
- preserve terminal metadata so an operator can bounce between Build Window and Ghostty/tmux cleanly

## Platform expectations

### macOS / Linux
- primary quality bar
- strong support for Ghostty, iTerm, WezTerm, Terminal.app
- tmux awareness is a feature, not an accident

### Windows
- launch from Windows Terminal / PowerShell / CMD should be supported
- best-quality shell-backed execution path should be Git Bash or WSL-backed runtime
- Build Window should not assume raw `cmd.exe` is the ideal tool-execution environment

### WSL
- first-class path for strong Windows support
- Build Window should be able to attach to WSL-started Takumi via the bridge

## v1 information architecture

### 1. Session rail
Purpose: show active/recent sessions and attach state.

Displays:
- session title / id
- current status (`working`, `waiting_input`, `idle`, `error`)
- provider / model
- updated time
- attached runtime source (terminal / tmux / WSL / daemon)

Actions:
- attach
- focus
- stop
- resume

### 2. Main activity pane
Purpose: show latest assistant output and current execution status.

Displays:
- latest assistant text
- current task / prompt
- active tool(s)
- progress / activity state

Actions:
- send message
- interrupt
- continue
- open in terminal runtime

### 3. Lane and routing board
Purpose: make orchestration legible.

Displays:
- active lanes
- role / branch / model / status
- authority badge (`engine` / `takumi-fallback`)
- enforcement badge (`same-provider` / `capability-only`)
- degraded/fallback markers

Actions:
- inspect lane
- cancel lane
- compare outputs

### 4. Approvals panel
Purpose: make operator trust a first-class UX flow.

Displays:
- pending approval queue
- risk level
- tool name and args summary
- requesting session / lane

Actions:
- approve once
- approve session
- deny
- escalate

### 5. Artifact panel
Purpose: make work products durable and reviewable.

Displays:
- plans
- validations
- handoffs
- summaries
- postmortems

Actions:
- preview
- export
- attach to new session
- promote / persist

### 6. Health strip
Purpose: always-visible operational state.

Displays:
- connection status
- context pressure
- cost / budget status
- daemon / bridge health
- last error / degraded state indicator

## Required contracts for v1

The Build Window should rely on typed bridge/runtime data, not screen-scraping or prompt folklore.

### Required inbound state
- session list
- latest session state snapshot
- active tools
- context percent / pressure
- lane/routing snapshots
- approval queue state
- artifact summaries
- health / error state

### Required outbound actions
- send user message
- interrupt / stop runtime
- approval decision submission
- attach / focus session
- artifact export / attach

## Attach semantics

### Attach to terminal runtime
The Build Window does **not** need to own process creation in every case.

It should be able to:
- discover a running Takumi runtime
- identify session and PID
- attach over the local bridge
- show enough metadata to help the operator jump back to the terminal if needed

### Ghostty / tmux awareness
v1 does not need full terminal-control magic, but it should preserve metadata for:
- terminal app
- mux type
- mux session/window/pane identifiers when available
- whether the runtime is attached or detached

This enables a later “jump to session” feature without inventing hacks upfront.

## Relationship to current `apps/desktop`

The existing `apps/desktop/` shell is the correct seed, but it is still too thin for the Build Window target.

### Already present
- local bridge polling
- basic connected/disconnected state
- latest assistant text
- send-message form
- simple activity and context display

### Missing for Build Window v1
- session rail
- lane/routing board
- approvals panel wired to real state
- artifact panel wired to real state
- explicit attach/start flows
- terminal/tmux/WSL session metadata
- packaged release path

## Recommended implementation order

### Slice 1 — attachable operator shell
- session rail
- activity pane
- health strip
- explicit attach/start flow

### Slice 2 — trust and review
- approvals panel
- artifact panel
- audit-aware actions

### Slice 3 — orchestration visibility
- lane board
- route/fallback explanations
- degraded state surfacing

### Slice 4 — packaging
- platform startup matrix
- desktop packaging flow
- release/install docs

## Exit criteria for Build Window v1

Takumi Build Window v1 is done when:

1. A user can start Takumi in terminal and attach the Build Window.
2. A user can open the Build Window first and start or attach a local runtime.
3. The window shows live session, health, and context state.
4. Pending approvals are visible and actionable from the window.
5. Artifacts are visible and exportable from the window.
6. Routing/lane state is understandable without reading logs.
7. The startup story is documented for macOS/Linux/Windows/WSL.

## Bottom line

Takumi should have its own **Build Window**, but that window should be the **desktop/operator shell attached to the real runtime**, not a confused replacement for the terminal executor.

That keeps Takumi fast, local, and Ghostty/tmux-friendly while still giving it the product surface it currently lacks.