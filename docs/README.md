<p align="center">
  <img src="./logo.svg" alt="Takumi logo" width="160" />
</p>

# Takumi docs

This folder contains a mix of:

- **current user reference**
- **current implementation notes**
- **target architecture / design direction**
- **internal research and planning documents**

The important distinction: **not every document here describes fully shipped behavior**.

## Start here

### Current user reference

- [`../README.md`](../README.md) — truthful top-level product overview
- [`KEYBINDINGS.md`](./KEYBINDINGS.md) — current commands, shortcuts, and input behavior
- [`packages.md`](./packages.md) — Takumi packages, package CLI, and examples
- [`examples/multi-agent-workflow.md`](./examples/multi-agent-workflow.md) — current orchestration workflow example
- [`isolation.md`](./isolation.md) — isolation modes and trade-offs

### Current implementation + near-term architecture

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — current system shape plus future direction
- [`review-packet.md`](./review-packet.md) — short executive review packet with live-vs-directional status, decision log, and architecture sequence
- [`orchestration.md`](./orchestration.md) — cluster, mesh, Lucy, Scarlett, and runtime orchestration
- [`validation.md`](./validation.md) — blind validation model and aggregation
- [`control-plane-spec.md`](./control-plane-spec.md) — target control-plane model and what is already wired
- [`agent-hub-boundary.md`](./agent-hub-boundary.md) — concrete Chitragupta ↔ Takumi ↔ Scarlett ownership handoff
- [`takumi-executor-backlog-implementation-note.md`](./takumi-executor-backlog-implementation-note.md) — exact mapping from executor backlog bullets to shipped code
- [`chitragupta-takumi-exec-handoff.md`](./chitragupta-takumi-exec-handoff.md) — parent-side Takumi spawn/IPC handoff
- [`cli-adapter-contract.md`](./cli-adapter-contract.md) — reusable local-process adapter contract for any CLI
- [`ui-ux-roadmap.md`](./ui-ux-roadmap.md) — current terminal-first UX reality and the path to a stronger visual operator experience
- [`checkpoints.md`](./checkpoints.md) — checkpoint and resume behavior

### Performance and diagrams

- [`PERFORMANCE_INPUT_LATENCY.md`](./PERFORMANCE_INPUT_LATENCY.md) — renderer latency analysis and goals
- [`diagrams.md`](./diagrams.md) — supplementary diagrams (check wording against architecture docs)

### Internal research / planning

These are useful, but they are not product promises:

- `PHASE_20_PLAN.md`
- `arxiv-research-2025-2026.md`

Some exploratory Pi ecosystem notes are intentionally kept local-only and are not tracked in git.

## Reading guide

If you want the shortest accurate path:

1. read the repo `README.md`
2. read `KEYBINDINGS.md`
3. read `ARCHITECTURE.md`
4. read `packages.md` or `orchestration.md` depending on what you are using

## Branding assets

- [`logo.svg`](./logo.svg) — main Takumi wordmark/logo
- [`badge.svg`](./badge.svg) — compact badge asset

Use SVG assets in user-facing docs rather than inventing one-off text branding. Tiny branding discipline; fewer future oopsies.