# Takumi packages

Takumi packages are the app-side packaging layer for reusable workflow customizations.

They belong on the **Takumi** side of the architecture:

- workflow extensions
- prompt skills
- system prompt add-ons
- tool rule bundles

They do **not** replace Chitragupta authority over durable integrations, capability routing, or auth.

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
	"packages": [{ "name": "./vendor/takumi/review-kit" }],
	"plugins": [{ "name": "./extensions/local-debugger.mjs" }]
}
```

`plugins` stays backward-compatible for direct extension entry points. `packages` is the new higher-level distribution surface.

## CLI lifecycle

Takumi now ships a package-oriented operational surface:

- `takumi package list` — inventory discovered packages
- `takumi package inspect <name>` — show package resources, declarations, and warnings
- `takumi package doctor` — validate package manifests and missing resources
- `takumi package scaffold <name>` — create a local package skeleton under `.takumi/packages/<name>`

This is the first slice of the broader ecosystem lifecycle. The intended direction is:

1. discover
2. inspect
3. validate
4. scaffold
5. eventually add enable, verify, evaluate, and publish flows

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
	"packages": [{ "name": "./examples/packages" }]
}
```
