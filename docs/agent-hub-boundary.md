# Agent Hub Boundary — Chitragupta ↔ Takumi ↔ Scarlett

> Practical handoff document for the Option C+ direction.
>
> Goal: make it explicit what the **agent hub** should own in Chitragupta,
> what Takumi should continue to own locally, what Scarlett supervises, and
> what must move through shared contracts instead of fuzzy prompt folklore.

## Executive summary

The **agent hub** belongs **primarily to Chitragupta**.

That means Chitragupta should become the canonical home for:

- routing and lane selection
- durable memory and session continuity
- capability inventory and health
- orchestration policy
- artifact promotion and replay metadata
- retry / escalation / supervision policy inputs

Takumi should remain the **privileged execution runtime**:

- coding loop
- repo-local tool execution
- patch / test / validate behavior
- TUI and slash command operator surface
- structured event emission back to the hub

Scarlett should remain the **integrity and supervision layer**:

- anomaly detection
- degraded lane / policy drift detection
- escalation recommendations
- quarantine / slowdown / stop signals

Short version:

- **Chitragupta = hub / control plane / memory brain**
- **Takumi = executor / hands / terminal runtime**
- **Scarlett = integrity watcher / immune system**

## Why this split exists

If Takumi owns too much hub logic, the system grows duplicate routing,
duplicate memory policy, and duplicate lane selection.

If Chitragupta owns too much execution detail, it becomes a bloated god-object
that knows too much about repo-local behavior and terminal UX.

The clean rule is:

- Chitragupta decides **who should do the work, with what context, under what policy**
- Takumi decides **how to perform the work inside the repo right now**
- Scarlett decides **whether the system is still trustworthy while all this is happening**

## Ownership table

| Concern | Primary owner | Notes |
|---|---|---|
| agent hub / control plane | Chitragupta | canonical owner |
| provider and CLI registry | Chitragupta | capability inventory |
| routing policy | Chitragupta | lane selection, fallback chain |
| durable session truth | Chitragupta | cross-run continuity |
| memory recall / attachment | Chitragupta | delivered into executor runs |
| artifact registry | Chitragupta | plans, reviews, validations, handoffs |
| orchestration policy | Chitragupta | single lane vs council vs worktree vs validation mesh |
| repo-local coding execution | Takumi | edit, test, patch, inspect |
| tool runtime | Takumi | permission-aware execution |
| worktree operations | Takumi | actual local git worktree actions |
| side-lane execution surface | Takumi | local side-agent and executor hooks |
| TUI / slash commands | Takumi | operator interface |
| integrity supervision | Scarlett | anomaly / drift / degradation |
| final policy override on integrity faults | Chitragupta + Scarlett | Scarlett informs, Chitragupta decides/escalates |

## What Chitragupta should do

This is the direct handoff list for Chitragupta.

### 1. Become the canonical agent hub

Chitragupta should own the top-level concepts below as durable, queryable
control-plane state:

- tasks
- lanes
- capability descriptors
- routing decisions
- promoted artifacts
- retry / escalation records
- integrity-linked execution notes

That means the hub should stop being just memory-plus-bridge and become a real
**coordination ledger**.

### 2. Own lane selection policy

Given a request such as:

- `coding.patch-and-validate`
- `coding.review.strict`
- `classification.local-fast`
- `agent.delegate.takumi`

Chitragupta should decide:

- whether to use Takumi at all
- whether to use a CLI lane instead
- whether to use a single lane, council, side lane, or worktree pattern
- whether the current integrity state permits cheap paths
- what fallback chain is allowed

Takumi should not silently invent its own sovereign routing stack.

### 3. Attach the right memory and artifacts

Before invoking Takumi, Chitragupta should be able to provide:

- relevant prior plans
- recent failed attempts
- architectural constraints
- repo/user tendencies
- promoted lessons
- open blockers
- previous validation findings

This should happen through explicit payloads / contracts, not vague “remember
what we said earlier” prompt dependence.

### 4. Track artifacts as first-class objects

The hub should track and persist artifacts such as:

- plan
- design review
- implementation result
- validation result
- worktree lane result
- handoff memo
- postmortem / reflection

Each artifact should ideally include metadata:

- `artifactId`
- `taskId`
- `laneId`
- `kind`
- `producer`
- `confidence`
- `timestamp`
- `inputs`
- `summary`
- `body`
- `promoted: boolean`

### 5. Own retries, escalation, and route changes

Chitragupta should make the high-level call for:

- retry same lane
- switch lane
- escalate to stricter validator set
- move from single lane → council
- move from council → adversarial validation
- collapse back to simpler mode when stable

Takumi can emit suggestions, but Chitragupta should own the durable decision.

### 6. Expose a typed hub API

At minimum, Chitragupta should expose a control-plane surface for:

- `capabilities.list`
- `route.resolve`
- `task.create`
- `task.update`
- `lane.start`
- `lane.complete`
- `artifact.record`
- `artifact.promote`
- `integrity.report`
- `handoff.create`
- `memory.attach`

Exact RPC naming can vary, but the semantics should exist.

## What Takumi should do

This is Takumi’s responsibility boundary.

### 1. Remain the coding executor

Takumi should continue to own:

- the live coding loop
- the repo-local tool runtime
- the patch / validate cycle
- operator interaction through the TUI
- worktree and side-lane local mechanics

Takumi is the workshop, not the state department.

### 2. Expose execution surfaces the hub can drive

Takumi should provide stable contracts for:

- headless exec runs
- structured streamed events
- worktree execution
- side-lane execution
- validation summaries
- final completion/failure envelopes

The recent `takumi exec --headless --stream=ndjson` path is the right shape.

### 3. Keep slash commands as operator verbs

Slash commands should remain in Takumi because they are part of the operator UX.

But their semantics should increasingly become:

- call a local execution surface directly, or
- call the hub and then execute the returned plan/route

Instead of being only prompt macros.

### 4. Report, do not hoard

Takumi should report back:

- route traces used locally
- worktree results
- side-lane outcomes
- validation findings
- execution telemetry
- anomalies encountered during execution

Takumi should not become the only place these things exist.

## What Scarlett should do

Scarlett is not the hub and not the executor.

Scarlett should supervise:

- degraded capabilities
- suspicious route choices
- unhealthy retry loops
- conflicting artifact conclusions
- weak validation consensus
- possible merge / integrity hazards
- memory/routing drift

Scarlett should be able to emit:

- warning
- slowdown recommendation
- lane quarantine recommendation
- stronger validation requirement
- stop / escalate recommendation

Scarlett should inform Chitragupta’s hub decisions and shape Takumi behavior,
but not replace either.

## Shared contract boundary

The boundary between Chitragupta and Takumi must be explicit.

### Required shared concepts

| Concept | Why it must be shared |
|---|---|
| `Task` | stable unit of work across hub and executor |
| `Lane` | identifies execution branch / agent / worktree / validator path |
| `Artifact` | durable output of plan / review / validation / handoff |
| `RoutingDecision` | why a lane was selected |
| `IntegrityReport` | Scarlett-informed state snapshot |
| `ExecRun` | one Takumi execution instance |
| `CapabilityDescriptor` | canonical inventory object |

### Minimum contract rule

No important boundary should rely on:

- hidden prompt conventions
- inferred state from chat history alone
- one-off shell parsing hacks
- “Takumi just knows what Chitragupta meant”

Use structured payloads whenever the information matters across runs.

## Recommended migration boundary

### Move into Chitragupta

These should become hub-owned:

- canonical route resolution
- lane topology policy
- capability approval / deny list
- durability of task and artifact state
- cross-session continuity
- artifact promotion rules
- escalation history
- canonical side-lane metadata

### Keep in Takumi

These should remain runtime-owned:

- local file edits
- local test execution
- worktree creation / exec / merge / destroy
- terminal-native UX
- coding-agent orchestration internals needed for repo mutation
- permission-gated local tool execution

### Shared / contractized

These should be explicit interfaces rather than fuzzy ownership:

- task request schema
- exec request schema
- lane result schema
- validation result schema
- artifact schema
- integrity signal schema

## Concrete responsibilities by system

### Chitragupta — required work

1. Define the hub domain model:
   - tasks
   - lanes
   - artifacts
   - routing decisions
   - integrity annotations
2. Expose typed control-plane methods for route + lane + artifact operations.
3. Own capability inventory and health snapshots.
4. Attach memory/artifact context before Takumi runs.
5. Persist promoted outcomes and handoff state.
6. Decide escalation and fallback policy.
7. Consume execution reports from Takumi and update canonical task state.

### Takumi — required work

1. Preserve a stable executor contract (`takumi exec`).
2. Keep local coding/tool/worktree execution reliable.
3. Emit structured artifacts/events back to the hub.
4. Make slash commands progressively call native runtime/hub actions instead of only prompts.
5. Continue exposing worktree and side-lane mechanics as clean execution surfaces.
6. Remain thin on durable routing authority.

### Scarlett — required work

1. Produce integrity signals and route-risk annotations.
2. Flag degraded lanes and suspicious retries.
3. Recommend stronger validation when trust drops.
4. Feed integrity state to both Chitragupta and Takumi.

## Immediate next steps

### For Chitragupta

1. Create the hub data model for `Task`, `Lane`, and `Artifact`.
2. Add typed APIs for route resolution and artifact recording.
3. Support pre-run memory/artifact attachment into Takumi exec requests.
4. Record route policy traces and fallback chains durably.
5. Accept Takumi execution reports as first-class task updates.

### For Takumi

1. Keep strengthening native runtime-backed slash commands.
2. Emit richer structured results for plan/review/validation/handoff flows.
3. Add clearer artifact packaging so Chitragupta can persist outcomes without re-parsing prose.
4. Keep local execution responsibilities crisp; avoid silently growing sovereign hub logic.

## Non-goals

This handoff does **not** recommend:

- moving all coding logic into Chitragupta
- making Takumi a dumb terminal shell
- making Scarlett the routing engine
- duplicating route authority in both Chitragupta and Takumi
- relying on prompt-only conventions for durable workflow state

## Direct handoff message

If you want the shortest direct brief to hand Chitragupta, use this:

> Chitragupta should become the canonical **agent hub** for the ecosystem: own routing, lane selection, memory attachment, capability inventory, artifact persistence, and escalation policy. Takumi remains the privileged **coding executor** that performs repo-local work, exposes headless execution and native runtime surfaces, and reports structured outcomes back. Scarlett remains the **integrity supervisor** that flags degraded lanes, drift, and weak consensus. The boundary between Chitragupta and Takumi must be explicit and typed: tasks, lanes, artifacts, routing decisions, integrity reports, and exec results should move through contracts, not prompt folklore.
