<p align="center">
	<img src="./logo.svg" alt="Takumi logo" width="160" />
</p>

# Takumi packages

Takumi packages are the app-side packaging layer for reusable workflow customizations.

They exist so I can extend **how Takumi works** without confusing that with **what Chitragupta governs**.

They belong on the **Takumi** side of the architecture:

- workflow extensions
- prompt skills
- system prompt add-ons
- tool rule bundles

They do **not** replace Chitragupta authority over durable integrations, capability routing, or auth.

## What a package is

The easiest way to keep the boundary honest is to separate package terms from engine terms:

| Surface | Purpose | Lives where |
|---|---|---|
| **package** | a reusable Takumi workflow bundle | Takumi app side |
| **extension** | executable code loaded by Takumi at runtime | inside a package or direct config path |
| **skill / prompt asset** | packaged behavior or prompt material that shapes local execution | inside a package |
| **plugin** | older direct-extension path kept for compatibility | Takumi config surface |
| **provider / CLI capability registry** | durable runtime inventory, routing, and auth references | Chitragupta control plane |

If a thing needs to own provider choice, credential references, health authority, or cross-app routing policy, it is not a Takumi package concern.

## Package layout

Takumi discovers packages from:

- project-local: `.takumi/packages/*`
- global: `~/.config/takumi/packages/*`
- configured package paths via `takumi.config.json`

Each package is a directory with a `package.json` manifest:

```json
{
	"name": "@takumi/review-kit",
	"version": "0.1.0",
	"takumi": {
		"extensions": ["./index.mjs"],
		"skills": ["./skills"],
		"systemPrompt": "./system-prompt.md",
		"toolRules": "./tool-rules.json"
	}
}
```

## Config

`takumi.config.json` can now declare package roots alongside legacy plugin paths:

```json
{
	"packages": [{ "path": "./vendor/takumi/review-kit" }],
	"plugins": [{ "path": "./extensions/local-debugger.mjs" }]
}
```

`path` is now the canonical field for both arrays. The older `name` field is still accepted as a compatibility alias for existing configs.

`plugins` stays backward-compatible for direct extension entry points. `packages` is the new higher-level distribution surface.

## Discoverability model

Takumi keeps discovery simple on purpose:

- project-local packages are for repo-specific workflow behavior
- global packages are for operator-wide defaults across projects
- configured package roots are for vendor bundles, experiments, or checked-in package sets

The runtime merges all three. `takumi package list` is the quickest way to confirm what the app can currently see.

## CLI lifecycle

Takumi now ships a package-oriented operational surface:

- `takumi package list` — inventory discovered packages
- `takumi package inspect <name>` — show package resources, declarations, and warnings
- `takumi package doctor` — validate package manifests and missing resources
- `takumi package scaffold <name>` — create a local package skeleton under `.takumi/packages/<name>`
- `takumi package install <path>` — copy a package directory into the global Takumi package store
- `takumi package remove <name>` — remove a previously installed global or local package by name

This is the first slice of the broader ecosystem lifecycle. The intended direction is:

1. discover
2. inspect
3. validate
4. scaffold / install / remove
5. eventually add enable, verify, evaluate, and publish flows

## What is true today

What exists on `main` right now:

- package discovery
- package inspection
- package doctor/validation output
- package scaffolding
- package install/remove lifecycle for filesystem-backed packages
- package-provided extensions, skills, system prompt add-ons, and tool rules

What is still directional rather than fully shipped:

- package enable / disable flows
- quarantine / promote flows
- registry-backed publishing pipeline
- formal evaluation execution for packages

### Current product stance

Packages are already a real extension and packaging surface.

They are **not** yet a full remote marketplace with trust-gated publishing, automatic enablement flows, or policy-enforced governance. The docs should be read with that line in mind.

## Current lifecycle caveats

- `takumi package install` currently installs from a local filesystem path, not from npm or a remote registry.
- `takumi package remove` removes matching packages from either the global Takumi package directory or the project's `.takumi/packages` directory.
- Package trust and governance metadata are inspectable today, but enforcement is still advisory rather than policy-gated.

## Beyond plugins: Takumi-native governance

Takumi packages are not meant to be anonymous prompt blobs. The package manifest
already supports a richer, more Takumi-native shape:

- `provenance` — `builtin`, `verified`, `community`, or `local`
- `capabilitiesRequested` — the semantic capabilities the package expects to influence
- `compatibility` — target Takumi version range and package API generation
- `evals` — optional evaluation coverage / suite / score metadata
- `maintainer` — human or team responsible for the package

This lets Takumi evolve toward a governed package economy instead of a loose pile
of extensions. The direction is:

- discoverable packages
- inspectable trust and compatibility metadata
- eval-backed package quality
- future enable / quarantine / promote / publish flows

## Novel example packages

The repo now includes a few deliberately unusual package experiments under
`examples/packages/`.

- `@takumi/counterfactual-scout`
	- watches repeated failures
	- blocks the third identical failed move
	- exposes a `counterfactual_scout` tool for “what should I do instead?” guidance
- `@takumi/invariant-loom`
	- extracts non-negotiable constraints from messy prompts
	- weaves them back into the system prompt
	- exposes an `invariant_loom` tool for recalling active constraints
- `@takumi/negative-space-radar`
	- tracks what a run has **not** touched yet
	- calls out missing validation, docs drift, and tunnel vision
	- exposes a `negative_space_radar` tool for blind-spot audits

To try them without moving files into `.takumi/packages`, point Takumi at the
example package root:

```json
{
	"packages": [{ "path": "./examples/packages" }]
}
```

Then verify them with:

```bash
takumi package list
takumi package inspect counterfactual-scout
takumi package doctor
```

The example package manifests intentionally include governance metadata such as evaluation coverage and scores. Treat those as example metadata for the package system, not as an external certification badge.
