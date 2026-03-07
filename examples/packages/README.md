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
  "packages": [{ "name": "./examples/packages" }]
}
```
