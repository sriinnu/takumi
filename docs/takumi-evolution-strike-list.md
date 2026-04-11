# Takumi Evolution Strike List

> Scope-control doctrine for Takumi while the Chitragupta contract is being hardened.
>
> The goal is not to make Takumi smaller for its own sake. The goal is to make it **more evolvable** by pushing growth into the right seams: **hooks, plugins, skills, and extensions**.

## Core doctrine

Takumi should evolve by preferring these surfaces, in this order:

1. **Hooks** — lifecycle interception and policy injection
2. **Plugins / Extensions** — optional operator and workflow capabilities
3. **Skills** — reusable domain behavior and prompt/runtime guidance
4. **Built-in core code** — only when the capability is canonical and unavoidable

That means:

- do **not** keep growing the built-in shell for every new idea
- do **not** keep teaching Takumi new provider-routing tricks locally
- do **not** let optional workflow features become permanent core obligations

## Stop growing immediately

These are not necessarily full-file deletions today.
These are directions that should stop receiving new scope now.

### 1. Local routing ambition in Takumi

**Targets**
- `packages/agent/src/model-router.ts`
- `packages/agent/src/task-routing.ts`

**Call**
- Stop adding new role → tier → provider/model heuristics in Takumi.
- Stop expanding local cloud-lane routing intelligence.

**Why**
- Chitragupta is supposed to own route authority.
- Takumi should not become a rival routing brain.

**Future shape**
- Keep only the minimum local fallback logic needed for explicit degraded mode.
- Shrink this surface toward a lane-request adapter plus fallback table.

### 2. One-off built-in operator commands as the default answer

**Targets**
- `packages/tui/src/commands/app-commands-*.ts`
- ad-hoc panel/dialog additions in `packages/tui/src/**`

**Call**
- Stop adding new built-in slash commands, panels, or dialogs unless they are canonical runtime surfaces.

**Why**
- The built-in command surface is already too wide.
- Discoverability is losing to accretion.

**Future shape**
- New operator surfaces should prefer extension registration and widget hooks.
- Built-ins should be reserved for canonical workflow/status primitives.

### 3. New low-level side-agent verbs

**Targets**
- low-level `takumi_agent_*` growth
- more direct tmux/worktree lifecycle knobs exposed to operators

**Call**
- Stop adding more low-level side-agent primitives until there is a higher-level team/task/hook policy layer.

**Why**
- Low-level control surfaces grow faster than operator understanding.
- The runtime already exposes more mechanism than mission-level structure.

**Future shape**
- Add higher-level orchestration surfaces first.
- Keep raw primitives as implementation substrate, not the main UX.

## Freeze now

These areas should be treated as **feature-frozen** until the stated prerequisite is complete.

### 1. Side-agent/worktree/tmux expansion

**Targets**
- `packages/agent/src/cluster/side-agent-*`
- `packages/agent/src/cluster/worktree-*`
- `packages/agent/src/cluster/tmux-*`

**Freeze until**
- there is measured evidence that isolation materially improves outcomes
- there is a simpler operator-level abstraction than raw lane/process mechanics

**Why**
- This subsystem is complexity-expensive.
- More features here before ROI proof is how systems become operational folklore.

### 2. `AppState` growth and new built-in TUI surface area

**Targets**
- `packages/tui/src/state.ts`
- new built-in panels/dialogs/status widgets

**Freeze until**
- state is split into bounded domain objects
- command taxonomy/categories exist

**Why**
- `AppState` is already a god object.
- More built-in UI on top of it compounds entropy.

### 3. Control-plane type expansion without executable backing

**Targets**
- `packages/bridge/src/control-plane.ts`
- new contract fields that are not consumed at runtime

**Freeze until**
- route decisions can actually drive execution through authoritative invocation/auth data

**Why**
- Types that outrun runtime truth become architecture theater.

### 4. Replay / canonical continuity claims

**Targets**
- replay/rebind/checkpoint promises in docs and UX

**Freeze until**
- replay validation exists against current route / policy / provider truth

**Why**
- Recovery without validation is not continuity; it is optimism.

### 5. New orchestration strategies in core runtime

**Targets**
- additional strategy families in `packages/agent/src/cluster/*`
- more adaptive topology logic without guardrails

**Freeze until**
- existing strategies are proven by forced tests and measured runtime usage

**Why**
- Optional strategy proliferation is a classic sophistication trap.

## Delete or retire after migration

These are strong candidates for deletion or major shrinkage once replacement paths exist.

### 1. Role-heavy local route selection logic

**Targets**
- large parts of `packages/agent/src/model-router.ts`

**Retire when**
- Chitragupta can return authoritative per-lane executable bindings

**Replacement**
- thin lane request construction + explicit degraded fallback mapping

### 2. Redundant built-in operator surfaces

**Targets**
- slash commands/panels that only mirror raw state and do not add workflow leverage

**Retire when**
- grouped command help exists
- extension/widget surfaces can host optional diagnostics

**Replacement**
- categorized built-ins for canonical surfaces
- extension commands/widgets for optional or experimental views

### 3. Untested or unused orchestration strategies

**Targets**
- strategy implementations that cannot show forced-path tests and real usage

**Retire when**
- audit shows low or zero usage, or no correctness/value proof

**Replacement**
- a smaller proven strategy set

## Preserve and evolve

These are the right growth seams.

### 1. Hooks

**Targets**
- `packages/agent/src/extensions/extension-api.ts`
- lifecycle event emission around turns, tools, provider requests, clusters
- `packages/agent/src/context/memory-hooks.ts`

**Why this should grow**
- Hooks let Takumi become customizable without becoming bloated.
- Policy, diagnostics, guardrails, and project-specific behaviors belong here first.

**Next evolution**
- add route/degraded/authority hooks
- add replay-validation hooks
- add policy-era hooks for checkpoint/rebind boundaries

### 2. Plugins and extensions

**Targets**
- `packages/agent/src/extensions/*`
- `packages/tui/src/app-extension-host.ts`
- `packages/tui/src/extension-ui-store.ts`
- extension commands, shortcuts, widgets

**Why this should grow**
- Optional capability belongs out of core.
- Operator-specific workflow surfaces should be pluggable.

**Next evolution**
- category-aware extension commands
- extension-owned panels/widgets
- better extension host prompts/confirmations

### 3. Skills

**Targets**
- packaged guidance / domain capability surfaces
- prompt/runtime helpers that should not become core code

**Why this should grow**
- Skills are the right place for domain behavior, not hardcoded branch logic.
- They let Takumi adapt per project without baking every habit into the runtime.

**Next evolution**
- move project/domain-specific heuristics into skills
- keep canonical runtime small and policy-driven

### 4. Core surfaces worth protecting

**Keep strong**
- `packages/render/*`
- `bin/cli/exec-protocol.ts`
- `packages/bridge/src/control-plane.ts` lane-envelope concepts
- extension lifecycle events
- bounded package layering (`core → render → bridge → agent → tui`)

## Decision rule for future work

Before adding anything new, ask:

### Add to core only if...
- it is required for canonical runtime truth
- it must exist for every operator and every run
- it cannot reasonably live behind a hook/plugin/extension/skill seam

### Add as a hook if...
- it intercepts lifecycle or policy boundaries
- it modifies behavior without needing a new operator surface

### Add as a plugin/extension if...
- it is optional, experimental, project-specific, or operator-specific
- it adds commands, widgets, shortcuts, diagnostics, or workflow helpers

### Add as a skill if...
- it packages reusable domain knowledge
- it changes guidance or behavior pattern more than runtime mechanics

## Bottom line

If Takumi keeps growing by adding more built-in routing logic, more raw operator commands, and more runtime sub-systems, it will become impressive but brittle.

If Takumi grows by deepening:

- **authority truth** in the Chitragupta contract,
- **hooks** for lifecycle/policy interception,
- **plugins/extensions** for optional operator workflow,
- **skills** for reusable domain behavior,

then it can evolve without turning into a god-shell with five brains and no constitution.
