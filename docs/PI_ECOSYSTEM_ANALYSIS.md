# Pi Ecosystem Analysis & Takumi Update Recommendations
**Date:** March 2, 2026  
**Analysis of:** pi-mono, pi-statusbar, pi-telemetry, pi-ssh, pi-nanny, and related tooling

---

## Executive Summary

The pi-mono ecosystem has evolved significantly with new patterns that Takumi should adopt:

1. **Daemon Socket Architecture** ✅ — Takumi already implements this correctly
2. **Telemetry Schema v2** ⚠️ — Needs alignment with pi-telemetry standard
3. **HTTP Bridge for Remote Access** ❌ — Missing, needed for remote/mobile clients
4. **Anti-MCP Philosophy** ✅ — Takumi's hybrid approach (socket primary, MCP fallback) aligns
5. **Snapshot Aggregation** ⚠️ — Needs enhancement for multi-process scenarios
6. **Extension System Patterns** 📝 — Informative but not directly applicable

---

## Key Findings from External Projects

### 1. pi-statusbar (jademind)
**Architecture:**
- Python daemon (`pi-statusd.py`) with Unix socket (`~/.pi-statusbar/statusd.sock`)
- macOS Swift app polls daemon every 2s
- HTTP bridge for iOS/remote clients with bearer token auth
- LaunchAgent management for startup

**Key Features:**
- Status commands: `status`, `ping`, `jump <pid>`, `latest <pid>`, `send <pid> <message>`, `watch`
- Terminal window focus/jump with accessibility APIs
- Context pressure indicators: healthy, close-to-limit, near-limit, at-limit
- Rich HTML rendering of assistant messages
- Telemetry discovery from `~/.pi/agent/telemetry/instances/*.json`

**Security:**
- Socket permissions: 0600 (user-only)
- HTTP bridge: bearer token auth, CIDR allowlist, rate limiting
- Sandboxed WKWebView for HTML rendering

**Relevance to Takumi:**
- Validates Takumi's daemon socket approach
- Shows need for HTTP bridge (Phase 14+)
- Demonstrates telemetry consumption patterns

---

### 2. pi-telemetry (jademind)
**Schema Version:** 2

**Per-Instance Fields:**
```typescript
{
  // Process info
  process: { pid, ppid, uptime, heartbeat }
  
  // System info
  system: { host, user, platform, arch, nodeVersion }
  
  // Workspace
  workspace: { cwd, git: { branch, commit } }
  
  // Session metadata
  session: { id, file, name }
  
  // Model info
  model: { provider, id, name, thinkingLevel }
  
  // Activity state
  state: { 
    activity: "working" | "waiting_input" | "unknown",
    idle: boolean 
  }
  
  // Context window pressure
  context: {
    tokens: number,
    contextWindow: number,
    remainingTokens: number,
    percent: number,
    pressure: "normal" | "approaching_limit" | "near_limit" | "at_limit",
    closeToLimit: boolean,  // >= 85%
    nearLimit: boolean      // >= 95%
  }
  
  // Routing metadata
  routing: {
    tty: string,
    mux: "tmux" | "zellij" | null,
    muxSession: string,
    terminalApp: "Ghostty" | "iTerm2" | "Terminal",
    tmuxPaneTarget: string,
    zellijTabCandidates: string[]
  }
  
  // Capabilities
  capabilities: { hasUI: boolean }
  
  // Extensions presence
  extensions: {
    telemetry: "@jademind/pi-telemetry",
    bridge: "@jademind/pi-bridge" | null
  }
  
  // Latest assistant message
  messages: {
    lastAssistantText: string,
    lastAssistantHtml: string,
    lastAssistantUpdatedAt: number
  }
  
  // Metadata
  lastEvent: string,
  telemetry: { alive: boolean, stale: boolean, ageMs: number, source: string }
}
```

**Snapshot Aggregation:**
```typescript
{
  schemaVersion: 2,
  aggregate: "none" | "working" | "waiting_input" | "mixed",
  counts: { total, working, waiting_input, unknown },
  context: { 
    total, normal, approachingLimit, nearLimit, atLimit,
    maxPercent, avgPercent 
  },
  sessions: Map<sessionId, sessionData>,
  instancesByPid: Map<pid, instance>,
  instances: Instance[]
}
```

**Key Features:**
- Per-process heartbeat files (atomic writes)
- Stale detection (default: 10s threshold)
- No daemon required
- CLI: `pi-telemetry-snapshot --pretty --stale-ms 10000`

**Environment Variables:**
- `PI_TELEMETRY_DIR`: default `~/.pi/agent/telemetry/instances`
- `PI_TELEMETRY_HEARTBEAT_MS`: default 1500, min 250
- `PI_TELEMETRY_CLOSE_PERCENT`: default 85
- `PI_TELEMETRY_NEAR_PERCENT`: default 95
- `PI_TELEMETRY_STALE_MS`: default 10000

**Relevance to Takumi:**
- **CRITICAL:** Chitragupta needs schema alignment
- Context pressure model should match
- Heartbeat/staleness patterns should align
- Snapshot aggregation useful for multi-agent scenarios

---

### 3. Mario Zechner's "What if you don't need MCP?"
**Key Arguments:**
- MCP servers too heavyweight (13-18k tokens for Playwright/Chrome DevTools)
- Simple bash tools more efficient (225 tokens for equivalent functionality)
- Models already know bash and code
- Composability via pipes/files vs context-only
- Easy to extend ad-hoc

**Browser Tools Example:**
```bash
./start.js [--profile]           # Start Chrome with debugging
./nav.js <url> [--new]           # Navigate
./eval.js 'code'                 # Execute JS in page context
./screenshot.js                  # Take screenshot
./pick.js "message"              # Interactive element picker
```

**Philosophy:**
- Leverage existing model knowledge (bash, DOM APIs)
- Token efficiency through progressive disclosure
- Code as tools, not just prompts
- Easy to build custom tools on-demand

**Relevance to Takumi:**
- **Validates hybrid approach:** Socket primary, MCP fallback
- Suggests tool design philosophy: simple, composable, bash-friendly
- Consideration for future tool registry expansion

---

### 4. pi-ssh (hjanuschka)
**Architecture:**
- SSH connection multiplexing (ControlMaster/ControlPersist)
- Persistent remote shell session
- Tool delegation: read, write, edit, bash
- Status indicator in UI

**Key Features:**
```bash
pi --ssh user@host
pi --ssh user@host:/remote/path
pi --ssh user@host -p 2222
```

**Integration:**
- Rewrites tool execution to use SSH
- Environment persists across commands
- Ctrl-C interrupts command but keeps session alive
- Maps local `$HOME` paths to remote `$HOME`

**Relevance to Takumi:**
- Not directly applicable (different architecture)
- Shows extension patterns for tool interception
- Demonstrates persistent session management

---

### 5. pi-nanny (hjanuschka)
**Architecture:**
- Pi extension with event interception
- Progressive enforcement system
- Persistent state across sessions

**Extension API Usage:**
- Event interception: `input`, `agent_start`, `session_start`
- UI: `ctx.ui.confirm()`, `ctx.ui.notify()`, `ctx.ui.setStatus()`
- Custom commands: `/nanny` with subcommands
- Keyboard shortcuts: `Ctrl+Shift+S`
- Shutdown: `ctx.shutdown()`

**Relevance to Takumi:**
- Shows mature extension patterns
- Not directly applicable (Takumi is framework, not extension host)
- Informative for understanding pi ecosystem

---

### 6. pi-mono Core (badlogic)
**Status:** OSS vacation until March 2, 2026 (reopening today!)
**Latest:** v0.55.3 (3 days ago)

**Packages:**
- `@mariozechner/pi-ai` — Unified multi-provider LLM API
- `@mariozechner/pi-agent-core` — Agent runtime
- `@mariozechner/pi-coding-agent` — Interactive coding agent CLI
- `@mariozechner/pi-tui` — Terminal UI library
- `@mariozechner/pi-web-ui` — Web components
- `@mariozechner/pi-pods` — vLLM pod management

**Relevance to Takumi:**
- Monitor for new patterns/features
- Maintain parity on core capabilities
- Track API changes that affect tooling

---

## Comparison: Takumi vs Pi Ecosystem

| Feature | Pi Ecosystem | Takumi | Status |
|---------|--------------|--------|--------|
| **Daemon Socket** | ✅ pi-statusbar | ✅ ChitraguptaBridge | ✅ ALIGNED |
| **Telemetry Schema** | ✅ v2 (comprehensive) | ⚠️ Custom schema | ⚠️ NEEDS UPDATE |
| **Context Pressure** | ✅ 4 levels + percentages | ❌ Not modeled | ❌ MISSING |
| **HTTP Bridge** | ✅ pi-statusbar | ❌ None | ❌ MISSING |
| **Snapshot Aggregation** | ✅ pi-telemetry CLI | ⚠️ Consolidation only | ⚠️ PARTIAL |
| **Multi-Agent Orchestration** | ❌ Single agent | ✅ Full cluster system | ✅ AHEAD |
| **Tool Philosophy** | ✅ Bash-first | ✅ MCP with fallback | ✅ ALIGNED |
| **Extension System** | ✅ Pi extensions | ❌ N/A | N/A |
| **arXiv Research** | ❌ Basic agent | ✅ 6 strategies + bandit | ✅ AHEAD |

---

## Recommended Updates for Chitragupta

### Priority 1: Schema Alignment (HIGH PRIORITY)

**Goal:** Align Chitragupta telemetry with pi-telemetry schema v2

**Changes to `packages/bridge/src/chitragupta-types.ts`:**

```typescript
// Add new interfaces
export interface TelemetryProcess {
  pid: number;
  ppid: number;
  uptime: number;
  heartbeatAt: number;
  startedAt: number;
}

export interface TelemetrySystem {
  host: string;
  user: string;
  platform: string;
  arch: string;
  nodeVersion: string;
}

export interface TelemetryWorkspace {
  cwd: string;
  git?: {
    branch: string;
    commit: string;
    dirty: boolean;
  };
}

export interface TelemetrySession {
  id: string;
  file: string;
  name: string;
}

export interface TelemetryModel {
  provider: string;
  id: string;
  name: string;
  thinkingLevel?: number;
}

export interface TelemetryState {
  activity: "working" | "waiting_input" | "idle" | "unknown";
  idle: boolean;
  idleSince?: number;
}

export interface TelemetryContext {
  tokens: number;
  contextWindow: number;
  remainingTokens: number;
  percent: number;
  pressure: "normal" | "approaching_limit" | "near_limit" | "at_limit";
  closeToLimit: boolean;  // >= TELEMETRY_CLOSE_PERCENT (default 85)
  nearLimit: boolean;     // >= TELEMETRY_NEAR_PERCENT (default 95)
}

export interface TelemetryRouting {
  tty: string;
  mux: "tmux" | "zellij" | null;
  muxSession: string;
  terminalApp?: "Ghostty" | "iTerm2" | "Terminal" | "Warp";
  tmuxPaneTarget?: string;
  zellijTabCandidates?: string[];
  zellijTabMatch?: string;
}

export interface TelemetryCapabilities {
  hasUI: boolean;
  hasTools: boolean;
  hasMemory: boolean;
}

export interface TelemetryExtensions {
  telemetry: string;  // "@mariozechner/takumi-telemetry" or similar
  bridge?: string | null;
}

export interface TelemetryMessages {
  lastAssistantText?: string;
  lastAssistantHtml?: string;
  lastAssistantUpdatedAt?: number;
}

export interface TelemetryMetadata {
  alive: boolean;
  stale: boolean;
  ageMs: number;
  source: string;  // file path
}

// Main per-instance telemetry
export interface AgentTelemetry {
  process: TelemetryProcess;
  system: TelemetrySystem;
  workspace: TelemetryWorkspace;
  session: TelemetrySession;
  model: TelemetryModel;
  state: TelemetryState;
  context: TelemetryContext;
  routing: TelemetryRouting;
  capabilities: TelemetryCapabilities;
  extensions: TelemetryExtensions;
  messages: TelemetryMessages;
  lastEvent: string;
  telemetry: TelemetryMetadata;
}

// Snapshot aggregation
export interface TelemetrySnapshot {
  schemaVersion: 2;
  timestamp: number;
  aggregate: "none" | "working" | "waiting_input" | "idle" | "mixed";
  counts: {
    total: number;
    working: number;
    waiting_input: number;
    idle: number;
    unknown: number;
  };
  context: {
    total: number;
    normal: number;
    approachingLimit: number;
    nearLimit: number;
    atLimit: number;
    maxPercent: number;
    avgPercent: number;
  };
  sessions: Record<string, SessionTelemetryGroup>;
  instancesByPid: Record<string, AgentTelemetry>;
  instances: AgentTelemetry[];
}

export interface SessionTelemetryGroup {
  sessionId: string;
  sessionName: string;
  aggregate: "none" | "working" | "waiting_input" | "idle" | "mixed";
  count: number;
  context: {
    normal: number;
    approachingLimit: number;
    nearLimit: number;
    atLimit: number;
  };
  instances: AgentTelemetry[];
}
```

**Changes to `packages/bridge/src/chitragupta-ops.ts`:**

Add new operations:
```typescript
export async function telemetryHeartbeat(...)
export async function telemetrySnapshot(...)
export async function telemetryList(...)
```

**Changes to `packages/bridge/src/chitragupta.ts`:**

Add new methods to `ChitraguptaBridge`:
```typescript
async telemetryHeartbeat(data: Partial<AgentTelemetry>): Promise<void>
async telemetrySnapshot(staleMs?: number): Promise<TelemetrySnapshot>
async telemetryList(): Promise<AgentTelemetry[]>
```

**New Configuration Constants:**

Add to `packages/core/src/constants.ts`:
```typescript
export const TELEMETRY_DIR = process.env.TAKUMI_TELEMETRY_DIR 
  || path.join(os.homedir(), '.takumi', 'telemetry', 'instances');
export const TELEMETRY_HEARTBEAT_MS = 
  Number(process.env.TAKUMI_TELEMETRY_HEARTBEAT_MS) || 1500;
export const TELEMETRY_CLOSE_PERCENT = 
  Number(process.env.TAKUMI_TELEMETRY_CLOSE_PERCENT) || 85;
export const TELEMETRY_NEAR_PERCENT = 
  Number(process.env.TAKUMI_TELEMETRY_NEAR_PERCENT) || 95;
export const TELEMETRY_STALE_MS = 
  Number(process.env.TAKUMI_TELEMETRY_STALE_MS) || 10000;
```

---

### Priority 2: Telemetry Heartbeat Integration

**Goal:** Emit telemetry on agent lifecycle events

**Changes to `packages/agent/src/loop.ts`:**

Add telemetry emission on key events:
```typescript
// At agent start
await bridge.telemetryHeartbeat({
  process: { pid: process.pid, ... },
  session: { id: sessionId, ... },
  model: { provider, id, name },
  state: { activity: "working", idle: false },
  context: calculateContextPressure(messages),
  lastEvent: "agent_start"
});

// At turn start
await bridge.telemetryHeartbeat({
  state: { activity: "working", idle: false },
  lastEvent: "turn_start"
});

// At turn end
await bridge.telemetryHeartbeat({
  state: { activity: "waiting_input", idle: true, idleSince: Date.now() },
  messages: {
    lastAssistantText: lastResponse.content,
    lastAssistantHtml: renderHtml(lastResponse.content),
    lastAssistantUpdatedAt: Date.now()
  },
  lastEvent: "turn_end"
});

// At shutdown
await bridge.telemetryCleanup(process.pid);
```

**New Helper in `packages/agent/src/loop.ts`:**

```typescript
function calculateContextPressure(messages: Message[]): TelemetryContext {
  const tokens = estimateTokens(messages);
  const contextWindow = getCurrentModel().contextWindow;
  const remainingTokens = contextWindow - tokens;
  const percent = (tokens / contextWindow) * 100;
  
  let pressure: TelemetryContext["pressure"] = "normal";
  if (percent >= 100) pressure = "at_limit";
  else if (percent >= TELEMETRY_NEAR_PERCENT) pressure = "near_limit";
  else if (percent >= TELEMETRY_CLOSE_PERCENT) pressure = "approaching_limit";
  
  return {
    tokens,
    contextWindow,
    remainingTokens,
    percent,
    pressure,
    closeToLimit: percent >= TELEMETRY_CLOSE_PERCENT,
    nearLimit: percent >= TELEMETRY_NEAR_PERCENT
  };
}
```

---

### Priority 3: Snapshot CLI Tool

**Goal:** Provide `takumi-telemetry-snapshot` CLI for external tools

**New File: `bin/telemetry-snapshot.ts`:**

```typescript
#!/usr/bin/env node
import { createChitraguptaBridge } from "@takumi/bridge";
import { TELEMETRY_STALE_MS } from "@takumi/core";

async function main() {
  const args = process.argv.slice(2);
  const staleMs = args.includes("--stale-ms")
    ? Number(args[args.indexOf("--stale-ms") + 1])
    : TELEMETRY_STALE_MS;
  const pretty = args.includes("--pretty");
  
  const bridge = createChitraguptaBridge();
  await bridge.connect();
  
  const snapshot = await bridge.telemetrySnapshot(staleMs);
  
  console.log(pretty ? JSON.stringify(snapshot, null, 2) : JSON.stringify(snapshot));
  
  await bridge.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
```

**Add to `package.json` (root):**

```json
{
  "bin": {
    "takumi": "./bin/cli/takumi.ts",
    "takumi-telemetry-snapshot": "./bin/telemetry-snapshot.ts"
  }
}
```

---

### Priority 4: HTTP Bridge (Phase 14+)

**Goal:** Allow remote/mobile clients to access Takumi telemetry

**New File: `packages/bridge/src/http-bridge.ts`:**

```typescript
import { fastify } from "fastify";
import type { TelemetrySnapshot } from "./chitragupta-types.js";

export interface HttpBridgeConfig {
  port: number;
  httpsPort?: number;
  token: string;
  allowCidrs?: string[];
  rateLimit?: { max: number; timeWindow: string };
}

export class HttpBridge {
  async start(config: HttpBridgeConfig): Promise<void> { ... }
  async stop(): Promise<void> { ... }
  
  // Endpoints:
  // GET /status
  // GET /watch?timeout_ms=30000&fingerprint=...
  // GET /latest/<pid>
  // POST /send { pid, message }
}
```

**Security:**
- Bearer token for non-loopback clients
- CIDR allowlist
- Rate limiting on `/send`
- No `/jump` endpoint (security risk)
- HTTPS optional with self-signed cert

---

### Priority 5: Context Pressure UI

**Goal:** Show context pressure in TUI status bar

**Changes to `packages/tui/src/status-bar.ts`:**

```typescript
const contextPressure = telemetry.context.pressure;
const contextIcon = {
  "normal": "✓",
  "approaching_limit": "⚠️",
  "near_limit": "🔶",
  "at_limit": "🔴"
}[contextPressure];

statusBar.addSegment({
  text: `${contextIcon} ${telemetry.context.percent.toFixed(0)}%`,
  color: getContextPressureColor(contextPressure)
});
```

---

## Recommended Updates for Other Areas

### 1. Darpana (Telemetry Mirror)

**Current State:** Exists in `packages/bridge/src/darpana.ts`

**Recommendation:** 
- Extend to support new telemetry schema
- Add correlation with Chitragupta memory traces
- Consider real-time dash interface (future)

---

### 2. Agent Loop Context Management

**Current State:** Basic token estimation in `loop.ts`

**Recommendation:**
- Implement proactive context window management
- Alert user when approaching limit
- Auto-trigger memory consolidation when needed
- Consider context truncation strategies (keep recent + pinned)

---

### 3. Multi-Agent Telemetry

**Current State:** Single-agent telemetry

**Recommendation:**
- Each agent subprocess emits own telemetry
- Cluster orchestrator aggregates child telemetries
- Parent agent shows aggregate pressure
- Consider cluster-level context budget distribution

---

### 4. Tool Registry Simplification

**Current State:** MCP-based tool registry

**Recommendation:**
- Consider hybrid approach inspired by Mario's blog
- Bash-first tools with MCP fallback
- Progressive disclosure of tool context
- Easy ad-hoc tool creation

---

## Implementation Priority Order

### Phase 13 (CURRENT):
1. ✅ Complete arXiv strategy integration
2. ✅ Bandit learning (Niyanta)
3. ✅ All tests passing

### Phase 14 (IMMEDIATE - Next 1-2 weeks):
1. **Telemetry Schema Alignment** (3-4 days)
   - Update `chitragupta-types.ts` with v2 schema
   - Add context pressure calculation
   - Add configuration constants
2. **Heartbeat Integration** (2-3 days)
   - Emit telemetry from agent loop
   - Handle lifecycle events
   - Cleanup on shutdown
3. **Snapshot CLI** (1 day)
   - Create `takumi-telemetry-snapshot` command
   - Test with external consumers

### Phase 15 (Next 2-3 weeks):
1. **HTTP Bridge** (5-7 days)
   - Fastify server with auth
   - Status/watch/send endpoints
   - Security hardening
2. **Context Pressure UI** (2-3 days)
   - Status bar indicators
   - Alerts for near-limit
   - Auto-consolidation triggers
3. **Multi-Agent Telemetry** (3-4 days)
   - Per-subprocess telemetry files
   - Cluster aggregation
   - Parent-child correlation

### Phase 16 (Longer term):
1. **Tool Registry Simplification**
2. **Darpana Real-Time Dash**
3. **Advanced Context Management**

---

## Testing Strategy

### Unit Tests:
- Context pressure calculation
- Telemetry serialization/deserialization
- Snapshot aggregation logic
- Staleness detection

### Integration Tests:
- Heartbeat emission from agent loop
- Multi-agent telemetry aggregation
- HTTP bridge auth/rate limiting
- CLI snapshot generation

### Manual Testing:
- External consumption (build simple status monitor)
- Context pressure alerts
- Shutdown cleanup
- Stale detection accuracy

---

## Migration Guide

### For Existing Takumi Users:

1. **No Breaking Changes** in Phase 14-15
2. **Opt-in Telemetry:** Set `TAKUMI_TELEMETRY_DIR` to enable
3. **Backward Compatibility:** Old Chitragupta APIs unchanged
4. **New Features:** Telemetry is additive, not required

### For External Tool Builders:

1. Use `takumi-telemetry-snapshot` CLI for consumption
2. Parse JSON output (schema v2)
3. Handle stale instances gracefully
4. Respect `telemetry.alive` and `telemetry.stale` flags

---

## Questions for Discussion

1. **Naming:** Use `@mariozechner/takumi-telemetry` or keep `@takumi/bridge`?
2. **Schema Extensions:** Any Takumi-specific fields beyond pi-telemetry schema?
3. **HTTP Bridge Priority:** Wait until user request or build proactively?
4. **Tool Philosophy:** Full adoption of bash-first approach or keep MCP primary?
5. **Darpana Evolution:** Real-time dash vs file-based mirror?

---

## Additional Pi Ecosystem Projects

### 7. pi-side-agents (pasky) — v1.0.0

**Architecture:**
- Parallel asynchronous agents via tmux + git worktrees
- Each child agent: dedicated tmux window + isolated worktree + branch
- Parent-child communication via registry.json + tmux control
- Deterministic lifecycle: spawn → work → yield for review → finish (rebase + merge)

**Key Concepts:**
- **Work in sprints, not marathons** — spawn tasks as they occur
- **Single-use agents** — each agent lives/dies with its branch
- **NO long-running agent teams** — avoid complex inter-agent messaging
- **Blind validators** inspired but different execution model

**Worktree Pool Management:**
```
../myproject-agent-worktree-0001/   # Pool slot #1
../myproject-agent-worktree-0002/   # Pool slot #2
...
```

Each has `.pi/active.lock`:
```json
{
  "agentId": "a-0007",
  "sessionId": "...",
  "pid": 12345,
  "tmuxWindowId": "@19",
  "branch": "side-agent/a-0007",
  "startedAt": "2026-02-27T04:58:00Z"
}
```

**Child Lifecycle:**
1. `/agent <task>` from parent
2. Allocate worktree + create branch
3. Spawn tmux window with child Pi
4. Child works independently
5. Child yields for review (`waiting_user` status)
6. Parent reviews + steers via `agent-send`
7. Explicit finish command triggers rebase + merge
8. Successful merge → auto-prune from registry

**Orchestration API:**
- `agent-start(model?, description)` → `{ id, tmuxWindowId, ... }`
- `agent-check(id)` → status + backlog tail
- `agent-wait-any(ids[], states?)` → blocks until one reaches state
- `agent-send(id, prompt)` → send message/interrupt to child

**State Model:**
```
allocating_worktree → spawning_tmux → starting → running 
  → waiting_user → finishing → waiting_merge_lock 
  → retrying_reconcile → [done | failed | crashed]
```

**Finish Flow (Default):**
1. Child: `git rebase main`
2. If conflicts → user resolves → retry
3. If clean → acquire parent merge lock
4. Parent: `git merge --ff-only side-agent/<id>`
5. If parent main moved → release lock → goto 1
6. Success → cleanup → exit code 0 → auto-prune

**Statusline:**
Shows compact agent summaries in parent:
```
agent-1:run@4 agent-2:wait@7 agent-3:finish@9
```

**Relevance to Takumi:**
- **CRITICAL:** Different philosophy from Takumi's blind validators
- Takumi: validators in parallel threads, single worktree
- pi-side-agents: work agents in parallel worktrees, tmux-based
- **Potential hybrid:** Takumi validators COULD spawn as side agents for true isolation

---

### 8. pi-design-deck (nicobailon) — v0.3.0

**Architecture:**
- Browser-based visual decision tool
- Persistent HTTP server + SSE for live updates
- Multi-slide decks with visual previews

**Use Case:**
- Agent shows 2-4 high-fidelity options per decision point
- User picks visually, agent gets clean selection map
- "Interview gathers input → Design deck presents options"

**Preview Block Types:**
1. **Code** — syntax-highlighted (Prism.js)
2. **Mermaid** — diagrams (Mermaid.js)
3. **HTML** — raw HTML snippets
4. **Image** — served from disk (absolute paths)

**Generate-More Loop:**
- User clicks "Generate N options"
- Tool resolves with prompt for agent
- Agent generates → pushes via SSE → deck stays open
- Model selector dropdown for multi-model generation
- Thinking level adjustment per generation

**Deck Schema:**
```typescript
{
  title: string,
  slides: [
    {
      id: string,
      title: string,
      context: string,
      columns: 1 | 2 | 3,
      options: [
        {
          label: string,
          description: string,
          aside: string,  // Line-break with \n
          previewBlocks: [...] | previewHtml: string,
          recommended?: boolean
        }
      ]
    }
  ]
}
```

**Persistence:**
- Auto-save on submit/cancel
- Cmd+S for manual save
- Load from file path or deck ID
- Standalone HTML export for sharing

**Bundled Skill:**
- Component gallery reference (60 UI components)
- Vocabulary lookup (ambiguous terms → canonical components)
- Design system knowledge (Blueprint, Ant, Material-UI, etc.)

**Relevance to Takumi:**
- **UX paradigm:** Visual decision-making vs text-only
- Could integrate with Takumi TUI for decisions
- Complements interview tool (gather → present → pick)
- Not directly applicable but shows alternative UX approach

---

## Comprehensive Implementation Plan for Takumi

### Phase 14: Telemetry & Observability (IMMEDIATE — 1-2 weeks)

**Status:** Ready to start (Phase 13 complete ✅)

#### 14.1 Telemetry Schema Alignment (3-4 days) ⚡ HIGHEST PRIORITY

**Goal:** Full compatibility with pi-telemetry v2 for external tool consumption

**Tasks:**
1. Update `packages/bridge/src/chitragupta-types.ts`:
   - Add all pi-telemetry v2 interfaces (see schema in Priority 1 section above)
   - `AgentTelemetry`, `TelemetrySnapshot`, `SessionTelemetryGroup`
   - Context pressure model with 4 levels
   
2. Add configuration constants to `packages/core/src/constants.ts`:
   ```typescript
   export const TELEMETRY_DIR = process.env.TAKUMI_TELEMETRY_DIR 
     || path.join(os.homedir(), '.takumi', 'telemetry', 'instances');
   export const TELEMETRY_HEARTBEAT_MS = 1500;
   export const TELEMETRY_CLOSE_PERCENT = 85;
   export const TELEMETRY_NEAR_PERCENT = 95;
   export const TELEMETRY_STALE_MS = 10000;
   ```

3. Implement helpers in `packages/agent/src/loop.ts`:
   - `calculateContextPressure(messages)` → TelemetryContext
   - `estimateTokens(messages)` with model-aware calculation
   - `renderLastAssistantHtml(content)` for safe HTML rendering

4. **Tests:**
   - Context pressure calculation (normal → approaching → near → at-limit)
   - Telemetry serialization round-trip
   - Staleness detection logic

**Success Criteria:**
- All interfaces defined with full type safety
- Build passes with no type errors
- Unit tests for pressure calculation

---

#### 14.2 Heartbeat Emission (2-3 days)

**Goal:** Real-time telemetry from agent lifecycle events

**Integration Points in `packages/agent/src/loop.ts`:**

```typescript
// At agent start
await bridge.telemetryHeartbeat({
  process: { 
    pid: process.pid, 
    ppid: process.ppid,
    uptime: process.uptime(),
    heartbeatAt: Date.now(),
    startedAt: startTime
  },
  system: {
    host: os.hostname(),
    user: os.userInfo().username,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version
  },
  workspace: {
    cwd: process.cwd(),
    git: await getGitInfo()  // from bridge
  },
  session: {
    id: sessionId,
    file: sessionFile,
    name: sessionName
  },
  model: {
    provider: ctx.model.provider,
    id: ctx.model.id,
    name: ctx.model.name,
    thinkingLevel: ctx.thinkingLevel
  },
  state: {
    activity: "working",
    idle: false
  },
  context: calculateContextPressure(messages),
  routing: {
    tty: process.env.TTY || "",
    mux: detectMux(),  // "tmux" | "zellij" | null
    muxSession: getMuxSession(),
    terminalApp: detectTerminal()
  },
  capabilities: {
    hasUI: !!ctx.ui,
    hasTools: true,
    hasMemory: true
  },
  extensions: {
    telemetry: "@takumi/bridge",
    bridge: null  // For compat with pi ecosystem
  },
  lastEvent: "agent_start"
});

// At turn start
await bridge.telemetryHeartbeat({
  state: { activity: "working", idle: false },
  context: calculateContextPressure(messages),
  lastEvent: "turn_start"
});

// At turn end
await bridge.telemetryHeartbeat({
  state: { 
    activity: "waiting_input", 
    idle: true, 
    idleSince: Date.now() 
  },
  messages: {
    lastAssistantText: extractText(lastResponse),
    lastAssistantHtml: renderHtml(lastResponse),
    lastAssistantUpdatedAt: Date.now()
  },
  context: calculateContextPressure(messages),
  lastEvent: "turn_end"
});

// At shutdown
await bridge.telemetryCleanup(process.pid);
```

**File Management:**
- Write to `~/.takumi/telemetry/instances/<pid>.json`
- Atomic writes via temp file + rename
- Cleanup on graceful shutdown
- Orphan detection for crashed instances

**Tests:**
- Heartbeat file creation
- Content validation
- Cleanup on exit
- Stale file detection

---

#### 14.3 Snapshot CLI Tool (1 day)

**Goal:** External tools can query all active Takumi agents

**New File:** `bin/telemetry-snapshot.ts`

```typescript
#!/usr/bin/env node
import { createChitraguptaBridge } from "@takumi/bridge";

async function main() {
  const args = process.argv.slice(2);
  const staleMs = args.includes("--stale-ms")
    ? Number(args[args.indexOf("--stale-ms") + 1])
    : 10000;
  const pretty = args.includes("--pretty");
  
  const bridge = createChitraguptaBridge();
  await bridge.connect();
  
  const snapshot = await bridge.telemetrySnapshot(staleMs);
  
  console.log(pretty ? JSON.stringify(snapshot, null, 2) : JSON.stringify(snapshot));
  
  await bridge.disconnect();
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
```

**Usage:**
```bash
takumi-telemetry-snapshot                    # Default format
takumi-telemetry-snapshot --pretty           # Pretty JSON
takumi-telemetry-snapshot --stale-ms 5000    # Custom stale threshold
```

**Output Schema:** (pi-telemetry v2 compatible)
```json
{
  "schemaVersion": 2,
  "timestamp": 1709366400000,
  "aggregate": "working",
  "counts": { "total": 1, "working": 1, "waiting_input": 0 },
  "context": { "total": 1, "normal": 1, "approachingLimit": 0 },
  "sessions": { ... },
  "instancesByPid": { ... },
  "instances": [ ... ]
}
```

---

#### 14.4 Context Pressure UI (2 days)

**Goal:** Visual feedback for approaching context limits

**Status Bar Integration** (`packages/tui/src/status-bar.ts`):

```typescript
const pressure = telemetry.context.pressure;
const icon = {
  "normal": "✓",
  "approaching_limit": "⚠️",
  "near_limit": "🔶",
  "at_limit": "🔴"
}[pressure];

const color = {
  "normal": theme.success,
  "approaching_limit": theme.warning,
  "near_limit": theme.warning,
  "at_limit": theme.error
}[pressure];

statusBar.addSegment({
  text: `${icon} Context: ${percent.toFixed(0)}%`,
  color,
  onClick: () => showContextDetails()
});
```

**Proactive Actions:**
- **>= 85%** → Yellow warning banner
- **>= 95%** → Orange urgent banner + suggest consolidation
- **>= 100%** → Red error + force consolidation or limit output

**Auto-Consolidation Trigger:**
```typescript
if (context.nearLimit && !consolidationInProgress) {
  await triggerMemoryConsolidation(sessionId);
}
```

---

### Phase 15: Side Agent Integration (2-3 weeks)

**Status:** Planned after Phase 14

#### 15.1 Architecture Decision: Takumi vs pi-side-agents

**Two Distinct Orchestration Models:**

| Aspect | Takumi (Current) | pi-side-agents | Hybrid Option |
|--------|------------------|----------------|---------------|
| **Agent Isolation** | Threads/subprocesses | tmux + worktrees | Both |
| **Validation Model** | Parallel blind validators | N/A | Validators as side agents |
| **Worktree Usage** | Optional (isolation mode) | Required always | Per use case |
| **Communication** | Message passing | Tmux send/registry | Both |
| **Lifecycle** | Managed by orchestrator | User+agent steered | Orchestrator-managed side agents |
| **Merge Strategy** | Orchestrator decides | Child-initiated rebase | Configurable |
| **Use Case** | Complex reasoning tasks | Parallel feature work | Both |

**Recommendation:** **Hybrid Approach**

1. **Keep Takumi's core orchestration** for reasoning-heavy tasks:
   - Ensemble, MoA, Reflexion, etc. (Phase 8 ✅)
   - Blind validators in parallel threads
   - Advanced strategies (bandit learning, ToT)

2. **Add pi-side-agents pattern** for work parallelization:
   - `/takumi-agent <task>` command
   - Spawn side agents for independent features
   - Tmux + worktree isolation
   - User can switch windows to steer

3. **Use side agents for validator isolation** (optional mode):
   - `orchestration.validatorIsolation: "thread" | "worktree"`
   - Thread: current behavior (fast, shared context)
   - Worktree: true isolation (slower, prevents contamination)

---

#### 15.2 Side Agent Implementation (7-10 days)

**New Package:** `packages/side-agent/`

**Core Components:**

1. **WorktreePoolManager** (`worktree-pool.ts`)
   - Allocate/reuse worktree slots
   - Lock file management (`.takumi/active.lock`)
   - Orphan detection and cleanup

2. **TmuxOrchestrator** (`tmux-orchestrator.ts`)
   - Create/manage tmux windows
   - Send commands to child Pi instances
   - Capture output via pipe-pane

3. **SideAgentRegistry** (`registry.ts`)
   - File-backed state (`.takumi/side-agents/registry.json`)
   - Agent record lifecycle
   - Status polling and updates

4. **SideAgentCommands** (`commands.ts`)
   - `/takumi-agent [-model ...] <task>`
   - `/takumi-agents` (list/manage)
   - Tool API: `takumi_agent_start`, `takumi_agent_check`, `takumi_agent_wait_any`, `takumi_agent_send`

5. **StatusLine Integration** (`statusline.ts`)
   - Show active side agents with tmux window refs
   - Click to jump to window
   - Status transitions via notifications

**Lifecycle Scripts:**

```bash
# .takumi/side-agent-start.sh
# - Validate worktree + branch
# - Sync .takumi assets from parent
# - Run optional bootstrap hook

# .takumi/side-agent-finish.sh
# - git rebase main (with retry loop)
# - Acquire parent merge lock
# - git merge --ff-only (with retry if main moved)
# - Release lock + cleanup
``

**Tests:**
- Worktree allocation/reuse
- Tmux window lifecycle
- Registry updates and cleanup
- Merge conflict handling
- Lock contention scenarios

---

#### 15.3 Validator Isolation Mode (3-4 days)

**Goal:** Optional worktree isolation for validators

**Config Update** (`packages/core/src/types.ts`):

```typescript
export interface OrchestrationConfig {
  // ... existing fields ...
  
  validatorIsolation: "thread" | "worktree";
  
  worktreeValidation?: {
    enabled: boolean;
    reuseSlots: boolean;
    cleanupOnSuccess: boolean;
  };
}
```

**Implementation:**

When `validatorIsolation === "worktree"`:
1. Allocate worktree per validator
2. Spawn validator as side agent
3. Validator works in isolation
4. Collect results via registry
5. Cleanup worktrees on completion

**Trade-offs:**
- **Pros:** True isolation, prevents context bleed
- **Cons:** Slower (worktree overhead), more disk usage
- **Use when:** High-stakes validation, security audits

---

### Phase 16: HTTP Bridge & Remote Access (1-2 weeks)

**Status:** Future enhancement

#### 16.1 HTTP Bridge Server (5-7 days)

**New File:** `packages/bridge/src/http-bridge.ts`

```typescript
import fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";

export interface HttpBridgeConfig {
  port: number;
  httpsPort?: number;
  token: string;
  allowCidrs?: string[];
  rateLimit: { max: number; timeWindow: string };
}

export class HttpBridge {
  private server: FastifyInstance;
  private chitragupta: ChitraguptaBridge;
  
  async start(config: HttpBridgeConfig): Promise<void> {
    // Setup routes:
    // GET /status
    // GET /watch?timeout_ms=30000&fingerprint=abc123
    // GET /latest/<pid>
    // POST /send { pid, message }
    
    // NO /jump endpoint (security risk)
  }
  
  async stop(): Promise<void> { ... }
}
```

**Security:**
- Bearer token for non-loopback requests
- CIDR allowlist (default: 127.0.0.1/8)
- Rate limiting on write endpoints
- HTTPS optional (self-signed cert)
- No jump/focus endpoints

**Endpoints:**

1. **GET /status**
   - Returns telemetry snapshot
   - No auth for localhost

2. **GET /watch?timeout_ms=30000&fingerprint=...**
   - Long-poll for status changes
   - Returns when fingerprint changes or timeout
   - SSE alternative for streaming

3. **GET /latest/<pid>**
   - Get latest assistant message for PID
   - HTML + text formats

4. **POST /send**
   ```json
   { "pid": 12345, "message": "continue with tests" }
   ```
   - Send message to agent
   - Rate limited (5 req/min per IP)

---

#### 16.2 Mobile/Web Client Support (informational)

**pi-statusbar** already works with HTTP bridge. Takumi's bridge would enable:
- iOS/Android status monitoring
- Web dashboard
- Remote steering (with auth)

**Future:** Takumi-specific mobile app using HTTP bridge API

---

### Phase 17: Advanced Features (Future)

#### 17.1 Design Deck Integration

**Goal:** Visual decision-making in Takumi TUI

**Approach:**
- Port key concepts from pi-design-deck
- Terminal-based rendering (no browser dependency)
- Image preview via iTerm2/Kitty image protocols
- Mermaid → ASCII art diagrams

**Use Cases:**
- Architecture decisions (show diagrams)
- Algorithm choices (show complexity analysis)
- API design (show code samples side-by-side)

---

#### 17.2 Tool Philosophy Evolution

**Current:** MCP-based tools with bash fallback

**Future:** Bash-first with MCP codegen

Inspired by Mario Zechner's blog:
1. Simple tools are bash scripts in `~/.takumi/tools/`
2. Model knows bash, leverages existing knowledge
3. Token-efficient (200 vs 13,000 tokens)
4. Easy to extend on-demand
5. MCP for complex integrations only

**Example:**
```bash
# ~/.takumi/tools/browser-tools/start.js
./start.js [--profile]

# ~/.takumi/tools/browser-tools/eval.js
./eval.js 'document.title'
```

Agent reads README once, uses tools many times.

---

## Conclusion

Takumi is **architecturally ahead** with:
- ✅ Multi-agent orchestration (pi lacks this)
- ✅ arXiv research strategies (6 integrated)
- ✅ Bandit learning (Niyanta)
- ✅ Blind validation pattern
- ✅ Context pressure awareness (once telemetry added)

**Immediate priorities:**
1. **Phase 14** — Telemetry alignment (1-2 weeks)
2. **Phase 15** — Side agent integration (2-3 weeks)
3. **Phase 16** — HTTP bridge (1-2 weeks)

**Architecture decisions:**
- **Hybrid orchestration** — Keep Takumi's strengths, add side-agent parallelism
- **Validator isolation** — Optional worktree mode for high-stakes tasks
- **Telemetry first** — Enables all downstream features

The recommended updates preserve Takumi's unique strengths while ensuring ecosystem compatibility. Takumi becomes a **superset** of pi capabilities with advanced reasoning and orchestration on top.
