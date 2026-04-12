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

- [`../README.md`](../README.md) — truthful top-level product overview, product stance, and package ownership summary
- [`KEYBINDINGS.md`](./KEYBINDINGS.md) — current commands, shortcuts, and input behavior
- [`packages.md`](./packages.md) — Takumi packages, package CLI, and examples
- [`examples/multi-agent-workflow.md`](./examples/multi-agent-workflow.md) — current orchestration workflow example
- [`isolation.md`](./isolation.md) — isolation modes and trade-offs

### Current implementation + near-term architecture

- [`tracking/README.md`](./tracking/README.md) — tracking docs index separating active roadmap from archived planning ledgers
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — current system shape plus future direction
- [`tracking/future-roadmap.md`](./tracking/future-roadmap.md) — active future roadmap, organized by capability tracks instead of stale phase snapshots
- [`tracking/consolidated-remaining-items.md`](./tracking/consolidated-remaining-items.md) — detailed backlog items consolidated from retired plan/spec/audit docs
- [`takumi-extensibility-model.md`](./takumi-extensibility-model.md) — hooks, plugins/extensions, skills, and canonical-core residency model
- [`pi-mono-lessons.md`](./pi-mono-lessons.md) — distilled lessons from the Pi ecosystem that Takumi should adopt, translate, or explicitly avoid
- [`takumi-evolution-strike-list.md`](./takumi-evolution-strike-list.md) — scope-control guidance while the contract/runtime boundary is still being hardened
- [`review-packet.md`](./review-packet.md) — short executive review packet with live-vs-directional status, decision log, and architecture sequence
- [`orchestration.md`](./orchestration.md) — cluster, mesh, Lucy, Scarlett, and runtime orchestration
- [`validation.md`](./validation.md) — blind validation model and aggregation
- [`control-plane-spec.md`](./control-plane-spec.md) — target control-plane model and what is already wired
- [`agent-hub-boundary.md`](./agent-hub-boundary.md) — concrete Chitragupta ↔ Takumi ↔ Scarlett ownership handoff
- [`takumi-executor-backlog-implementation-note.md`](./takumi-executor-backlog-implementation-note.md) — exact mapping from executor backlog bullets to shipped code
- [`chitragupta-takumi-exec-handoff.md`](./chitragupta-takumi-exec-handoff.md) — parent-side Takumi spawn/IPC handoff
- [`cli-adapter-contract.md`](./cli-adapter-contract.md) — reusable local-process adapter contract for any CLI
- [`checkpoints.md`](./checkpoints.md) — checkpoint and resume behavior

### Performance and diagrams

- [`diagrams.md`](./diagrams.md) — supplementary diagrams (check wording against architecture docs)

### Internal research / planning

Older plan/spec/audit docs were consolidated on 2026-04-11. Their remaining items live in [`tracking/consolidated-remaining-items.md`](./tracking/consolidated-remaining-items.md). The surviving historical ledger is at [`tracking/implementation-history.md`](./tracking/implementation-history.md).

## Reading guide

If you want the shortest accurate path:

1. read the repo `README.md`
2. read `KEYBINDINGS.md`
3. read `packages.md` if you want to extend Takumi without crossing the Chitragupta boundary
4. read `ARCHITECTURE.md`
5. read `orchestration.md` if you are working on multi-agent/runtime behavior
6. read `tracking/future-roadmap.md` and `takumi-extensibility-model.md` if you are planning future features

## Branding assets

- [`logo.svg`](./logo.svg) — main Takumi wordmark/logo
- [`badge.svg`](./badge.svg) — compact badge asset

Use SVG assets in user-facing docs rather than inventing one-off text branding. Tiny branding discipline; fewer future oopsies.
