<p align="center">
	<img src="./logo.svg" alt="Takumi logo" width="160" />
</p>

# Chitragupta Integration Control Plane Spec

> Concrete control-plane spec for provider, CLI, routing, auth, health, and consumer constraints.

> Status note: this document is primarily a **target control-plane contract**. Parts of it are already represented in the current bridge and TUI, but Takumi still owns some provider/auth/runtime behavior locally today.

## Purpose

This document defines the authority boundary between Chitragupta and its consumers.

The core rule is simple:

- **Chitragupta owns durable integration authority**
- **Takumi, Vaayu, and other apps request capabilities**
- **Consumers may express constraints, but they do not become sovereign routers**

That prevents split policy, split memory, split auth, split health, and split identity.

## Ownership model

| Concern | Owner |
|---|---|
| provider registry | Chitragupta |
| CLI integration registry | Chitragupta |
| routing policy | Chitragupta |
| auth / credential references | Chitragupta |
| health / cost / availability view | Chitragupta |
| session / memory hooks | Chitragupta |
| user-facing controls | Takumi, Vaayu, other consumers |
| specialized execution behavior | Takumi, other domain adapters |
| integrity monitoring | Scarlett |

## Control-plane layers

| Layer | Role |
|---|---|
| capability registry | Canonical inventory of LLMs, CLIs, local models, embeddings, and engine-native tools |
| policy engine | Resolves local-first, trust, budget, approval, fallback, and consumer constraints |
| health engine | Tracks latency, uptime, throttling, auth failures, drift, and degradation |
| credential broker | Stores secret references and access methods without forcing raw secret ownership into consumers |
| session and memory hooks | Attaches every invocation to canonical session, observation, and memory records |

## Architectural rule

Consumers should ask for **capabilities**, not vendors.

Bad:

- Takumi chooses `claude` directly
- Vaayu chooses `openai` directly
- each consumer grows its own fallback stack

Correct:

- Takumi asks for `coding.patch-and-validate`
- Vaayu asks for `chat.high-reliability`
- classifier asks for `classification.local-fast`
- Chitragupta resolves the lane

## Capability registry model

Each integration, whether cloud API, CLI, local model, or engine-native adapter, is represented as a capability-bearing resource.

```ts
export type CapabilityKind = "llm" | "cli" | "embedding" | "tool" | "adapter" | "local-model";

export type TrustLevel = "local" | "sandboxed" | "cloud" | "privileged";

export type HealthState = "healthy" | "degraded" | "down" | "unknown";

export interface CredentialRef {
	id: string;
	provider: "keychain" | "os-store" | "env-ref" | "token-broker" | "none";
	lookupKey: string;
	scopes: string[];
	lastValidatedAt?: number;
}

export interface InvocationContract {
	id: string;
	transport: "http" | "stdio" | "local-process" | "mcp" | "inproc";
	entrypoint: string;
	requestShape: string;
	responseShape: string;
	timeoutMs: number;
	streaming: boolean;
	requiresApproval?: boolean;
}

export interface CapabilityDescriptor {
	id: string;
	kind: CapabilityKind;
	label: string;
	capabilities: string[];
	costClass: "free" | "low" | "medium" | "high";
	trust: TrustLevel;
	health: HealthState;
	authRef?: CredentialRef;
	invocation: InvocationContract;
	tags: string[];
	priority?: number;
	providerFamily?: string;
	version?: string;
	metadata?: Record<string, unknown>;
}
```

## Capability naming

Capability names should be semantic lanes, not vendor names.

Recommended format:

`<domain>.<intent>[.<quality-or-policy>]`

Examples:

| Capability | Meaning |
|---|---|
| `chat.high-reliability` | stable interactive conversation lane |
| `chat.low-cost` | conversational lane optimized for budget |
| `coding.patch-and-validate` | edit, test, inspect, and verify code |
| `coding.review.strict` | higher-trust review lane |
| `classification.local-fast` | deterministic / local-first classification |
| `memory.semantic-recall` | graph/vector/session retrieval |
| `embedding.index-build` | embedding generation for indexing |
| `agent.delegate.takumi` | explicit route into Takumi as executor |
| `agent.delegate.cli-claude` | explicit route into a CLI-backed agent lane |
| `agent.delegate.cli-codex` | explicit route into Codex CLI |
| `agent.delegate.cli-aider` | explicit route into Aider |

Rules:

- consumer-visible names should remain stable when vendors change
- vendor IDs belong in registry metadata, not in high-level routing asks
- policy suffixes should reflect intent, not implementation fetish

## Routing policy model

The routing engine resolves a consumer request into a concrete capability descriptor.

```ts
export interface ConsumerConstraint {
	preferLocal?: boolean;
	allowCloud?: boolean;
	maxCostClass?: "free" | "low" | "medium" | "high";
	requireStreaming?: boolean;
	requireApproval?: boolean;
	trustFloor?: TrustLevel;
	excludedCapabilityIds?: string[];
	preferredCapabilityIds?: string[];
	hardProviderFamily?: string;
	hardCapabilityId?: string;
}

export interface RoutingRequest {
	consumer: "takumi" | "vaayu" | "scarlett" | "sabha" | string;
	sessionId: string;
	capability: string;
	constraints?: ConsumerConstraint;
	context?: Record<string, unknown>;
}

export interface RoutingDecision {
	request: RoutingRequest;
	selected: CapabilityDescriptor | null;
	reason: string;
	fallbackChain: string[];
	policyTrace: string[];
	degraded: boolean;
}
```

## Local-first constitution

This ordering belongs in the engine, not per-app whim.

| Tier | Class |
|---|---|
| Tier 0 | regex, rules, classifiers, deterministic logic |
| Tier 1 | local indexes, graph memory, tools, CLIs |
| Tier 2 | local models |
| Tier 3 | cloud APIs |
| Tier 4 | degraded fallback / broad escape hatch |

Default routing behavior:

1. prefer lower tier if it satisfies the requested capability
2. move upward only if quality, health, or constraint failure requires it
3. record every escalation in routing trace
4. let consumers request stricter constraints, but not silently rewrite constitution

## Override rules

Consumers are allowed to request preferences and hard constraints, but authority remains engine-owned.

| Override type | Allowed | Example |
|---|---|---|
| preferred lane | yes | local-first if possible |
| hard no-cloud | yes | sensitive coding task |
| hard provider family | limited | must use local CLI in offline mode |
| direct vendor sovereignty | no | “Takumi always picks Claude itself” |
| bypass credential policy | no | app reads raw secrets directly |
| bypass health gates | no | force unhealthy provider without explicit privileged mode |

Recommended precedence:

1. engine safety and trust policy
2. credential availability
3. health gates
4. consumer hard constraints
5. local-first constitution
6. cost optimization
7. consumer preference hints

## Credential broker model

Credentials should be centrally referenced, not app-owned.

Principles:

- secrets live in OS keychain or secure local storage
- Chitragupta owns references and access method
- consumers receive scoped execution, not durable raw secret ownership
- all auth failures and validations are recorded centrally

```ts
export interface CredentialAccessEvent {
	sessionId: string;
	consumer: string;
	authRefId: string;
	purpose: string;
	outcome: "granted" | "denied" | "expired" | "invalid";
	timestamp: number;
}
```

## Health engine model

Health must include both internal and external integration state.

```ts
export interface CapabilityHealthSnapshot {
	capabilityId: string;
	state: HealthState;
	errorRate: number;
	p50LatencyMs?: number;
	p95LatencyMs?: number;
	throttleRate?: number;
	authFailures?: number;
	lastSuccessAt?: number;
	lastFailureAt?: number;
	reason?: string;
}
```

Scarlett should watch:

- provider health
- CLI failure modes
- bridge disconnects
- auth failures
- session drift
- memory inconsistency
- healing success and failure

## Takumi representation

Takumi should be represented in the control plane as **both**:

| Role | Meaning |
|---|---|
| consumer | asks Chitragupta for routing, memory, prediction, and policy |
| adapter / executor capability | a specialized coding lane Chitragupta may choose |

That means Takumi is:

- privileged
- observable
- routable
- not sovereign over durable auth, routing, or memory

Recommended registry shape:

```ts
export const TAKUMI_CAPABILITY: CapabilityDescriptor = {
	id: "adapter.takumi.executor",
	kind: "adapter",
	label: "Takumi Coding Executor",
	capabilities: [
		"coding.patch-and-validate",
		"coding.review.strict",
		"agent.delegate.takumi",
	],
	costClass: "medium",
	trust: "privileged",
	health: "healthy",
	invocation: {
		id: "takumi-agent-loop",
		transport: "local-process",
		entrypoint: "TAKUMI_EXEC_BIN|takumi exec --headless --stream=ndjson",
		requestShape: "TakumiExecRequest",
		responseShape: "takumi.exec.v1 NDJSON envelopes",
		timeoutMs: 120_000,
		streaming: true,
	},
	tags: ["coding", "executor", "verification", "privileged"],
};
```

### Parent-side spawn / IPC contract

When Chitragupta selects `adapter.takumi.executor`, it should invoke Takumi as a
local process instead of assuming an in-proc module boundary.

Recommended parent contract:

```ts
export interface TakumiExecRequest {
	prompt: string;
	cwd: string;
	issue?: string;
	provider?: string;
	model?: string;
	fallbackProvider?: string;
	chitraguptaSocketPath?: string;
}
```

Spawn shape:

```text
command:  $TAKUMI_EXEC_BIN || "takumi"
args:     ["exec", "--headless", "--stream=ndjson", <prompt>, ...optional flags]
cwd:      request.cwd
stdout:   takumi.exec.v1 NDJSON envelopes only
stderr:   human-readable diagnostics
env:      CHITRAGUPTA_PROJECT=request.cwd, optional CHITRAGUPTA_SOCKET override
timeout:  120_000ms by default
```

Contract rules:

1. parent parses stdout line-by-line as NDJSON
2. parent ignores stderr for protocol purposes and treats it as diagnostics only
3. parent treats a missing final `run_completed|run_failed` envelope as transport failure
4. parent maps exit codes using the published `EXEC_EXIT_CODES` contract
5. parent may retry transport failures, but should not blindly retry `config` or `usage` failures

Binary discovery order:

1. `TAKUMI_EXEC_BIN`
2. `takumi` on `$PATH`

This keeps Takumi swappable at the process boundary while still giving
Chitragupta a typed contract for orchestration.

### Other CLI-backed coding lanes

Takumi should not be the only local-process coding adapter in the registry.
Chitragupta can also represent common CLI executors as first-class capabilities:

```ts
export const CLAUDE_CLI_CAPABILITY: CapabilityDescriptor = {
	id: "cli.claude",
	kind: "cli",
	label: "Claude CLI Executor",
	capabilities: ["coding.patch-cheap", "coding.review.strict", "agent.delegate.cli-claude"],
	costClass: "low",
	trust: "local",
	health: "healthy",
	invocation: {
		id: "anthropic-cli-adapter",
		transport: "local-process",
		entrypoint: "CLAUDE_EXEC_BIN|claude",
		requestShape: "CliAdapterRequest",
		responseShape: "text",
		timeoutMs: 60_000,
		streaming: false,
	},
	tags: ["cli", "coding", "anthropic", "local"],
};

export const CODEX_CLI_CAPABILITY: CapabilityDescriptor = {
	id: "cli.codex",
	kind: "cli",
	label: "Codex CLI Executor",
	capabilities: ["coding.patch-cheap", "coding.review.strict", "agent.delegate.cli-codex"],
	costClass: "low",
	trust: "local",
	health: "healthy",
	invocation: {
		id: "openai-cli-adapter",
		transport: "local-process",
		entrypoint: "CODEX_EXEC_BIN|codex",
		requestShape: "CliAdapterRequest",
		responseShape: "text",
		timeoutMs: 60_000,
		streaming: false,
	},
	tags: ["cli", "coding", "openai", "local"],
};

export const AIDER_CLI_CAPABILITY: CapabilityDescriptor = {
	id: "cli.aider",
	kind: "cli",
	label: "Aider CLI Executor",
	capabilities: ["coding.patch-cheap", "agent.delegate.cli-aider"],
	costClass: "low",
	trust: "local",
	health: "healthy",
	invocation: {
		id: "aider-cli-adapter",
		transport: "local-process",
		entrypoint: "AIDER_EXEC_BIN|aider",
		requestShape: "CliAdapterRequest",
		responseShape: "text",
		timeoutMs: 90_000,
		streaming: false,
	},
	tags: ["cli", "coding", "aider", "local"],
};
```

These should use the generic `CliAdapterContract` shape unless a specific CLI
exposes a richer structured protocol.

## Vaayu representation

Vaayu should be modeled as a consumer-first surface.

- renders UX
- asks for capabilities
- may express interaction constraints
- does not become the routing authority

## Scarlett representation

Scarlett should be modeled as the integrity layer for the control plane.

It watches:

- integration health
- policy violations
- session and memory drift
- healing loop success
- auth degradation

Current Takumi runtime surface:

- derived Scarlett integrity report in TUI state
- status-bar integrity widget
- `/integrity` and `/scarlett` diagnostic commands

## Bridge implications for Takumi

The Takumi bridge should remain thin and engine-oriented.

Bridge responsibilities:

- forward session context
- ask for routing decisions
- report observations and healing outcomes
- consume predictions, memory recall, and push notifications

Bridge should **not** become:

- a second provider registry
- a second credential store
- a second routing engine
- a second source of truth for integration health

## Recommended next implementation steps

1. add a `CapabilityDescriptor` and `RoutingRequest` type home in Chitragupta-facing bridge types
2. expose a typed `capabilities` query + `route.resolve` API from the engine
3. move vendor-specific selection behind capability asks in Takumi
4. represent Takumi as an explicit adapter capability with health reporting
5. let Scarlett consume capability-health snapshots and policy traces

## Non-goals

This spec does **not** recommend:

- raw secret ownership in consumers
- per-app sovereign fallback stacks
- vendor-specific routing asks as primary public API
- Takumi becoming the durable control plane

## Short version

Chitragupta should control integrations.

Takumi and Vaayu should consume capabilities.

Scarlett should watch the whole thing and tell everyone when reality starts lying.