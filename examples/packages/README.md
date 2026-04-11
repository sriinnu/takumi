<p align="center">
  <img src="../../docs/logo.svg" alt="Takumi logo" width="140" />
</p>

# Takumi novel package experiments

These packages are intentionally a little strange.
They are examples of Takumi-native workflow extensions that do more than add a command.

Included packages:

- `@takumi/counterfactual-scout` — detects retry loops and turns failures into counterfactual guidance
- `@takumi/invariant-loom` — extracts non-negotiable constraints from user intent and keeps them active
- `@takumi/negative-space-radar` — reports the important work the run has not touched yet

To try them, point `takumi.config.json` at this directory:

```json
{
  "packages": [{ "path": "./examples/packages" }]
}
```

Then verify discovery from the CLI:

```bash
takumi package list
takumi package inspect invariant-loom
takumi package doctor
```
