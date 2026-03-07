<p align="center">
     <img src="./logo.svg" alt="Takumi logo" width="160" />
</p>

# Checkpoint & Crash Recovery

Long-running multi-agent tasks can be interrupted — network drops, OOM kills,
accidental Ctrl-C.  Takumi's checkpoint system persists cluster state at key
moments so work is never lost.

## Storage Backends

Checkpoints are written to **two backends** in parallel (best-effort):

| Backend              | Priority | Availability         | Searchability       |
|----------------------|----------|----------------------|---------------------|
| Local filesystem     | 1st      | Always               | By cluster ID only  |
| Chitragupta Akasha   | 2nd      | When MCP is connected| Semantic search     |

**Local path:** `~/.takumi/checkpoints/<clusterId>.json`

**Akasha:** Deposited as `cluster_checkpoint` with tags
`["orchestration", clusterId, phase]`.  This enables queries like
`"/resume last authentication task"` — Akasha can semantically match against
the task description embedded in the checkpoint.

## What Gets Checkpointed

```typescript
interface ClusterCheckpoint {
  version: number;            // Schema version for forward-compat
  clusterId: string;
  phase: ClusterPhase;        // INITIALIZING | PLANNING | EXECUTING | ...
  config: ClusterConfig;      // Original cluster config (roles, strategy, etc.)
  validationAttempt: number;  // How many validation rounds so far
  plan: string | null;        // Planner output (null if not yet planned)
  workProduct: WorkProduct | null;
  validationResults: ValidationResult[];
  finalDecision: ValidationDecision | null;
  savedAt: number;            // Unix timestamp (ms)
}
```

## When Checkpoints Are Saved

Auto-checkpointing happens at every phase transition:

1. After `spawn()` — cluster initialised
2. After planning completes
3. After execution completes (work product available)
4. After each validation attempt
5. After each fix attempt
6. On `shutdown()` — final state

Manual save: `/checkpoint` slash command.

## Resume Flow

```
/resume <clusterId>
     │
     ▼
CheckpointManager.load(clusterId)
     │
     ├─ Try local file first (fast)
     ├─ Fall back to Akasha traces
     │
     ▼
ClusterOrchestrator.resume(clusterId)
     │
     ├─ Restore ClusterState from checkpoint
     ├─ Re-create AgentInstances for each role
     ├─ Set phase to checkpoint's phase
     │
     ▼
ClusterOrchestrator.execute(task)
     │
     └─ Phases already completed are skipped
        (e.g. if checkpoint.phase = VALIDATING,
         planning + execution are not re-run)
```

## Listing Checkpoints

```
/resume
```

Without an argument, lists all locally stored checkpoints sorted newest-first:

```
ID                              Phase        Saved             Task
cluster-1703275200-abc123       VALIDATING   2024-12-22 18:00  "Refactor auth module"
cluster-1703188800-def456       EXECUTING    2024-12-21 14:00  "Add user settings page"
```

Each entry shows `clusterId`, phase, timestamp, and the task description from
the original config.

## Deleting Checkpoints

Old checkpoints are not auto-pruned.  Use `CheckpointManager.delete(clusterId)`
programmatically or clear `~/.takumi/checkpoints/` manually.

## API

```typescript
import { CheckpointManager } from "./cluster/checkpoint.js";

const mgr = new CheckpointManager({
  chitragupta,           // optional — Akasha bridge
  dir: "/custom/path",   // optional — override local directory
});

// Save
await mgr.save(CheckpointManager.fromState(clusterState));

// Load
const cp = await mgr.load("cluster-abc123");
if (cp) {
  // Resume orchestration from cp.phase
}

// List
const summaries = await mgr.list();
// [{ clusterId, phase, savedAt, taskDescription }, ...]

// Delete
await mgr.delete("cluster-abc123");
```

## Error Handling

All checkpoint operations are **best-effort** — failures are logged but never
thrown.  A failing checkpoint should never crash the running cluster.

- Local write failure → warning log, Akasha still attempted
- Akasha deposit failure → warning log, local file is the recovery path
- Load failure (both backends) → returns `null`, caller handles gracefully
- Corrupt JSON in local file → skipped, logged, treated as not found
