# Tracking docs

This folder is the home for Takumi's roadmap and planning ledgers.

## Active

- [`future-roadmap.md`](./future-roadmap.md) — the maintained roadmap for upcoming work, organized by capability tracks and residency.
- [`consolidated-remaining-items.md`](./consolidated-remaining-items.md) — detailed backlog items consolidated from 12 plan/spec/audit docs on 2026-04-11. Supplements the roadmap tracks with spec-level detail.
- [`2026-04-09-package-runtime-and-slash-commands-review.md`](./2026-04-09-package-runtime-and-slash-commands-review.md) — 30-pass review synthesis plus the current decision log for package-runtime hardening and first-class slash-command architecture.

## Archive

- [`implementation-history.md`](./implementation-history.md) — the legacy phase-era TODO/history ledger kept for reference, not as the active source of truth.

## Rule of thumb

If you're deciding what to build next, start with `future-roadmap.md`.
If you're trying to understand how earlier implementation waves were tracked, use `implementation-history.md`.

## Tracker maintenance

- [x] Consolidate roadmap/history tracking under `docs/tracking/`
	- keep the active backlog in `future-roadmap.md`
	- keep the older phase-era ledger preserved in `implementation-history.md`
	- do not delete historical tracking just because the active roadmap moved
