# Isolation Modes

Takumi supports three isolation levels for cluster execution.  They control
where agent-produced file changes land, from zero isolation (direct CWD
mutation) to full container sandboxing.

## Overview

| Mode       | Mechanism            | Safety | Speed  | Requirements      |
|------------|----------------------|--------|--------|-------------------|
| `none`     | Current working dir  | Low    | Fast   | —                 |
| `worktree` | Git worktree in tmp  | Medium | Fast   | Git repo          |
| `docker`   | Container + bind mnt | High   | Slower | Docker daemon     |

Set via config or slash command:

```jsonc
{ "orchestration": { "isolationMode": "worktree" } }
```
```
/isolation worktree
```

## `none` — No Isolation

The cluster operates directly in `process.cwd()`.  All file reads/writes hit
the real working tree.

**When to use:** Quick tasks, trusted single-agent runs, local prototyping.

**Risks:** Any agent mistake mutates your files immediately.  `git stash` or
`git checkout` is your undo mechanism.

## `worktree` — Git Worktree Isolation

A detached [git worktree](https://git-scm.com/docs/git-worktree) is created in
a temporary directory.  The cluster operates against this worktree; your main
working tree is untouched.

### Lifecycle

```
createIsolationContext("worktree", sourceDir, clusterId)
  │
  ├─ Detect git root via gitRoot(sourceDir)
  ├─ mkdtemp()  →  /tmp/takumi-wt-<hash>
  ├─ git worktree add <tmpPath>
  │
  ▼
IsolationContext { mode: "worktree", workDir: "/tmp/takumi-wt-abc123" }
  │
  │  ... cluster runs here ...
  │
  ▼
cleanup()
  ├─ git worktree remove <tmpPath>
  └─ rm -rf <tmpPath>
```

### Fallback

If the current directory is not inside a git repo, the mode silently falls back
to `none` with a warning log.

### Merging Results

After successful validation the orchestrator (or the user via `/diff`) can
cherry-pick or merge the worktree branch into the main branch.

## `docker` — Container Isolation

A Docker container is started with the project bind-mounted at `/workspace`.
The cluster's `workDir` points to a host-side temp directory that is
volume-mapped into the container.

### Configuration

```jsonc
{
  "orchestration": {
    "isolationMode": "docker",
    "docker": {
      "image": "node:22-alpine",
      "mounts": ["gh", "git", "ssh"],
      "envPassthrough": ["AWS_*", "AZURE_*", "GITHUB_TOKEN"]
    }
  }
}
```

### Credential Mounts

Preset mount profiles forward host credentials into the container:

| Preset   | Host path            | Container path              |
|----------|----------------------|-----------------------------|
| `gh`     | `~/.config/gh`       | `$HOME/.config/gh`          |
| `git`    | `~/.gitconfig`       | `$HOME/.gitconfig`          |
| `ssh`    | `~/.ssh`             | `$HOME/.ssh`                |
| `aws`    | `~/.aws`             | `$HOME/.aws`                |
| `azure`  | `~/.azure`           | `$HOME/.azure`              |
| `gcloud` | `~/.config/gcloud`   | `$HOME/.config/gcloud`      |
| `kubectl`| `~/.kube`            | `$HOME/.kube`               |

All preset mounts are **read-only** by default.

### Environment Variable Passthrough

Glob patterns in `envPassthrough` control which host env vars are forwarded:

```
"envPassthrough": ["AWS_*", "AZURE_*", "GITHUB_TOKEN"]
→  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AZURE_SUBSCRIPTION_ID ...
```

### Fallback

If Docker is not installed or the config is missing, the mode falls back to
`none`.

### Cleanup

`IsolationContext.cleanup()` removes the host-side temp directory.  Container
lifecycle management (stop/remove) is handled by the caller or a future
enhancement.

## API

```typescript
import { createIsolationContext, type IsolationContext } from "./cluster/isolation.js";

const ctx: IsolationContext = await createIsolationContext(
  "worktree",        // mode
  process.cwd(),     // source directory
  "cluster-abc123",  // cluster ID
);

// ctx.mode    → "worktree"
// ctx.workDir → "/tmp/takumi-wt-abc123-xxxx"

try {
  // ... run cluster inside ctx.workDir ...
} finally {
  await ctx.cleanup();  // safe to call multiple times
}
```

## Choosing a Mode

| Scenario                          | Recommended mode |
|-----------------------------------|------------------|
| Quick fix, trusted task           | `none`           |
| Feature branch, multi-file change | `worktree`       |
| Untrusted code, security review   | `docker`         |
| CI/CD pipeline                    | `docker`         |
