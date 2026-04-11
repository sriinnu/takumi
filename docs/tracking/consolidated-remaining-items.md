# Consolidated Remaining Items

> Extracted from 12 plan/spec/audit docs on 2026-04-11.
> Items already tracked in `future-roadmap.md` are NOT duplicated here.
> This file captures detailed backlog items that don't fit neatly into the
> existing track structure or add important specificity.

## Performance — rendering pipeline (ex PERFORMANCE_INPUT_LATENCY.md)

Phase 1 (priority render queue) is complete. Remaining:

- [ ] Strategy 2: Incremental rendering
	- dirty-region tracking per layout node
	- partial render pass that skips clean subtrees
	- frame budget allocation for incremental vs full flush
- [ ] Strategy 3: Optimistic UI updates
	- cursor-ahead rendering for text input
	- batched text accumulation before reconciliation
- [ ] Phase 2: Profiling instrumentation
	- per-frame timing breakdown (layout, diff, flush)
	- hot-path annotation for renderer bottlenecks
- [ ] Phase 3: Advanced layout optimization
	- Yoga layout result caching across frames
	- virtual scrolling for large output buffers

## Research-backed phases (ex arxiv-research-2025-2026.md)

Proposed phases derived from ArXiv literature survey (30+ papers). Not yet
scheduled. Cross-reference with Tracks 4, 5, 8 in the roadmap.

- [ ] Phase 55: Indexed Experience Memory (Memex-style compaction)
	- builds on existing experience-memory with indexed retrieval
	- inspired by MemoryBank, Reflexion, LATS papers
- [ ] Phase 56: Skills System
	- `SKILL.md` format, activation conditions, project-type matching
	- inspired by SWE-agent skills and WebArena domain heuristics
	- overlaps with Track 4
- [ ] Phase 57: Strategy-Guided Dual Loop
	- meta-cognitive inner loop selects strategy per subtask
	- inspired by CoALA, LATS, and progressive refinement literature
	- overlaps with Track 5
- [ ] Phase 58: Stateful Tool Runtime
	- tools maintain state across invocations within a mission
	- file operation tracking, undo/redo semantics
- [ ] Phase 59: Dynamic Tool Selection & Ranking
	- context-aware tool ranking based on task class
	- usage frequency, success rate, and cost signals
- [ ] Phase 60: Self-Evolving Agent Principles
	- runtime learns from completed missions to refine strategy defaults
	- safe self-modification boundaries

## Build Window v1 spec details (ex build-window-v1.md)

Track 9 covers the high-level backlog. These are the concrete UI specs:

- [ ] Session rail: vertical list of active/recent sessions with status chips
- [ ] Activity pane: live transcript view with role badges and tool grouping
- [ ] Lane board: visual routing display showing active lanes, fallback state
- [ ] Approvals panel: pending approval queue with accept/reject/defer actions
- [ ] Artifact panel: promoted artifacts with diff preview and promotion history
- [ ] Health strip: provider health, context pressure, cost ticker
- [ ] Attach semantics: explicit start/attach/detach flows for companion sessions
- [ ] Implementation slices:
	- Slice 1: attachable shell (read-only transcript + session picker)
	- Slice 2: trust & review (approval inbox + artifact promotion)
	- Slice 3: orchestration visibility (lane board + side-agent state)
	- Slice 4: packaging (extension-owned panels in desktop shell)

## Premium UX spec (ex liquid-ui-spec.md)

Track 6 covers operator surfaces. These are detailed UX design specs:

- [ ] Phase 1: Command experience
	- grouped slash popup with categories and search
	- detail pane showing command docs and examples
	- improved selection with fuzzy matching
	- keybinding hints in popup items
- [ ] Phase 2: Message formatting
	- user prompt cards with context badges
	- assistant response headers with model/route/cost badges
	- collapsible tool groups with summary lines
- [ ] Phase 3: Validation and review objects
	- inline diff cards
	- artifact review panels
	- validation summary blocks
- [ ] Phase 4: Desktop premium shell
	- glass/translucency effects
	- glow accents for active states
	- cross-platform visual language

## P0 gap items (ex takumi-gap-audit.md)

Items not fully covered by existing tracks:

- [ ] LOC discipline enforcement
	- `app.ts` at 742 LOC (limit 450)
	- `app-commands-core.ts` at 669 LOC
	- `state.ts` at 559 LOC
	- split plan: `app-terminal-lifecycle.ts`, `state-derived.ts`, `app-commands-runtime.ts`
- [ ] Message hierarchy in main chat surface
	- user request cards (not raw text blocks)
	- model/route badges on assistant messages
	- validation summary cards
	- collapsible tool result groups
- [ ] Route authority visibility in main chat
	- inline route-truth indicator showing authoritative vs degraded vs local
	- visible in every assistant turn, not just `/route`

## Operator surface implementation slices (ex takumi-local-operator-strike-list.md)

Track 6 covers high-level operator surfaces. These are concrete implementation slices:

- [ ] Slice 0: Shortcut contract cleanup
	- verify all keybindings documented and consistent
- [ ] Slice 1: LOC guardrail refactor
	- split `app.ts` → `app-terminal-lifecycle.ts` + `app-agent-lifecycle.ts`
	- split `state.ts` → `state-derived.ts`
	- split `app-commands-core.ts` → `app-commands-runtime.ts` + `app-commands-session.ts`
- [ ] Slice 2: Command Cockpit MVP
	- grouped command palette with categories
	- parameter hints and inline docs
	- recent-command recall
- [ ] Slice 3: Mission Timeline
	- chronological mission view replacing raw transcript
	- phase markers, tool groups, validation checkpoints
- [ ] Slice 4: Mission Board MVP
	- kanban-style view of active/blocked/completed missions
	- lane assignment visibility
- [ ] Slice 5: Mission Watch (CLI)
	- headless mission status streaming
	- JSON output for CI/scripting
- [ ] Slice 6: Approval Inbox + Artifact Vault
	- dedicated approval queue view
	- artifact browser with promotion history

## Local device continuity details (ex local-device-continuity*.md)

Track 1 references the direction. Detailed protocol objects:

- [ ] V1: Companion attach
	- `/pair mobile` command triggers QR generation
	- QR encodes session attach URL + nonce
	- companion roles: `observer`, `commenter`, `approver`
	- `/continuity` slash command for session status
- [ ] V2: Executor transfer
	- shadow runtime attach before lease transfer
	- epoch-fenced executor lease (single-writer guarantee)
	- workspace fingerprint validation before accepting transfer
	- protocol objects: `AttachGrant`, `AttachedPeer`, `ExecutorLease`, `WorkspaceFingerprint`

## Mission runtime doctrine details (ex mission-runtime-spec.md)

Track 8 covers high-level backlog. Additional spec details:

- [ ] Mission state enforcement hooks
	- `mission_start` / `mission_state_changed` / `mission_completed` events
	- mission degradation propagation rules
- [ ] Mesh artifact contracts
	- explicit artifact exchange format between agents
	- promotion rules for mesh-produced artifacts
- [ ] Recovery and replay hardening
	- selective artifact import/promotion from degraded runs
	- richer recovery diagnostics beyond transcript-only replay

## UX roadmap phases (ex ui-ux-roadmap.md)

Overlaps substantially with Track 6 and the premium UX spec above. Additional items:

- [ ] Phase 1 specifics: route/fallback badges, sabha discoverability in main UI
- [ ] Phase 2 specifics: side-lane lifecycle panel, UI-exposed lane actions (pause/resume/cancel)
- [ ] Phase 3 specifics: unified visual shell (task list + lane board + artifact browser + sabha timeline)
- [ ] Phase 4 specifics: unified control-plane UX bridging TUI and desktop
