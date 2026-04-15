# Takumi Future Roadmap

> Active future roadmap for Takumi.
>
> This document is the maintained backlog for the next serious feature wave.
> It should be preferred over old completion reports, phase snapshots, and
> temporary ecosystem notes.
>
> For the tracking index and the historical archive, see [`README.md`](./README.md).

## How to use this document

This roadmap is organized by **tracks**, not by arbitrary phase numbers.

Each track contains:

- the capability to build
- the concrete backlog
- the residency target (`core`, `hook`, `extension`, `skill`)
- the promotion criteria that make it real

Use this roadmap to decide:

- what Takumi should build next
- where a new capability should live
- what must be proven before an experimental feature becomes canonical

## Maturity levels

Every feature in this roadmap should be treated as one of:

- **incubating** — worth preserving, not yet runtime-important
- **experimental** — wired and testable, but not yet constitutional
- **proven** — operationally coherent, measured, and promotable
- **canonical** — part of Takumi's default runtime truth

## Track 1 — Authority and runtime constitution

**Target residency:** core

Takumi's most important work is still runtime truth.

### Backlog

- [x] Consume executable Chitragupta lane bindings end-to-end
	- use authoritative invocation/auth metadata when present
	- keep local provider construction as explicit degraded fallback only
	- ensure interactive, headless, and side-lane flows use the same authority rules
- [x] Introduce unified degraded execution context
	- mark degraded mode once
	- persist it through routing, replay, checkpointing, exec protocol, and UI
	- prevent canonical claims from silently reappearing later in the run
- [x] Add replay validation before canonical import/rebind
	- validate route intent, provider/model truth, and policy-era compatibility
	- surface conflicts before replaying turns into canonical sessions
- [x] Add policy-era/version markers to checkpoints and session recovery
	- detect topology, route-policy, or safety-policy drift across resumes
- [x] Separate authoritative route failure from generic config failure
	- route incompatibility should be its own operator-visible category
	- degraded local fallback should never masquerade as engine success

### Promotion criteria

- same authority rules across interactive and headless flows
- degraded truth visible in status, events, and recovery flows
- replay/rebind validated before canonical import
- no silent cloud-lane rerouting in canonical mode

### Incubating direction — local-first device continuity

- [ ] define local-only continuity architecture for phone/browser companions plus cross-machine executor transfer
	- see [consolidated remaining items](./consolidated-remaining-items.md#local-device-continuity-details-ex-local-device-continuitymd)
	- keep Chitragupta as the canonical local control plane instead of surrendering session sovereignty to vendor cloud sync
	- model browser/mobile surfaces as companions first, not privileged executors
	- introduce explicit single-writer executor lease semantics before promising machine-to-machine transfer
	- use private network transport (for example tailnet-style connectivity) as the transport plane, not as the continuity authority model
	- stage the rollout deliberately:
		- V1 = QR-backed companion attach with `observer` / `commenter` / `approver` roles only
		- V2 = shadow runtime attach + hard session-scoped executor lease with epoch fencing
	- preserve existing handoff + attach/replay primitives as continuity building blocks instead of inventing a second local control plane

## Track 2 — Hooks platform

**Target residency:** hook layer

Hooks are how Takumi becomes more powerful without hardcoding every new policy into core.

### Backlog

- [ ] Add route lifecycle hooks
	- [x] `before_route_request`
	- [x] `after_route_resolution`
	- [x] `route_degraded`
	- [ ] `route_override_requested`
- [x] Add session/replay hooks
	- [x] `before_replay_import`
	- [x] `after_replay_import`
	- [x] `before_session_rebind`
	- keep them observe-only and fail-open until hook execution policy graduates
- [ ] Add checkpoint hooks
	- `before_checkpoint_save`
	- `after_checkpoint_restore`
- [ ] Add approval/artifact hooks
	- `approval_requested`
	- `approval_resolved`
	- `before_artifact_promotion`
- [ ] Add mission/runtime hooks
	- `mission_start`
	- `mission_state_changed`
	- `mission_degraded`
	- `mission_completed`
- [ ] Define hook execution policy
	- ordered execution
	- `fail_open` / `fail_closed` / `warn_only`
	- telemetry for hook duration and failure

### Promotion criteria

- hook order and failure semantics documented
- hooks visible in telemetry and diagnostics
- hooks can annotate or block only where policy explicitly allows it

## Track 3 — Plugins and extensions

**Target residency:** extension layer

Extensions should become the main home for optional operator workflow and advanced diagnostics.

### Backlog

- [ ] Finish package-runtime hardening after the resolver/resource-view slice
	- see [`./2026-04-09-package-runtime-and-slash-commands-review.md`](./2026-04-09-package-runtime-and-slash-commands-review.md)
	- see [consolidated remaining items](./consolidated-remaining-items.md) for detailed spec items
	- make one resolver report the startup truth for extension loading, convention loading, and inspection ✅
	- add explicit package states and operator-visible diagnostics (`ready`, `degraded`, `rejected`, shadowed, conflicts) ✅
	- finish identity / precedence semantics for configured entries instead of relying on path trivia alone
	- upgrade `config.packages[]` from a path-like list into an explicit package contract and clean up `config.plugins[]` semantics alongside it
		- canonical `path` fields now work for both arrays; legacy `name` remains as a compatibility alias
		- config entry normalization is now centralized in `@takumi/core` instead of duplicated in runtime consumers
- [x] Create first-class slash-command contribution architecture
	- introduce `packages/tui/src/slash-commands/builtin/**` for built-in packs
	- treat everything discovered as `external` / `contrib`, not `core` / `community`
	- unify built-in packs and extension-contributed commands behind one contribution model
	- keep built-in names reserved and report rename/skip collisions explicitly
	- avoid exposing full `AppCommandContext` to discovered command packs
	- first landed slice:
		- shared TUI slash-command pack contract
		- `/ide` migrated as the builtin pilot pack
		- `/template` migrated as the second builtin pack, including `/tmpl` alias coverage and no-runner render fallback coverage
		- `/packages` migrated into its own builtin pack, with dedicated package-command tests and `validate` alias coverage
		- `/skills` + `/conventions` migrated into a shared convention inspection pack, leaving the old extension command file focused on narrower runtime seams
		- `/tools` migrated into its own builtin pack with dedicated tool-command tests
		- `/extensions` migrated into its own builtin pack with dedicated extension-inspection tests
		- the historical `app-commands-extensions.ts` entry point is now just a thin aggregator over builtin-pack wrappers
		- extension-host commands adapted into the same contribution path
		- command metadata now reaches `/help` and command-palette operator surfaces
- [ ] Add command categories to the registry
	- functional categories are still fine (`core`, `session`, `observability`, `workflow`, `extensions`, `admin`)
	- keep category vocabulary separate from source/trust vocabulary (`builtin`, `external`, `contrib`)
	- `core`
	- `session`
	- `observability`
	- `workflow`
	- `extensions`
	- `admin`
- [ ] Allow extension-owned panels/widgets/dialogs
	- sidebar widgets
	- command detail panes
	- route/approval/artifact views
- [ ] Upgrade extension host UI APIs
	- real `confirm`
	- real `pick`
	- richer notifications and severity levels
- [ ] Add extension packaging and discovery docs
	- package layout
	- manifest rules
	- health/quarantine behavior
- [ ] Add curated extension examples
	- route diagnostics pack
	- artifact browser pack
	- approval inbox pack
	- session lineage pack
- [ ] Add extension permissions model
	- UI access
	- telemetry access
	- command registration
	- tool interception

### Promotion criteria

- new optional diagnostics can ship as extensions without touching core
- extensions can own widgets and dialogs without shell hacks
- extension host APIs are strong enough that built-in shell sprawl slows down naturally

## Track 4 — Skills

**Target residency:** skill layer

Skills are how Takumi should absorb domain behavior and project heuristics without turning the runtime into a junk drawer.

### Backlog

- [ ] Define skill manifest format
	- name
	- scope
	- activation conditions
	- guidance assets
	- optional runtime hints
- [ ] Add package-backed skill discovery
	- `.takumi/packages/**`
	- global skill roots
	- configured package paths
- [ ] Add skill activation model
	- task-based activation
	- project-type activation
	- operator opt-in/opt-out
- [ ] Add skill promotion path
	- `draft`
	- `experimental`
	- `approved`
	- `canonical`
- [ ] Curate first-party skills
	- debugging
	- code review
	- migration
	- architecture review
	- documentation refresh
- [ ] Add skill evaluation guidelines
	- what counts as a reusable behavior
	- what should stay in docs only
	- what should graduate into hooks or extensions instead

### Promotion criteria

- skills are discoverable and composable
- project/domain heuristics move out of core code
- operators can see which skills shaped a run

## Track 5 — Strategy maturation

**Target residency:** experimental → proven runtime

Takumi should keep ambitious orchestration strategies, but they need evidence and governance.

### Backlog

- [ ] Add forced-path tests for each strategy
	- standard
	- ensemble
	- weighted voting
	- MoA
	- progressive refinement
	- reflexion
	- ToT
- [ ] Add strategy telemetry
	- selection frequency
	- task class
	- cost
	- latency
	- retry count
	- final outcome
- [ ] Add strategy result reports
	- per-run summary
	- per-strategy benchmark slices
- [ ] Explicitly mark strategy residency
	- canonical
	- experimental
	- incubating
- [ ] Wire ToT into a real execution/planning path or keep it clearly incubating
- [ ] Add promotion rules for MoA, progressive refinement, reflexion, and bandit adaptation

### Promotion criteria

- every strategy can be forced in tests
- runtime telemetry can prove it helps
- experimental strategies are visible as experimental in docs and UX

## Track 6 — Operator surfaces and diagnostics

**Target residency:** core for canonical truth, extensions for depth

Takumi should keep strong diagnostics, but they need taxonomy and layered residency.

### Backlog

- [ ] Define primary operator truth surfaces
	- session/runtime status
	- route authority
	- capability health
	- integrity state
	- cluster state
- [ ] Define advanced observability surfaces
	- predictions
	- pattern views
	- extended health
	- deep lane history
- [ ] Unify route truth presentation
	- status bar authority summary
	- route card
	- `/route`
	- no inconsistent copies of the same route story
- [ ] Rationalize overlapping commands
	- `/session` vs `/sessions`
	- `/status` vs `/cluster`
	- `/route` vs `/route-plan`
- [ ] Build artifact and approval surfaces
	- artifact browser
	- approval inbox
	- degraded run review

### Promotion criteria

- primary operator surfaces are obvious and stable
- advanced diagnostics can move into extension packs without loss of power
- duplicate command confusion is reduced

## Track 7 — Side-agent and worktree evolution

**Target residency:** experimental runtime + extension workflow support

Takumi should preserve side-agent ambition, but move toward higher-level orchestration semantics.

### Backlog

- [ ] Add high-level task graph over raw `takumi_agent_*` primitives
- [ ] Add side-agent mailbox/dependency model
- [ ] Add explicit merge/review/promotion flows
- [ ] Add measurable ROI instrumentation
	- isolation effectiveness
	- validation quality delta
	- merge conflict frequency
	- operator overhead
- [ ] Add side-agent observability pack
	- worktree state
	- tmux state
	- pending review / pending merge / blocked states

### Promotion criteria

- side-agent value can be measured instead of narrated
- operators work with tasks and reviews, not just raw process verbs

## Track 8 — Mission state, memory, and lineage

**Target residency:** core + extension surfaces

Takumi should move beyond transcript-only continuity toward explicit mission/state lineage.

### Backlog

- [ ] Define mission state model
	- active mission
	- blocked mission
	- degraded mission
	- promoted artifacts
	- pending replay/import state
- [ ] Add compacted-history lineage tools
	- describe compacted past
	- search compacted history
	- selectively rehydrate spans
- [ ] Add explicit import/promotion workflows for degraded runs
- [ ] Add operator-visible mission summary surfaces

### Promotion criteria

- degraded and compacted history stays explainable
- mission continuity is visible and searchable

## Track 9 — Desktop companion and bridge surfaces

**Target residency:** companion surface, not executor replacement

Takumi Build Window and related surfaces should attach to the runtime and make it easier to operate.

### Backlog

- [x] Define stable attach model for Build Window
- [ ] Expand operator shell views
	- routes
	- approvals
	- artifacts
	- degraded run review
	- fleet/session summaries
- [x] Improve transport choices
	- efficient watch/stream path
	- better desktop session attach semantics
- [x] Keep runtime sovereignty explicit
	- desktop observes and steers
	- terminal/runtime remains execution authority

### Promotion criteria

- desktop surfaces improve operability without moving execution sovereignty out of the runtime

## Release gates for this roadmap

Before a feature graduates into canonical status, require:

- tests that can force the behavior
- telemetry or measurements that justify it
- operator-visible state when it is active
- documented failure semantics
- no silent duplication of Chitragupta authority

## Bottom line

Takumi should keep large ambition.

This roadmap exists to make sure the next wave of features becomes:

- **real**
- **measurable**
- **well-resident**
- **legible to operators**

instead of just becoming more code.
