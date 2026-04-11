# Takumi Integration With Chitragupta

I use this document as the working contract between Takumi and Chitragupta.

I want this to be easy to scan and easy to turn into implementation work.

## Legend

- `[have]` current contract or current truth I can rely on
- `[need]` missing contract I need from Chitragupta
- `[rule]` behavior Takumi must follow
- `[lucy]` bounded Takumi-local fallback when Chitragupta is unavailable

## 1. Control Plane

- `[have]` I treat Chitragupta as the control plane for canonical session identity, canonical turn persistence, memory scopes, provider and model inventory, health truth, route recommendation, connector auth scope, skill discovery, and UI extension discovery.
- `[rule]` If Chitragupta is reachable, Takumi must integrate with it and must not create a competing durable control plane.
- `[have]` I now have one explicit runtime binding envelope on daemon RPC via `bridge.bootstrap`:
  - `authority`
  - `transport`
  - `binding.project`
  - `session.id`
  - `route`
  - `degraded`
  - `warnings`
  - `requestId`
  - `traceId`
- `[have]` I now have the same canonical bootstrap envelope exposed on daemon RPC, MCP, and HTTP attachment surfaces.
- `[have]` Bootstrap consumer hints now fail closed across:
  - top-level `consumer`
  - `session.consumer`
  - `route.consumer`
- `[have]` The bootstrap and attachment envelopes now carry daemon-canonicalized execution identity:
  - `taskId`
  - `laneId`
  - if Takumi supplies either id, Chitragupta preserves it
  - if either id is absent, Chitragupta mints only the missing canonical id
- `[have]` HTTP and MCP attachment surfaces now accept the same execution identity inputs as daemon RPC bootstrap:
  - top-level `taskId?`
  - top-level `laneId?`
  - `execution.task.id?`
  - `execution.lane.id?`
- `[have]` Those execution identities are now preserved end-to-end by the Takumi bridge, coding router, and MCP coding surface when the daemon is reachable, instead of being synthesized independently by compatibility bridges.
- `[rule]` If Takumi sends both top-level and nested execution ids, they must match. Chitragupta now fail-closes bootstrap when they disagree.

## 2. Transport Order

- `[have]` Preferred order is:
  1. daemon RPC
  2. MCP
  3. direct local/provider execution only as explicit degraded fallback
- `[rule]` MCP is a transport fallback, not a different authority model.
- `[rule]` Direct local execution is non-canonical and must be marked degraded.
- `[have]` I now have an explicit transport/error split:
  - transport/availability states such as `unreachable` or `reachable but degraded` come from bridge and health/status surfaces
  - typed daemon RPC failures are the daemon app/error codes such as:
    - `AUTH_FAILED`
    - `INVALID_ROUTE_METADATA`
    - `PROJECT_ACCESS_DENIED`
- `[have]` I now have explicit capability freshness semantics on `bridge.info`, `bridge.capabilities`, and `bridge.bootstrap.capabilities`:
  - `snapshotAt`
  - `expiresAt: null`
  - `cacheScope: "request"`
  - `authoritativeSource: "daemon"`
  - `stale: false`
  - `staleReason: null`
- `[rule]` Takumi must treat capability truth as request-scoped
- `[have]` I now have one canonical `routingDecision` envelope reused across:
  - `route.resolve`
  - `bridge.bootstrap`
  - `models.recommend`
- `[have]` That envelope now carries:
  - `authority`
  - `source`
  - `routeClass`
  - `capability`
  - `selectedCapabilityId`
  - `provider`
  - `model`
  - `requestedBudget`
  - `effectiveBudget`
  - `degraded`
  - `reasonCode`
  - `reason`
  - `policyTrace`
  - `fallbackChain`
  - `discoverableOnly`
  - `requestId`
  - `traceId`
  - `snapshotAt`
  - `expiresAt`
  - `cacheScope`
- `[rule]` Takumi must branch on `routingDecision.reasonCode`, not prose `reason`.
- `[rule]` Takumi must treat `routingDecision` as request-scoped and non-reusable across reconnects or fresh bootstraps.
 daemon authority and refresh it on the next authoritative bootstrap or attach instead of reusing stale local snapshots across reconnects.
- `[rule]` If daemon authority is unavailable, Takumi must fail closed on `bridge.info` / `bridge.capabilities` truth instead of inventing a local capability registry.

## 3. Bootstrap

- `[have]` Canonical daemon bootstrap order is now:
  1. `bridge.bootstrap`
  2. `bridge.capabilities` when deeper introspection is needed
  3. `context.load`
  4. `models.recommend` or `models.list`
  5. `models.status` before hard pinning
  6. `chat.complete` / `chat.stream` or a local executor path that persists through canonical write surfaces
- `[have]` `bridge.bootstrap` may also open or collaborate a session and resolve a route in the same authoritative response.
- `[rule]` Interactive, headless, desktop, and future device clients should consume the same bootstrap truth.
- `[have]` I now have one canonical bootstrap response shape on daemon RPC via `bridge.bootstrap`:
  - `contractVersion`
  - `protocol`
  - `connected`
  - `degraded`
  - `transport`
  - `authority`
  - `auth`
  - `binding`
  - `session`
  - `route`
  - `routingDecision`
  - `warnings`
  - `requestId`
  - `traceId`
  - `taskId`
  - `laneId`
  - `capabilities?`
- `[have]` Bootstrap mode semantics now exist for:
  - `interactive`
  - `exec`
  - `doctor`
  - `remote_attach`
- `[have]` I now have the same canonical bootstrap contract exposed consistently on daemon RPC, MCP, and HTTP attachment surfaces.

## 4. Sessions

- `[have]` I treat Chitragupta session IDs as canonical.
- `[have]` Primary surfaces are:
  - `session.open`
  - `session.collaborate`
  - `session.create`
  - `session.show`
  - `session.list`
  - `session.delete`
  - `session.modified_since`
  - `session.meta.update`
  - `session.lineage_policy`
- `[rule]` Takumi should call `session.open` for normal work.
- `[rule]` Takumi should call `session.collaborate` only for explicit shared-thread continuity.
- `[rule]` Takumi must always pass a real `project`.
- `[rule]` Takumi must preserve the returned canonical `sessionId`.
- `[have]` Session attachment semantics are now explicit:
  - attachment is optimistic, not exclusive
  - multiple surfaces may attach to the same `sessionId`
  - canonical writes are serialized per session, but attach is not a lock
  - there is no active-lane ownership or presence heartbeat in the current contract
  - metadata conflict resolution is runtime queue order / last accepted write, not merge semantics
- `[have]` `session.open` and `session.collaborate` now support replay-safe mutation identity via:
  - `requestId`
  - `idempotencyKey`
- `[have]` `session.create`, `session.delete`, and `session.meta.update` now support the same replay-safe mutation identity via:
  - `requestId`
  - `idempotencyKey`
- `[have]` `session.create`, `session.delete`, and `session.meta.update` now fail closed when the same replay key is reused for a different durable payload or delete identity.
- `[have]` External daemon RPC no longer treats `authScopeSubject` as a caller-owned partition key:
  - Chitragupta derives it from the bound socket identity
  - `daemon-user:<tenant>:<principalUserId>` when the socket proves a bound end-user principal
  - `daemon-auth:<tenant>:<keyId>` when auth is present but no principal user is bound
  - `daemon-client:<clientId>` when the socket is external but no auth principal is bound
  - only trusted internal bridge calls may carry an explicit end-user auth scope through to the daemon
- `[rule]` Takumi must not try to mint or spoof `authScopeSubject` on direct daemon RPC session mutations.
- `[have]` External daemon RPC session creation is now budgeted by Chitragupta itself:
  - the daemon enforces a per-actor, per-project mutation budget on `session.create`
  - that same budget applies to `session.open` / `session.collaborate` only when they would create a new session
  - idempotent replay and pure existing-session loads do not consume the create budget
  - rate-limited calls return typed `RATE_LIMITED` failure data with `retryAfterMs`
- `[have]` Retry-safe return behavior now includes:
  - `created`
  - `idempotent?`
  - `idempotencyKey?`
  - `requestId?`
- `[have]` Keyed `session.delete` now returns:
  - `deleted`
  - `existed`
  - `idempotent?`
  - `idempotencyKey?`
  - `requestId?`
- `[have]` HTTP attachment surfaces now accept the same session-open fields Takumi needs:
  - `project` or compatibility `projectPath`
  - `title?`
  - `requestId?`
  - `idempotencyKey?`
  - `agent?`
  - `model?`
  - `provider?`
  - `branch?`
  - `parentSessionId?`
  - `tags?`
  - `metadata?`
  - `clientKey?`
  - `sessionLineageKey?`
  - `lineageKey?`
  - `sessionReusePolicy?`
  - `consumer?`
  - `surface?`
  - `channel?`
  - `actorId?`
- `[have]` The same replay-safe mutation identity now exists on turn writes:
  - `turn.add.requestId?`
  - `turn.add.idempotencyKey?`
  - `session.turn.requestId?`
  - `session.turn.idempotencyKey?`
- `[rule]` Takumi should send a stable per-attempt mutation key on any retryable turn write.
- `[rule]` Takumi must not invent a second turn if the first write timed out before ack.
- `[have]` Current turn-write retry behavior is:
  - with explicit `requestId` or `idempotencyKey` and a provided `turnNumber`, Chitragupta deduplicates an exact same-number durable turn
  - with explicit `requestId` or `idempotencyKey` and no `turnNumber`, Chitragupta deduplicates only when there is exactly one durable equivalent canonical turn
  - ambiguous keyed replay fails closed
  - duplicate comparison canonicalizes structured `contentParts` / `toolCalls`, so nested object key order alone does not create a second durable turn
  - if a keyed retry resolves through an already-durable explicit `turnId`, Chitragupta backfills the keyed receipt so later retries stay anchored to the same turn
  - omitted `turnNumber` can use a verified cached-tail fast path on the common append/retry case, but only when canonical markdown mtime and indexed max-turn still agree
  - if the canonical markdown source changes while Chitragupta is reading it or before replace, `turn.add` / `session.turn` fail closed and Takumi must reload canonical session truth before retrying
- `[need]` The remaining replay-safe identity gap is now narrower:
  - any future session mutation surfaces that still mutate state without caller-supplied idempotency

## 5. Turns And History

- `[have]` Primary turn write surfaces are:
  - `turn.add`
  - `session.turn`
- `[have]` Primary turn read surfaces are:
  - `turn.list`
  - `turn.since`
  - `turn.max_number`
- `[have]` normalized turn fields already include:
  - `turnId`
  - `turnNumber`
  - `role`
  - `content`
  - `contentParts`
  - `toolCalls`
  - `agent`
  - `model`
- `[rule]` If Takumi is using daemon chat as the primary conversation surface, Takumi must not double-record the same user and assistant exchange.
- `[have]` Current turn cursor semantics for history pickup are explicit:
  - `turn.since` is exclusive: it returns turns where `turnNumber > sinceTurnNumber`
  - ordering is `turn_number_asc`
  - pagination is `none`
  - `turn.list` and `turn.since` return a `cursor` block with `kind`, `orderedBy`, `pagination`, `inclusive`, `requestedSinceTurnNumber`, `nextSinceTurnNumber`, `maxTurn`, and `hasMore`
  - `turn.since` preserves stable `turnId` values even when Chitragupta falls back to markdown truth
  - `turn.max_number` returns canonical durable max-turn truth and the same turn-number cursor metadata
  - when canonical markdown is missing, `turn.max_number` first attempts indexed rebuild before returning a durable max
  - when canonical markdown is corrupt or missing and not rebuildable, `turn.max_number` fails closed instead of trusting stale indexed state
- `[rule]` Takumi should use `turn.max_number` then `turn.since`, and treat `hasMore=false` with `pagination="none"` as authoritative.
- `[need]` I still need explicit delete/import semantics if Chitragupta later adds turn-history rewriting surfaces.
- `[need]` I need a contract for tool outcome persistence:
  - whether tool calls are embedded in turns only
  - whether tool results can be partial
  - whether a failed tool can still produce a durable turn

## 6. Memory

- `[have]` I treat session turns and memory scopes as different things.
- `[have]` Canonical memory scopes are:
  - `global`
  - `user`
  - `project`
  - `agent`
- `[rule]` Sessions stay project-anchored, but durable memory can be user-centered when Takumi knows the principal via `userId`.
- `[rule]` Provider/model changes must not fork durable user memory; they only change authorship metadata on the writes that created the content.
- `[have]` Canonical read surfaces are:
  - `memory.get`
  - `memory.scopes`
  - `memory.search`
  - `memory.recall`
  - `memory.unified_recall`
  - `memory.file_search`
  - `recall.semantic`
  - `graphrag.search`
  - `context.load`
- `[have]` Canonical write surfaces are:
  - `memory.append`
  - `memory.update`
  - `memory.delete`
  - `fact.extract`
- `[rule]` Takumi should not stuff full conversation history into memory scopes.
- `[rule]` Project-scoped writes must fail closed when project access cannot be proven.
- `[have]` Current memory write semantics are explicit:
  - `memory.append` is serialized per scope, defaults `dedupe=true`, uses heuristic normalized-content dedupe, may drop low-signal entries, truncates oldest entries to stay within the `500_000` byte budget, requires a bound principal identity for user-scoped writes, and is daemon-rate-limited per actor and scope on external RPC
  - `memory.update` is serialized per scope, whole-scope overwrite, last-write-wins, requires a bound principal identity for user-scoped writes, and is daemon-rate-limited per actor and scope on external RPC
  - `memory.delete` is idempotent, returns success even when the scope did not exist before deletion, requires a bound principal identity for user-scoped deletes, and is daemon-rate-limited per actor and scope on external RPC
  - there is still no compare-and-swap or revision precondition; queue order is the conflict rule
- `[have]` Recall semantics are now explicit:
  - `memory.search` / `memory.recall` are turn-oriented recall/search surfaces
  - `memory.recall` now follows the same project-scope rule as `memory.unified_recall`: on a multi-project socket, Takumi must send explicit `project`
  - `memory.file_search` is raw memory-file search
  - `memory.unified_recall` is cross-layer recall across sessions, memory, day files, Akasha, and related stores
  - `context.load` is prompt-time assembly, not a raw recall listing surface
- `[rule]` User-scoped memory is intentionally hidden from broad enumeration and raw file search unless Takumi explicitly supplies the matching `userId`.
- `[rule]` `userId` is not just a filter. Takumi must only request user-scoped reads or writes when it is acting on behalf of that same principal, because Chitragupta now fail-closes those calls unless the acting surface is bound to the matching principal identity.
- `[rule]` On authenticated daemon RPC sockets, that principal binding must come from bridge auth. Takumi must not try to mint or override user identity through `client.identify`.
- `[rule]` Current compatibility exception: a bridge token with `tenantId: "user:<id>"` can bind that same principal on the daemon socket.
- `[rule]` `context.load` and `memory.unified_recall` can include user-scoped memory when Takumi supplies `userId` and the acting surface is bound to that same principal.

## 7. Providers, Models, And Routes

- `[have]` I treat these as the primary provider and model surfaces:
  - `bridge.info`
  - `models.list`
  - `models.recommend`
  - `models.status`
- `[rule]` If Takumi wants Chitragupta to choose, Takumi should use `models.recommend`.
- `[rule]` If Takumi wants hard pinning, Takumi should call `models.status` and then pass explicit values.
- `[rule]` If an authoritative route envelope is returned, Takumi must not silently substitute a different provider or model.
- `[have]` I now have one authoritative route envelope shape from `route.resolve` / `bridge.bootstrap.route.resolved`:
  - `contractVersion`
  - `resolved.authority`
  - `resolved.routeClass`
  - `resolved.capability`
  - `resolved.selectedCapabilityId`
  - `resolved.provider`
  - `resolved.model`
  - `resolved.degraded`
  - `resolved.reasonCode`
  - `resolved.reason`
  - `resolved.snapshotAt`
  - `resolved.expiresAt`
  - `resolved.cacheScope`
  - `routingDecision`
- `[rule]` `laneId` is not part of the route envelope. Takumi must read execution identity from `bridge.bootstrap`.
- `[rule]` Takumi must branch on `resolved.reasonCode` for stable route handling and treat prose `resolved.reason` as explanation text only.
- `[have]` I now have explicit freshness semantics for provider and model inventory:
  - model surfaces expose `freshness.snapshotAt`, `freshness.expiresAt`, `freshness.cacheScope`, `freshness.authoritativeSource`, `freshness.stale`, and `freshness.staleReason`
  - daemon-owned model responses are request-scoped snapshots
  - local fallback model responses are marked `authoritativeSource: "local_fallback"` and `stale: true`
  - route envelopes are also request-scoped point-in-time decisions with `resolved.snapshotAt`, `resolved.expiresAt`, and `resolved.cacheScope`
- `[rule]` Takumi must refresh authoritative model truth before hard pinning and after any degraded fallback model response.

## 8. Chat And Streaming

- `[have]` Primary daemon chat methods are:
  - `chat.complete`
  - `chat.stream`
  - `chat.cancel`
- `[rule]` Preferred flow is:
  1. resolve canonical session
  2. choose route or pin explicitly
  3. call chat surface
  4. let daemon chat own canonical persistence for that exchange
- `[rule]` Takumi must provide `projectPath` when starting a new chat session.
- `[rule]` Takumi may omit `projectPath` only when it is resuming an existing canonical session through `sessionId`.
- `[have]` I now have an exact daemon `chat.stream` event contract:
  - `start`
  - `assistant_delta` via `type: text_delta`
  - `tool_call_start`
  - `tool_call_delta`
  - `usage_final`
  - `completed` via `type: done`
  - `error`
- `[rule]` daemon chat does not execute tools in-stream, so this surface does not emit `tool_result` events.
- `[rule]` if a stream already emitted notifications and then fails, Takumi must treat the RPC as failed; Chitragupta does not fabricate a final success envelope after a mid-stream provider failure.
- `[have]` I now have a first-class cancel path:
  - `chat.cancel`
  - explicit acknowledgement by `streamId` or `requestId`
  - terminal `aborted` stream event instead of forcing Takumi to infer cancel from a transport error
- `[have]` daemon chat request replay is now execution-safe:
  - one owner-scoped `requestId` maps to one live daemon chat execution
  - duplicate `chat.complete` / `chat.stream` retries reuse the in-flight or completed result instead of re-running the model
  - reusing one owner-scoped `requestId` for a different normalized chat payload fails closed with `request_id_payload_mismatch`
- `[have]` Streamed events now carry:
  - `sessionId`
  - `requestId`
  - `traceId`
  - route metadata
  - final `userTurnNumber`
  - final `assistantTurnNumber`
  - final `persistenceDegraded`
  - final `persistenceWarnings`
  - final `semanticDegraded`
  - final `semanticWarnings`
  - final `semanticFailedStages`
- `[have]` Chat write freshness stays degraded if either persisted turn misses semantic refresh:
  - a later assistant-turn semantic success does not clear an earlier user-turn semantic failure
- `[have]` I now have a rule for `history` input:
  - if `sessionId` is present, Chitragupta uses canonical session turns
  - Takumi must not also send `history` in that case
  - Takumi may send `history` only for a new or ad-hoc chat request without canonical session continuity
- `[have]` Serve/API-instance surfaces guard the live user-message ingress path before Lucy/model execution:
  - daemon `chat.complete` / `chat.stream` now follow the same ingress contract
  - they sanitize secret and opaque payloads first
  - they detect obvious prompt-injection text that tries to override higher-priority instructions, reveal hidden prompts, or extract secrets/tools
  - when they flag that text, they prepend a deterministic untrusted-content safety notice to the effective prompt
- `[rule]` Takumi must treat the canonical user turn and the effective guarded prompt as different truths:
  - the canonical turn is the sanitized user-authored text
  - the effective prompt may include Chitragupta-owned safety or guidance preamble
  - Takumi must not rewrite the canonical turn to include that Chitragupta-owned preamble

## 9. Skills, Connectors, And UI Extensions

- `[have]` I do not assume one generic plugin-install RPC.
- `[have]` Current supported surfaces are split across:
  - skills
  - vidhi
  - Tap connectors
  - UI extensions and widgets
  - external MCP servers
  - executor-agent adapters
- `[have]` Current Tap call contract is strict:
  - omitted `tap_call.input` is treated as `{}`
  - present `tap_call.input` must be a JSON object
  - malformed present values are rejected instead of coerced
- `[rule]` If Chitragupta is reachable, Takumi should not create a second registry for these.
- `[need]` I need a stronger operational contract for UI extensions:
  - prompt IDs
  - prompt versioning
  - prompt resolve and cancel semantics
  - widget invalidation
  - remote action correlation
  - subscription or watch support
- `[need]` I also need explicit multi-client UI ownership rules:
  - whether multiple attached clients may see the same active prompt
  - whether one client may claim or lock a prompt while responding
  - whether prompt responses are first-wins or revision-checked
  - how widget state should merge or replace when multiple clients are attached
- `[need]` I need connector execution semantics:
  - auth expiry behavior
  - permission denied shape
  - scope proof failures
  - retry rules

## 10. Delegation And Subagents

- `[have]` Every delegated request should preserve:
  - `taskId`
  - `laneId`
  - parent and child lineage
  - `sessionId`
  - `projectPath`
- `[have]` Current child config can request:
  - `providerId`
  - `model`
  - `profile`
  - `tools`
  - `systemPrompt`
  - `thinkingLevel`
  - `workingDirectory`
  - `taskKey`
- `[have]` Current truth is that `model` override is real and `providerId` override is only partially real.
- `[rule]` Takumi should treat provider override as best-effort unless the route envelope explicitly guarantees it.
- `[need]` I need a stronger delegation contract for:
  - parent-child turn persistence
  - lane identity
  - child session reuse vs child fresh session
  - subagent route inheritance
  - subagent failure import back into parent
- `[need]` I also need a remote lane-control contract for operator surfaces:
  - lane list and lane status
  - lane attach or focus
  - lane send-input semantics
  - lane stop or cancel semantics
  - lane output tail or watch semantics
  - terminal coordinate identity that does not require Takumi to infer raw tmux state
- `[rule]` Takumi should treat daemon lane identity as the primary remote-control key, not terminal-emulator-specific coordinates.

## 11. Resume, Pickup, And Incremental Sync

- `[have]` Desired durable resume flow is:
  1. `session.open` or `session.show`
  2. `turn.max_number`
  3. `turn.since`
  4. `session.modified_since` for multi-session polling
  5. `context.load` after a long gap or device change
- `[rule]` Takumi should not treat its own private local buffer as authoritative recovery when Chitragupta is reachable.
- `[need]` I need exact sync semantics for:
  - same-device resume
  - cross-device pickup
  - detached lane pickup
  - conflict after parallel writes
  - missing turns after reconnect
- `[need]` I need an attach-state contract for multi-surface clients:
  - active attached clients for a session or lane
  - client presence TTL or heartbeat
  - last attached surface
  - whether a newly attached client should receive a snapshot, a delta stream, or both
  - whether session titles, branch labels, and lane labels are canonical or advisory

### 11.1 Latency, Timeouts, And Fallback Budgets

- `[have]` Speed and responsiveness are part of correctness for Takumi. A slow authoritative answer is not enough if it misses the budget for the current surface.
- `[rule]` Every Chitragupta call Takumi makes must have an explicit timeout budget class.
- `[rule]` Fallback must trigger on timeout budget breach, not only on hard unreachability.
- `[rule]` Fallback must be decided per operation or surface, not as a global panic switch.
- `[rule]` If Takumi has already entered Lucy fallback for an active operation, a late Chitragupta reply must not silently overwrite the active local result.
- `[have]` Chitragupta structured degraded bridge reads now expose explicit machine-readable fallback metadata:
  - `fallbackReason`
  - `timedOutOperation`
  - `authoritativeSource`
  - `reconcileRequired`
- `[rule]` Every timeout-triggered fallback must preserve:
  - `fallbackReason`
  - `timedOutOperation`
  - `startedAt`
  - `requestId`
  - `traceId`
  - `authoritativeSource: "takumi-local"`
  - `reconcileRequired: true`
- `[need]` I need explicit timeout classes and default budgets for:
  - `bridge.info`
  - `bridge.capabilities`
  - `models.status`
  - `models.recommend`
  - `session.open`
  - `turn.since`
  - `context.load`
  - `chat.complete`
  - `chat.stream` handshake
  - `chat.stream` stall detection
  - `chat.cancel`
  - `memory.append`
  - `memory.update`
- `[need]` I need explicit fallback permissions by operation class:
  - may fall back to cached snapshot
  - may fall back to Lucy local execution
  - must fail closed
  - may queue for later reconcile
- `[need]` I need an explicit stale-result rule:
  - whether late authoritative results should be ignored
  - whether they may be surfaced as advisory only
  - whether they may be imported manually after the active fallback run ends
- `[lucy]` Lucy may start when:
  - transport is unreachable
  - auth refresh is impossible within budget
  - capability truth is stale past allowed TTL
  - a request exceeds its assigned timeout budget
- `[lucy]` Lucy must not automatically escalate from one timed-out probe into full local autonomy unless the contract explicitly allows that transition.

## 12. Degraded Fallback

- `[have]` If daemon RPC is unavailable, Takumi should use MCP if possible.
- `[have]` If MCP is also unavailable, Takumi may run a local degraded mode.
- `[have]` Allowed local degraded state is limited to:
  - current transient session buffer
  - direct provider and model inventory needed to keep working
  - temporary plugin or connector cache strictly for local execution
- `[rule]` Takumi must mark degraded local mode as:
  - local-only
  - non-canonical
  - reconnect and reconcile required
- `[rule]` Takumi must fail closed when:
  - an enforced route cannot be honored
  - authoritative route metadata is invalid
  - provider or model authority is required and unavailable
  - a project-scoped write cannot prove project access
  - a canonical session operation cannot prove the target project or session
- `[need]` I need an explicit reconnect contract:
  - import selected local turns
  - import selected local memory
  - start a new canonical session instead
  - reject import because of conflict
- `[need]` I need a canonical import surface for degraded recovery.

### 12.1 Lucy

- `[lucy]` If Chitragupta is unavailable, Lucy is the bounded Takumi-local fallback.
- `[lucy]` Lucy may own:
  - transient local session buffer
  - local turn ledger with local cursor
  - local provider and CLI snapshot for degraded execution
  - explicit `takumi-fallback` route envelope
  - explicit import manifest for later reconciliation
- `[lucy]` Lucy must not claim ownership of:
  - canonical session IDs
  - canonical lineage policy
  - canonical memory scopes
  - connector auth truth
  - provider or model health truth
  - route authority

## 13. Auth, Identity, And Access

- `[have]` The document already assumes project-scoped operations require project access and fail closed when access cannot be proven.
- `[have]` Daemon RPC now distinguishes invalid route metadata from transport-authenticated but project-unauthorized requests.
- `[need]` I still need explicit identity propagation fields:
  - `userId`
  - `deviceId`
  - `actorId`
  - `consumer`
  - `surface`
  - `channel`
- `[need]` I need auth lifecycle semantics:
  - credential expired
  - token refresh possible
  - token refresh impossible
  - permission denied
  - transport authenticated but project unauthorized

## 14. Observability

- `[have]` Chitragupta is treated as the authority for health and degraded-state truth.
- `[have]` Daemon bootstrap now returns a machine-readable correlation envelope with:
  - `requestId`
  - `traceId`
  - `transport`
  - `authority`
  - `degraded`
- `[need]` I still need a canonical tracing and correlation envelope for every important request:
  - `requestId`
  - `traceId`
  - `sessionId?`
  - `laneId?`
  - `taskId?`
  - `transport`
  - `authority`
  - `degraded`
- `[need]` I need the same observability contract to survive:
  - daemon RPC
  - MCP
  - Lucy fallback
- `[need]` I also need low-cost performance observability for operator surfaces:
  - bootstrap phase timings
  - route-resolution latency
  - session-open latency
  - stream handshake latency
  - stream stall detection metadata
  - remote prompt round-trip latency
- `[rule]` Performance telemetry should be correlation-safe and cheap enough to emit on normal interactive startup paths.

## 14.1 Additional Contract Gaps I Should Not Miss

- `[need]` I need explicit protocol and schema versioning beyond the live bootstrap protocol descriptor:
  - stream event schema version
  - attachment and prompt schema version
  - cross-surface minimum supported version negotiation beyond bootstrap
- `[rule]` Takumi must fail closed on incompatible control-plane schema versions instead of guessing field meanings.
- `[need]` I need server-driven change notification semantics for dynamic registries:
  - skills changed
  - models changed
  - routes changed
  - UI extensions changed
  - connectors changed
  - approval queue changed
- `[need]` For every watch or subscription surface I need:
  - subscribe shape
  - unsubscribe shape
  - snapshot-first vs delta-first behavior
  - monotonic sequence or revision number
  - replay after reconnect
  - missed-event recovery rule
- `[need]` I need a canonical approval and permission contract:
  - approval ID
  - approval scope
  - approval expiry
  - approve / deny / allow-for-session semantics
  - what event resumes after approval
  - whether approvals are first-wins, revision-checked, or idempotent
- `[rule]` Takumi must not infer approval lifetime or replay a stale approval action against a newer pending request.
- `[need]` I need a canonical artifact contract:
  - artifact ID
  - artifact kind
  - summary vs full body
  - MIME or content-type
  - size metadata
  - promoted vs ephemeral state
  - retention and deletion policy
  - whether artifacts are session-scoped, lane-scoped, or global
- `[need]` I need attachment and blob semantics for multimodal or large payloads:
  - upload path
  - download path
  - reference form inside turns
  - expiry
  - dedupe behavior
  - binary size limits
- `[need]` I need explicit truncation and limits policy:
  - max turn size
  - max tool-result size
  - max stream chunk size
  - max memory write size
  - max artifact inline body size
  - whether truncation is silent, explicit, or fail-closed
- `[rule]` Takumi must never silently drop canonical content because of an undocumented limit.
- `[need]` I need backpressure and long-operation progress semantics:
  - progress event shape
  - queue depth or busy signal
  - retry-after or throttling hint
  - long-running import/index/export progress
- `[need]` I need explicit partial-failure semantics for compound operations:
  - bootstrap that binds session but fails route resolution
  - route success with capability degradation
  - memory write success with recall index lag
  - artifact persisted but promotion failed
- `[need]` I need audit and authorship attribution on canonical writes:
  - which actor
  - which device
  - which surface
  - which lane
  - whether the write came from Lucy fallback import
- `[rule]` Takumi should surface canonical authorship metadata when multi-device or multi-surface ambiguity matters.

## 15. Practical Sequences

### 15.1 New coding session

- `[have]`
  1. `bridge.bootstrap`
  2. `context.load`
  3. `models.recommend` or `models.list`
  4. `models.status` if pinning
  5. work
  6. persist extra durable notes with `turn.add` or `memory.append` when needed

### 15.2 Shared collaboration

- `[have]`
  1. `session.collaborate`
  2. `turn.max_number`
  3. `turn.since`
  4. continue in the shared canonical session

### 15.3 MCP attachment

- `[have]`
  1. `chitragupta_context`
  2. `chitragupta_session_list` or `chitragupta_session_show`
  3. `chitragupta_record_conversation`
  4. `chitragupta_memory_search`
  5. `skills_*`, `tap_*`, `chitragupta_ui_extensions`, `chitragupta_widget_data`

## 16. What Takumi Must Not Re-Own

- `[rule]` If Chitragupta is reachable, Takumi must not re-own these as a second durable authority:
  - canonical session IDs
  - session lineage policy
  - canonical turn ledger
  - global, project, or agent memory files
  - connector credential scope
  - provider and model health truth
  - route authority
  - skill registry truth
  - UI extension registry truth

## 17. What I Need From Chitragupta Next

- `[have]` replay-safe mutation contract for `session.open`, `session.collaborate`, `turn.add`, and `session.turn`
- `[have]` precise cursor and pagination contract for `turn.list`, `turn.since`, and `turn.max_number`
- `[need]` replay-safe mutation parity on the remaining session mutation surfaces
- `[have]` full daemon `chat.stream` event schema
- `[have]` first-class `chat.cancel` acknowledgement and aborted terminal stream semantics
- `[need]` degraded import and reconcile API
- `[have]` daemon auth and access failure taxonomy on the RPC surface
- `[need]` the same taxonomy normalized across MCP and HTTP attachment surfaces
- `[need]` remote prompt and widget action contract
- `[need]` cross-device attach and presence contract
- `[need]` remote lane-control and lane-watch contract
- `[need]` canonical attach-state snapshot for multi-client terminal surfaces
- `[need]` low-cost latency and performance observability fields beyond bootstrap
- `[need]` canonical tracing envelope across every surface, not only daemon bootstrap
- `[need]` schema version negotiation and compatibility failure semantics beyond daemon bootstrap
- `[need]` dynamic-registry change notifications and watch recovery rules
- `[need]` approval lifetime and resume semantics
- `[need]` artifact, attachment, and truncation contracts
- `[need]` backpressure, throttling, and long-operation progress semantics
- `[need]` canonical authorship and audit attribution on writes

## 18. Bottom Line

- `[have]` I already have the right authority direction.
- `[have]` I already have the right transport priority.
- `[have]` I now have a canonical daemon bootstrap envelope and typed project and route failure classes.
- `[have]` I already have the right separation between sessions, turns, memory, routes, and degraded fallback.
- `[need]` I still need remaining session-mutation parity and fallback-reconcile semantics before Takumi can implement this cleanly end to end.
- `[rule]` If Chitragupta is reachable, Takumi integrates with it.
- `[lucy]` If Chitragupta is not reachable, Lucy keeps Takumi working locally without pretending to be canonical.
