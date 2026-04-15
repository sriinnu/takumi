# 2026-04-09 Package Runtime and Slash-Commands Review

> Review ledger for the 30 read-only review passes run on April 9, 2026.
>
> Method: **5 reviewer roles × 6 focused passes = 30 reviews**.
> Roles used: `Architect`, `Critic`, `Verifier`, `Tester`, `Explore`.
>
> Scope:
>
> - package discovery / resolver / resource-view runtime
> - extension + convention loading
> - startup/config/operator surfaces
> - slash-command architecture direction

## Decisions captured

### Package runtime

- Treat the current resolver/resource-view work as **real progress**, not a finished package platform.
- Keep the next implementation focus on:
	1. making one resolver report the startup truth
	2. adding richer package states / diagnostics (`ready`, `degraded`, `rejected`)
	3. cleaning up the path-shaped `config.packages[]` and `config.plugins[]` contracts

### Slash commands

- Create a first-class `slash-commands/` architecture.
- Use `builtin/` as the internal folder for first-party packs.
- Use `external` / `contrib` as the conceptual source bucket for everything discovered.
- Keep runtime command `source` narrow (`builtin` vs `external`) and carry discovered-command residency separately as additive metadata (`project`, `global`, `package`, `unknown`).
- **Do not** use `core` / `community` as the canonical runtime vocabulary.
- Unify built-in and discovered commands around one contribution model, but keep built-ins and externals on different trust/load paths.

## 30-pass review matrix

| Pass | Focus | Architect | Critic | Verifier | Tester | Explore | Consensus |
|---|---|---|---|---|---|---|---|
| 1 | Resolver architecture | pass-with-concerns | still half-old-loader | pass-with-concerns | boundaries partly protected | mapped discovery → resolver → views | split is better, but loader still owns too much truth |
| 2 | Precedence / identity | partial match | precedence story still leaks | fail vs doc contract | missing collision/config tests | exact tie-break chain mapped | configured semantics and identity are still too thin |
| 3 | Extension runtime | pass-with-concerns | runtime truth still split | pass-with-concerns | missing duplicate/collision tests | load order + dedupe path mapped | package-backed extension loading works, but startup/reporting gaps remain |
| 4 | Convention runtime | pass-with-concerns | `toolRules` look decorative | pass-with-concerns | failure-path coverage weak | low→high prompt/rule/skill order mapped | prompt/skill flow is real; tool-rule and diagnostics story is still weak |
| 5 | Startup / config / operator surfaces | pass-with-concerns | config names lie; surfaces diverge | pass-with-concerns | parity + dirty-path tests missing | startup / inspect / exports mapped | interactive vs one-shot and config contract seams are still not one truth |
| 6 | Overall synthesis | ship-with-known-gaps | not yet trustworthy as a platform | pass-with-concerns | hidden-test risk remains | strongest improvements + mismatches tabulated | keep the slice, but finish resolver truth + contract cleanup before pretending it is done |

## What is unquestionably better

- `packages/agent/src/extensions/package-resolver.ts` now gives Takumi a real precedence-aware resolver instead of only raw discovery flattening.
- `packages/agent/src/extensions/package-resource-views.ts` makes consumer-specific ordering explicit:
	- extensions high → low
	- skills / prompts / tool rules low → high
- `packages/agent/src/extensions/extension-loader.ts` and `packages/agent/src/extensions/convention-loader.ts` now consume resolved package winners instead of freelancing their own raw package ordering.
- `packages/agent/src/extensions/package-inspection.ts` plus `bin/cli/packages.ts` provide a shared inspection/doctor surface with shadowed-package and conflict reporting.
- `packages/agent/test/package-loader.test.ts` now protects precedence, shadowing, same-tier collisions, resource ordering, and package-backed runtime behavior far better than before.

## Most repeated package-runtime findings

### 1. The resolver still is not the single startup truth

Repeated finding across architecture, runtime, and startup passes:

- `packages/agent/src/extensions/extension-loader.ts` still rediscover/resolves packages for itself.
- `packages/agent/src/extensions/convention-loader.ts` still rediscover/resolves packages for itself.
- `bin/takumi.ts` calls both separately during interactive startup.

Consensus next move: compute one resolver report once, then derive consumer views from that shared result.

### 2. `config.packages[]` and `config.plugins[]` are still path-shaped behind type names that suggest richer meaning

Repeated finding across precedence and startup/config passes:

- `packages/core/src/types.ts` exposes `PluginConfig.name` and `PackageConfig.name`.
- reviewed runtime code treats those names as file-system paths.
- `options` exists in the type surface but has no meaningful reviewed-path contract here.

Consensus next move: replace the fake “name but actually path” seam with an explicit contract.

### 3. Operator truth is better, but still too soft

Repeated finding across inspection/runtime/operator passes:

- startup can label package discovery failures as extension errors
- default list/inspect flows focus on active winners and hide some shadowed/conflict detail behind doctor output
- doctor readiness is still warning-count-based rather than state-based

Consensus next move: make diagnostics stateful and explicit, not just warnings in a bag.

### 4. Identity / precedence semantics are still thinner than the plan wants

Repeated finding across precedence passes:

- logical package identity is just lowercased package name
- unnamed packages fall back to `basename(rootPath)`
- same-tier collisions fall back to lexical `rootPath`
- configured-order semantics are not yet first-class

Consensus next move: carry richer candidate metadata into the resolver instead of collapsing everything too early.

### 5. `toolRules` are loaded and surfaced, but the reviewed interactive path did not prove enforcement

Repeated finding across convention/runtime passes:

- `packages/agent/src/extensions/convention-loader.ts` loads `toolRules`
- operator surfaces count/report them
- reviewed interactive prompt path clearly consumes `systemPromptAddon` and `skills`
- reviewed path did **not** show equivalent `toolRules` runtime enforcement

Consensus next move: either wire `toolRules` into real policy behavior or stop implying they are active runtime control.

## Slash-command architecture decision

### Why this came up

Takumi already has two command worlds:

- built-in slash commands registered from `packages/tui/src/commands/app-commands*.ts`
- extension-defined slash commands contributed through `packages/agent/src/extensions/extension-api.ts` and bridged into the TUI via `packages/tui/src/app-extension-host.ts`

The review conclusion was that Takumi should stop growing those as two unrelated command systems.

### Decision

Adopt a first-class slash-command architecture built around:

- `packages/tui/src/slash-commands/builtin/**` for built-in packs
- one shared contribution model for built-in and discovered commands
- `external` / `contrib` as the source bucket vocabulary for discovered packs

### Explicit non-decision

Do **not** flatten built-ins into ordinary discovered extensions.

Reason:

- built-ins currently depend on the richer `AppCommandContext`
- extension commands intentionally run behind a narrower context / trust boundary
- forcing them through one loader would either overexpose app internals or cripple built-ins

### Practical consequences

- built-ins and externals should share metadata, registry shape, completion/help model, and collision vocabulary
- they should not necessarily share loader/trust/privilege semantics
- built-in names should remain reserved; discovered commands should rename or fail noisily rather than silently clobbering first-party verbs

## Likely hidden-test failure zones called out by the review

These came up repeatedly as the most likely first failures if hidden tests get mean in the right way:

1. `selectTakumiPackage()` index parsing is too permissive for numeric-ish garbage selectors.
2. `config.packages[]` still behaves like a path list, not a logical package contract.
3. full five-source precedence is not as well covered as the current happy path suggests.
4. malformed convention files and configured-path failure branches are still under-tested.
5. TUI `/packages` tests mock too much to be treated as true resolver/runtime integration proof.

## Tracked next moves

### Planning follow-through captured after the review

- [x] turn the shared runtime snapshot slice into a concrete implementation plan in `docs/package-discovery-plan.md`
- [x] document the proposed `PackageRuntimeSnapshot` shape plus the snapshot-first loader entry points
- [x] land the shared runtime snapshot slice for interactive startup and validate it with focused tests

### Immediate

- [x] make one resolver report the startup truth for interactive extension loading, convention loading, and inspection
- [x] add explicit package state / diagnostics (`ready`, `degraded`, `rejected`, shadowed, conflicts`)
	- inspection now projects explicit ready/degraded winners and rejected discovery inputs
	- startup prints ready/degraded/rejected package summary when runtime truth is not clean
	- package CLI and TUI summary/list/doctor/detail surfaces consume the shared stateful report
- [ ] clean up `config.packages[]` and `config.plugins[]` into explicit contracts
	- canonical `path` field is now accepted for both arrays, with legacy `name` retained as a compatibility alias
	- config entry normalization now lives in `@takumi/core`, and startup/package consumers reuse that shared rule
	- `loadConfig()` + normalization helpers now treat legacy `name` as an input-only alias and return path-canonical entries instead of preserving both fields at runtime
	- deeper identity / options / distribution semantics are still pending
- [x] define the shared slash-command contribution shape for built-in and discovered command packs
	- shared TUI-owned slash-command pack/contribution contract is now landed
	- built-in `/ide` is migrated into `packages/tui/src/slash-commands/builtin/ide.ts`
	- built-in `/template` is migrated into `packages/tui/src/slash-commands/builtin/template.ts`
	- built-in `/packages` is migrated into `packages/tui/src/slash-commands/builtin/packages.ts`
	- built-in `/skills` + `/conventions` now share `packages/tui/src/slash-commands/builtin/conventions.ts`
	- built-in `/tools` is migrated into `packages/tui/src/slash-commands/builtin/tools.ts`
	- built-in `/extensions` is migrated into `packages/tui/src/slash-commands/builtin/extensions.ts`
	- extension-host commands now register through the same contribution path with source/pack metadata
	- `/help` and the command palette now surface external origin + rename hints from command metadata

### After that

- [x] move built-in command families toward `packages/tui/src/slash-commands/builtin/**`
	- `/ide`, `/template`, `/packages`, `/skills` + `/conventions`, `/tools`, and `/extensions` are now migrated behind thin compatibility wrappers in `packages/tui/src/commands/`
	- `packages/tui/src/commands/app-commands-extensions.ts` now exists only as a thin aggregator over those wrapper registrations
- [x] add source metadata + collision reporting to command inspection/operator surfaces
	- extension-host registration now preserves discovered extension residency from the loader into slash-command metadata and operator snapshots
	- `/help`, the command palette, and `/extensions` now surface package-backed provenance more honestly without changing discovery/load precedence
	- package-backed discovered commands now derive rename suffixes and pack labels from package identity instead of raw basename fallbacks
	- `/extensions show` now distinguishes requested command names from the actual registered slash commands when collision renames changed the live command surface
- [x] decide whether discovered slash-command packs should live under project/global/package roots once the contribution model is stable
	- current decision: keep residency metadata-only for now; do not rewrite trust/load paths or discovery precedence yet

## Status label

**Current call:** `ship-with-known-gaps`

The package-runtime slice is worth keeping and building on.
The slash-command direction is now agreed.
But neither area should be narrated as fully constitutional yet.
