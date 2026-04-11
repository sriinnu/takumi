# Takumi Extensibility Model

> How Takumi should grow without turning every good idea into permanent core complexity.

## Why this matters

Takumi is not a small tool anymore.

It already has:

- a terminal runtime
- a custom renderer
- a multi-agent execution model
- a control-plane boundary with Chitragupta
- side-agent and desktop/operator surfaces
- an extension host and package system

That means future growth needs a **residency model**.

The question is no longer just:

- "Is this a good idea?"

The more important question is:

- "Where should this idea live until it is proven?"

## The four growth surfaces

Takumi should prefer these extensibility surfaces in this order:

1. **Hooks**
2. **Plugins / Extensions**
3. **Skills**
4. **Canonical core**

The order matters.

Core should be the hardest place to earn residency.

## 1. Hooks

Hooks are **lifecycle interception points** inside the canonical runtime.

They are the right answer when behavior needs to attach to an existing runtime phase without creating a new UI surface or a new sovereign subsystem.

### Hooks are for

- route request / route resolution interception
- degraded-mode transitions
- checkpoint save/load boundaries
- replay validation
- provider request interception
- tool execution start / update / end
- cluster phase changes
- approval request / approval resolution
- artifact promotion boundaries
- session bind / rebind / fork events

### Hooks are not for

- large operator UI features
- standalone workflow products
- alternate control planes
- hidden provider-routing systems

### Hook design rules

- hooks must be typed
- hooks must declare ordering semantics
- hooks must be allowed to observe, annotate, veto, or downgrade only where explicitly permitted
- hook failure policy must be explicit (`fail_open`, `fail_closed`, `warn_only`)
- hook execution must be observable in telemetry and diagnostics

### Future hook backlog

- `before_route_request`
- `after_route_resolution`
- `route_degraded`
- `before_replay_import`
- `after_replay_import`
- `before_artifact_promotion`
- `before_checkpoint_save`
- `after_checkpoint_restore`
- `approval_requested`
- `approval_resolved`
- `mission_state_changed`

## 2. Plugins and extensions

Extensions are the right answer for **optional capability**.

Takumi already has a credible base here:

- extension lifecycle events
- extension commands
- extension shortcuts
- extension widgets
- extension storage
- extension bridge/event bus

This is the preferred home for features that are valuable but not universal.

### Extensions are for

- operator-specific commands
- observability packs
- route / diagnostics widgets
- workflow helpers
- organization-specific rules and status surfaces
- custom dashboards, badges, sidebars, and prompt helpers

### Extensions are not for

- canonical session truth
- control-plane authority
- hidden auth/routing replacement logic
- mandatory runtime behavior every run depends on

### Extension growth backlog

- category-aware extension commands
- extension-owned panels and dialogs
- richer `confirm` / `pick` host APIs
- extension health surfaced to operators
- extension permission model for UI, telemetry, and tool interception
- extension packaging and discovery docs
- extension examples for route diagnostics, approval workflows, and artifact viewers

## 3. Skills

Skills are the right answer for **reusable behavior and domain intelligence** that should not immediately harden into runtime logic.

A skill should package:

- domain guidance
- decision heuristics
- repeatable workflow steps
- prompt/runtime shaping rules

### Skills are for

- domain-specific coding guidance
- project workflow patterns
- reusable architecture review patterns
- debugging playbooks
- security review patterns
- documentation and refactor guidance

### Skills are not for

- provider authority
- runtime state ownership
- generic catch-all commands that belong in extensions
- hidden policy systems that core cannot observe

### Skill growth backlog

- package-backed skill manifests
- task-to-skill activation rules
- skill composition rules
- skill promotion path (`draft → experimental → approved`)
- curated built-in skills for debugging, review, migration, and design work
- project-local skill discovery from `.takumi/packages/**`

## 4. Canonical core

Core should be the last resort.

Something belongs in core only if it is:

- required for canonical runtime truth
- needed on nearly every run
- too fundamental to live behind hooks, extensions, or skills

### Core is for

- route/session/authority truth
- exec protocol
- renderer/runtime foundations
- tool safety primitives
- canonical operator status surfaces
- session durability and replay boundaries

### Core is not for

- every new experiment
- every new diagnostic view
- every new strategy
- every new workflow preference

## Residency model

Every feature should have an explicit residency level.

### Incubating

- idea is worth preserving
- module may exist
- isolated tests may exist
- not hot-path constitutional runtime yet

### Experimental

- feature flag or config gate exists
- behavior is wired into runtime
- instrumentation exists
- docs explicitly call it experimental

### Proven

- forced-path tests exist
- operator behavior is coherent
- failure semantics are clear
- telemetry can show benefit/cost

### Canonical

- feature is default or always-on
- docs treat it as current reality
- regressions block releases
- operators depend on it as part of the main mental model

## Promotion rules

A feature should move toward core only when all of these are true:

- the runtime boundary is clear
- the operator can see when it is active
- failure behavior is explicit
- there is meaningful test coverage
- there is telemetry or evidence that it improves outcomes
- it does not duplicate Chitragupta authority

## Immediate extensibility priorities

### Highest-value next work

1. add route/degraded/replay hooks
2. add command categories for both built-ins and extensions
3. expand extension host UI APIs (`confirm`, `pick`, richer widgets)
4. define skill manifests and activation rules
5. move optional diagnostics out of core shell sprawl and into extension/widget form

### Things to avoid while doing this

- do not let extensions become a hidden second control plane
- do not let hooks mutate authority boundaries silently
- do not let skills become vague prompt junk drawers
- do not promote experiments into core just because they are interesting

## Bottom line

Takumi should keep its large ambition.

But it should become large by growing through:

- **hooks** for runtime interception
- **extensions** for optional operator capability
- **skills** for reusable intelligence
- **core** only for canonical truth

That is how Takumi gets more capable without becoming a god-shell with every idea welded permanently into the main runtime.
