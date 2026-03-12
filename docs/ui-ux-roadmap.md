# UI / UX Roadmap

> Honest product-direction note for Takumi’s operator experience.

## Current reality

Takumi already has a real UI, but it is a **terminal-native** UI.

That means:

- the main product surface today is the TUI in `@takumi/tui`
- the renderer is custom and purpose-built for the terminal
- multi-lane workflows still lean on worktrees and tmux-style operator habits
- the project is strong for terminal power users, not yet for broader visual
  operator audiences

So when someone asks, “is it still tmux only?”, the truthful answer is:

**Not exactly — the main interface is a custom full-screen TUI, but several
advanced side-lane workflows still feel terminal-operator-centric and are not
yet a polished visual control room.**

## UX stance

Takumi should not abandon its terminal-native advantage.

The goal is:

- keep the TUI as the high-agency power-user surface
- add a stronger visual shell for observability, orchestration, and review
- make advanced multi-lane behavior understandable without requiring tmux fluency

This is a **both/and** product, not a “replace terminal with web chrome” move.

## What needs to improve

### 1. Lane visibility

Today, parallel work and side lanes are easier to reason about if you already
think like a terminal operator.

Needed improvements:

- visible lane list with role, status, branch, model, and health
- clear distinction between active, waiting, degraded, and blocked lanes
- explicit entry points for “open”, “inspect”, “interrupt”, and “merge”

### 2. Deliberation visibility

Sabha, validation disagreement, and route changes need a visual narrative.

Needed improvements:

- a Sabha panel or timeline
- visible votes/challenges/verdict state
- clear escalation banners when Scarlett or the hub raises concern

### 3. Artifact visibility

Plans, summaries, validations, handoffs, and postmortems should feel like
first-class objects in the UX.

Needed improvements:

- artifact list per task/session
- drill-down view for plan / validation / handoff outputs
- “promoted vs local-only” visibility

### 4. Routing explainability

The new route-envelope work is strong architecturally, but the UX should make it
obvious why a lane/model was chosen and when fallback happened.

Needed improvements:

- route card per run
- authority badge: `engine` vs `takumi-fallback`
- enforcement badge: `same-provider` vs `capability-only`
- degraded/fallback explanation inline, not buried in logs

### 5. Merge and review flow

Worktree and side-lane outputs need a more guided resolution flow.

Needed improvements:

- side-by-side diff review
- “accept / reject / compare” flow for competing lane outputs
- clearer pre-merge validation summary

## Product surfaces

Takumi should converge on three complementary UX surfaces.

### A. Terminal cockpit

Best for:

- fast coding
- low-latency editing
- power users
- local repo operations

Should remain the strongest execution surface.

### B. Visual review shell

Best for:

- seeing all lanes/tasks at once
- reviewing artifacts and validations
- tracking route decisions and Sabha state
- integrity and health visibility

This is the missing “serious UI/UX” layer.

### C. Headless orchestration surface

Best for:

- automation
- parent/engine invocation
- CI or background workflows
- delegated local-process execution

This is already much stronger because of `takumi.exec.v1`.

## Near-term roadmap

### Phase 1 — make the current TUI easier to read

- add a dedicated lanes panel
- add route/fallback badges in status surfaces
- add artifact summaries in-session
- improve `/sabha` discoverability from the command palette/help

### Phase 2 — make multi-lane workflows less tmux-coded

- expose side-lane lifecycle in a first-class TUI panel
- provide lane actions from the UI, not only shell habits
- show worktree path, branch, and validation state without making users hunt

### Phase 3 — ship a real visual shell

- use the `apps/desktop/` direction as the basis for a proper review shell
- focus first on:
  - task list
  - lane state board
  - artifact browser
  - Sabha / integrity timeline
  - diff / merge decision surface

### Phase 4 — unify control-plane UX

- show Chitragupta hub state directly
- show Scarlett findings directly
- show routing authority and fallback causes directly
- let users understand the system without reading logs or docs first

## UX principles

### 1. Do not hide power

Takumi’s strength is not “simple chatbot vibes”; it is high-agency execution.
The UX should reveal that power cleanly, not flatten it into generic chat.

### 2. Make the system legible

Users should be able to answer at a glance:

- what is running?
- which lane is winning?
- what route did the hub choose?
- did Takumi fall back locally?
- what needs review before merge?

### 3. Separate durable truth from local activity

The UX should visually distinguish:

- local runtime state
- canonical hub state
- promoted artifacts
- transient exploratory outputs

### 4. Make escalation obvious

When Scarlett or Sabha matters, the UI should feel different. These should not
be hidden in low-salience logs.

### 5. Preserve speed

Any visual shell should keep the core Takumi personality:

- fast
- information-dense
- operator-friendly
- not bloated

## Suggested first implementation targets

If we want the highest ROI next, I would prioritize:

1. **lane dashboard inside the TUI**
2. **route/fallback badges + explanations**
3. **artifact browser for summary/validation/handoff outputs**
4. **desktop review shell for orchestration visibility**

That order gives better usability immediately without stalling on a full product
shell rewrite.

## Bottom line

Takumi already has a strong UI for terminal-native operators.

What it does **not** yet have is a polished, broad, visual control room for:

- multi-lane work
- artifact review
- Sabha visibility
- routing explainability
- merge decision support

That is the next product frontier. The architecture is now good enough to
support it; the UX just needs to catch up with the system’s ambition.