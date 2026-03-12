# Generic CLI Adapter Contract

This document describes how Chitragupta can model **any** CLI as a local-process
adapter, not just Takumi.

## Why this exists

If every delegated CLI has a bespoke spawn story, the control plane turns into a
museum of one-off subprocess rituals. The goal here is a reusable contract.

## Generic contract

```ts
type CliOutputProtocol = "text" | "json" | "line-json" | "ndjson" | "custom";
type CliStderrMode = "diagnostic-text" | "protocol-mirror" | "ignore";

interface CliAdapterRetryPolicy {
	maxAttempts: number;
	retryOnTransportFailure: boolean;
	nonRetryableExitCodes?: number[];
}

interface CliAdapterContract {
	id: string;
	transport: "local-process";
	binaryEnv?: string;
	binaryCandidates: readonly string[];
	defaultArgs?: readonly string[];
	stdoutProtocol: CliOutputProtocol;
	stderrMode: CliStderrMode;
	timeoutMs: number;
	workingDirectoryFromRequest?: boolean;
	retry?: CliAdapterRetryPolicy;
	metadata?: Record<string, unknown>;
}

interface CliAdapterRequest {
	cwd: string;
	args?: string[];
	stdinText?: string;
	env?: Record<string, string | undefined>;
	timeoutMs?: number;
}
```

## Minimum rules

1. binary discovery must be explicit (`ENV` override, then `$PATH` candidates)
2. stdout protocol must be declared up front
3. stderr semantics must be declared up front
4. timeout and retry policy must be declared up front
5. request cwd must be passed deliberately, not assumed implicitly

## Protocol guidance

### Best

- `ndjson`
- `line-json`

These are ideal for orchestration because they support streaming progress and
structured terminal states.

### Acceptable

- `json`

Fine for request/response CLIs, but weaker for long-running streams.

### Weakest

- `text`

Usable, but parents should treat it as human-facing output, not a rich machine
protocol.

## Example capability mappings

### Takumi

- `agent.delegate.takumi`
- transport: `local-process`
- stdout protocol: `ndjson`

### Claude CLI

- `agent.delegate.cli-claude`
- transport: `local-process`
- stdout protocol: `text` or structured JSON if available

Suggested descriptor in Takumi's bridge layer:

```ts
CLAUDE_CLI_CAPABILITY = {
	id: "cli.claude",
	kind: "cli",
	capabilities: ["coding.patch-cheap", "coding.review.strict", "agent.delegate.cli-claude"],
	providerFamily: "anthropic",
}
```

### Codex CLI

- `agent.delegate.cli-codex`
- transport: `local-process`
- stdout protocol: `text`

Suggested descriptor:

```ts
CODEX_CLI_CAPABILITY = {
	id: "cli.codex",
	kind: "cli",
	capabilities: ["coding.patch-cheap", "coding.review.strict", "agent.delegate.cli-codex"],
	providerFamily: "openai",
}
```

### Aider

- `agent.delegate.cli-aider`
- transport: `local-process`
- stdout protocol: likely `text`

Suggested descriptor:

```ts
AIDER_CLI_CAPABILITY = {
	id: "cli.aider",
	kind: "cli",
	capabilities: ["coding.patch-cheap", "agent.delegate.cli-aider"],
	providerFamily: "aider",
}
```

## Parent expectations

When Chitragupta selects a CLI adapter capability, it should be able to derive:

- command
- args
- cwd
- env
- stdin behavior
- stdout parser
- stderr policy
- timeout
- retry policy

without inventing per-consumer heuristics.

## Practical recommendation

Use the generic CLI contract for any external binary.

Use a **specialized overlay contract** only when the CLI exposes stronger
semantics, as Takumi now does with `takumi.exec.v1`.

Takumi now ships concrete bridge-layer presets for:

- `cli.claude`
- `cli.codex`
- `cli.aider`

Those presets are examples of how Chitragupta can represent heterogeneous CLIs
without rewriting the local-process contract every time.