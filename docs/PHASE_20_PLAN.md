# Phase 14: Telemetry & Observability — Implementation Plan

**Timeline:** 1-2 weeks  
**Status:** Phase 13 complete ✅ — ready to begin  
**Goal:** Full pi-telemetry v2 compatibility + real-time observability

---

## Overview

Phase 14 focuses on aligning Takumi's telemetry with the pi ecosystem standard, enabling external tools (pi-statusbar, custom dashboards) to monitor and interact with Takumi agents.

**Why this matters:**
- Ecosystem interoperability (pi-statusbar can consume Takumi telemetry)
- Remote monitoring (mobile/web clients)
- Context pressure awareness (proactive consolidation)
- Foundation for Phase 15 (side agents) and Phase 16 (HTTP bridge)

---

## Milestone Breakdown

### 14.1 Schema Alignment (3-4 days) ⚡ **START HERE**

**Files to modify:**
1. `packages/bridge/src/chitragupta-types.ts` — Add pi-telemetry v2 interfaces
2. `packages/core/src/constants.ts` — Add telemetry configuration constants
3. `packages/agent/src/loop.ts` — Add helper functions

**New Interfaces:**

```typescript
// packages/bridge/src/chitragupta-types.ts

export interface TelemetryProcess {
  pid: number;
  ppid: number | null;
  uptime: number;  // seconds since process start
  heartbeatAt: number;  // Unix timestamp ms
  startedAt: number;
}

export interface TelemetrySystem {
  host: string;
  user: string;
  platform: NodeJS.Platform;
  arch: string;
  nodeVersion: string;
}

export interface TelemetryWorkspace {
  cwd: string;
  git: {
    branch?: string;
    commit?: string;
    dirty?: boolean;
    remote?: string;
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
  activity: "working" | "waiting_input" | "idle" | "error";
  idle: boolean;
  idleSince?: number;
}

export interface TelemetryContext {
  tokens: number;
  contextWindow: number;
  remainingTokens: number;
  percent: number;
  pressure: "normal" | "approaching_limit" | "near_limit" | "at_limit";
  closeToLimit: boolean;  // >= 85%
  nearLimit: boolean;     // >= 95%
}

export interface TelemetryRouting {
  tty: string;
  mux: "tmux" | "zellij" | null;
  muxSession: string | null;
  muxWindowId: string | null;
  terminalApp: string | null;
}

export interface TelemetryCapabilities {
  hasUI: boolean;
  hasTools: boolean;
  hasMemory: boolean;
}

export interface TelemetryExtensions {
  telemetry: string | null;
  bridge: string | null;
}

export interface TelemetryMessages {
  lastAssistantText?: string;
  lastAssistantHtml?: string;
  lastAssistantUpdatedAt?: number;
}

export interface AgentTelemetry {
  schemaVersion: 2;
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
  messages?: TelemetryMessages;
  lastEvent: string;
}

export interface TelemetrySnapshot {
  schemaVersion: 2;
  timestamp: number;
  aggregate: "working" | "waiting_input" | "idle" | "mixed";
  counts: {
    total: number;
    working: number;
    waiting_input: number;
    idle: number;
    error: number;
  };
  context: {
    total: number;
    normal: number;
    approachingLimit: number;
    nearLimit: number;
    atLimit: number;
  };
  sessions: Record<string, {
    sessionId: string;
    instances: number;
    statuses: string[];
  }>;
  instancesByPid: Record<number, AgentTelemetry>;
  instances: AgentTelemetry[];
}
```

**New Constants:**

```typescript
// packages/core/src/constants.ts

import path from "node:path";
import os from "node:os";

export const TELEMETRY_DIR = process.env.TAKUMI_TELEMETRY_DIR 
  || path.join(os.homedir(), ".takumi", "telemetry", "instances");

export const TELEMETRY_HEARTBEAT_MS = 1500;
export const TELEMETRY_CLOSE_PERCENT = 85;
export const TELEMETRY_NEAR_PERCENT = 95;
export const TELEMETRY_STALE_MS = 10000;
```

**Helper Functions:**

```typescript
// packages/agent/src/loop.ts

import { TelemetryContext } from "@takumi/bridge";
import { TELEMETRY_CLOSE_PERCENT, TELEMETRY_NEAR_PERCENT } from "@takumi/core";

export function calculateContextPressure(
  messages: Message[],
  contextWindow: number
): TelemetryContext {
  const tokens = estimateTokens(messages);
  const remainingTokens = Math.max(0, contextWindow - tokens);
  const percent = (tokens / contextWindow) * 100;
  
  let pressure: TelemetryContext["pressure"];
  if (percent >= 100) pressure = "at_limit";
  else if (percent >= TELEMETRY_NEAR_PERCENT) pressure = "near_limit";
  else if (percent >= TELEMETRY_CLOSE_PERCENT) pressure = "approaching_limit";
  else pressure = "normal";
  
  return {
    tokens,
    contextWindow,
    remainingTokens,
    percent,
    pressure,
    closeToLimit: percent >= TELEMETRY_CLOSE_PERCENT,
    nearLimit: percent >= TELEMETRY_NEAR_PERCENT,
  };
}

export function estimateTokens(messages: Message[]): number {
  // Rough estimate: 4 chars per token
  const totalChars = messages.reduce((sum, msg) => {
    if (typeof msg.content === "string") return sum + msg.content.length;
    if (Array.isArray(msg.content)) {
      return sum + msg.content.reduce((innerSum, part) => {
        if (part.type === "text") return innerSum + part.text.length;
        return innerSum;
      }, 0);
    }
    return sum;
  }, 0);
  
  return Math.ceil(totalChars / 4);
}

export function renderLastAssistantHtml(content: string): string {
  // Basic markdown → HTML conversion
  // TODO: Use a proper markdown library
  return content
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}
```

**Tests:**

```typescript
// packages/agent/test/telemetry.test.ts

import { describe, it, expect } from "vitest";
import { calculateContextPressure, estimateTokens } from "../src/loop.js";

describe("Telemetry", () => {
  describe("calculateContextPressure", () => {
    it("should calculate normal pressure", () => {
      const messages = [{ role: "user", content: "Hello" }];
      const result = calculateContextPressure(messages, 10000);
      
      expect(result.pressure).toBe("normal");
      expect(result.closeToLimit).toBe(false);
      expect(result.nearLimit).toBe(false);
      expect(result.percent).toBeLessThan(85);
    });
    
    it("should calculate approaching_limit pressure", () => {
      const content = "x".repeat(34000);  // ~8500 tokens
      const messages = [{ role: "user", content }];
      const result = calculateContextPressure(messages, 10000);
      
      expect(result.pressure).toBe("approaching_limit");
      expect(result.closeToLimit).toBe(true);
      expect(result.nearLimit).toBe(false);
      expect(result.percent).toBeGreaterThanOrEqual(85);
      expect(result.percent).toBeLessThan(95);
    });
    
    it("should calculate near_limit pressure", () => {
      const content = "x".repeat(38000);  // ~9500 tokens
      const messages = [{ role: "user", content }];
      const result = calculateContextPressure(messages, 10000);
      
      expect(result.pressure).toBe("near_limit");
      expect(result.closeToLimit).toBe(true);
      expect(result.nearLimit).toBe(true);
      expect(result.percent).toBeGreaterThanOrEqual(95);
      expect(result.percent).toBeLessThan(100);
    });
    
    it("should calculate at_limit pressure", () => {
      const content = "x".repeat(40000);  // ~10000 tokens
      const messages = [{ role: "user", content }];
      const result = calculateContextPressure(messages, 10000);
      
      expect(result.pressure).toBe("at_limit");
      expect(result.nearLimit).toBe(true);
      expect(result.percent).toBeGreaterThanOrEqual(100);
    });
  });
  
  describe("estimateTokens", () => {
    it("should estimate tokens for simple message", () => {
      const messages = [{ role: "user", content: "Hello world!" }];
      const tokens = estimateTokens(messages);
      
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });
    
    it("should handle array content", () => {
      const messages = [
        {
          role: "user",
          content: [
            { type: "text", text: "Hello" },
            { type: "text", text: "world" },
          ],
        },
      ];
      const tokens = estimateTokens(messages);
      
      expect(tokens).toBeGreaterThan(0);
    });
  });
});
```

**Success Criteria:**
- ✅ All interfaces compile without errors
- ✅ Tests pass for pressure calculation
- ✅ Constants accessible across packages

---

### 14.2 Heartbeat Emission (2-3 days)

**Goal:** Real-time telemetry from agent lifecycle events

**Files to modify:**
1. `packages/bridge/src/chitragupta.ts` — Add `telemetryHeartbeat()` method
2. `packages/agent/src/loop.ts` — Emit heartbeats at key lifecycle events

**ChitraguptaBridge Extension:**

```typescript
// packages/bridge/src/chitragupta.ts

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { TELEMETRY_DIR } from "@takumi/core";
import type { AgentTelemetry } from "./chitragupta-types.js";

export class ChitraguptaBridge {
  // ... existing methods ...
  
  private telemetryCache: Partial<AgentTelemetry> = {};
  
  async telemetryHeartbeat(data: Partial<AgentTelemetry>): Promise<void> {
    // Merge with cached data
    this.telemetryCache = {
      ...this.telemetryCache,
      ...data,
      schemaVersion: 2,
    };
    
    const telemetryFile = path.join(TELEMETRY_DIR, `${process.pid}.json`);
    
    // Ensure directory exists
    await fs.mkdir(TELEMETRY_DIR, { recursive: true });
    
    // Atomic write
    const tempFile = `${telemetryFile}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(this.telemetryCache, null, 2));
    await fs.rename(tempFile, telemetryFile);
  }
  
  async telemetryCleanup(pid: number): Promise<void> {
    const telemetryFile = path.join(TELEMETRY_DIR, `${pid}.json`);
    
    try {
      await fs.unlink(telemetryFile);
    } catch (err) {
      // Ignore if file doesn't exist
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }
  
  async telemetrySnapshot(staleMs = 10000): Promise<TelemetrySnapshot> {
    const now = Date.now();
    const files = await fs.readdir(TELEMETRY_DIR);
    const instances: AgentTelemetry[] = [];
    
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      
      try {
        const content = await fs.readFile(path.join(TELEMETRY_DIR, file), "utf-8");
        const data = JSON.parse(content) as AgentTelemetry;
        
        // Skip stale instances
        if (now - data.process.heartbeatAt > staleMs) continue;
        
        instances.push(data);
      } catch (err) {
        // Skip corrupted files
        continue;
      }
    }
    
    // Aggregate stats
    const counts = {
      total: instances.length,
      working: instances.filter(i => i.state.activity === "working").length,
      waiting_input: instances.filter(i => i.state.activity === "waiting_input").length,
      idle: instances.filter(i => i.state.activity === "idle").length,
      error: instances.filter(i => i.state.activity === "error").length,
    };
    
    const context = {
      total: instances.length,
      normal: instances.filter(i => i.context.pressure === "normal").length,
      approachingLimit: instances.filter(i => i.context.pressure === "approaching_limit").length,
      nearLimit: instances.filter(i => i.context.pressure === "near_limit").length,
      atLimit: instances.filter(i => i.context.pressure === "at_limit").length,
    };
    
    const sessions: Record<string, any> = {};
    instances.forEach(inst => {
      if (!sessions[inst.session.id]) {
        sessions[inst.session.id] = {
          sessionId: inst.session.id,
          instances: 0,
          statuses: [],
        };
      }
      sessions[inst.session.id].instances++;
      sessions[inst.session.id].statuses.push(inst.state.activity);
    });
    
    const aggregate = 
      counts.working > 0 && counts.waiting_input > 0 ? "mixed" :
      counts.working > 0 ? "working" :
      counts.waiting_input > 0 ? "waiting_input" :
      "idle";
    
    return {
      schemaVersion: 2,
      timestamp: now,
      aggregate,
      counts,
      context,
      sessions,
      instancesByPid: Object.fromEntries(instances.map(i => [i.process.pid, i])),
      instances,
    };
  }
}
```

**Agent Loop Integration:**

```typescript
// packages/agent/src/loop.ts

async function runAgentLoop(ctx: AgentContext): Promise<void> {
  const bridge = ctx.bridge;
  const startTime = Date.now();
  
  // Initial heartbeat at agent start
  await bridge.telemetryHeartbeat({
    process: {
      pid: process.pid,
      ppid: process.ppid ?? null,
      uptime: process.uptime(),
      heartbeatAt: Date.now(),
      startedAt: startTime,
    },
    system: {
      host: os.hostname(),
      user: os.userInfo().username,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
    },
    workspace: {
      cwd: process.cwd(),
      git: await getGitInfo(),
    },
    session: {
      id: ctx.sessionId,
      file: ctx.sessionFile,
      name: ctx.sessionName,
    },
    model: {
      provider: ctx.model.provider,
      id: ctx.model.id,
      name: ctx.model.name,
      thinkingLevel: ctx.thinkingLevel,
    },
    state: {
      activity: "working",
      idle: false,
    },
    context: calculateContextPressure(ctx.messages, ctx.model.contextWindow),
    routing: {
      tty: process.env.TTY || "",
      mux: detectMux(),
      muxSession: getMuxSession(),
      muxWindowId: getMuxWindowId(),
      terminalApp: detectTerminal(),
    },
    capabilities: {
      hasUI: !!ctx.ui,
      hasTools: true,
      hasMemory: true,
    },
    extensions: {
      telemetry: "@takumi/bridge",
      bridge: null,
    },
    lastEvent: "agent_start",
  });
  
  // Heartbeat interval (every 1.5s)
  const heartbeatInterval = setInterval(async () => {
    await bridge.telemetryHeartbeat({
      process: {
        pid: process.pid,
        ppid: process.ppid ?? null,
        uptime: process.uptime(),
        heartbeatAt: Date.now(),
        startedAt: startTime,
      },
      context: calculateContextPressure(ctx.messages, ctx.model.contextWindow),
    });
  }, TELEMETRY_HEARTBEAT_MS);
  
  try {
    while (true) {
      // Turn start
      await bridge.telemetryHeartbeat({
        state: { activity: "working", idle: false },
        context: calculateContextPressure(ctx.messages, ctx.model.contextWindow),
        lastEvent: "turn_start",
      });
      
      // ... agent turn logic ...
      
      // Turn end
      await bridge.telemetryHeartbeat({
        state: {
          activity: "waiting_input",
          idle: true,
          idleSince: Date.now(),
        },
        messages: {
          lastAssistantText: extractText(lastResponse),
          lastAssistantHtml: renderLastAssistantHtml(lastResponse),
          lastAssistantUpdatedAt: Date.now(),
        },
        context: calculateContextPressure(ctx.messages, ctx.model.contextWindow),
        lastEvent: "turn_end",
      });
    }
  } finally {
    clearInterval(heartbeatInterval);
    await bridge.telemetryCleanup(process.pid);
  }
}
```

**Helper Functions:**

```typescript
function detectMux(): "tmux" | "zellij" | null {
  if (process.env.TMUX) return "tmux";
  if (process.env.ZELLIJ) return "zellij";
  return null;
}

function getMuxSession(): string | null {
  if (process.env.TMUX) {
    // Parse tmux socket path
    const match = process.env.TMUX.match(/\/([^/]+),\d+,\d+$/);
    return match?.[1] ?? null;
  }
  if (process.env.ZELLIJ_SESSION_NAME) {
    return process.env.ZELLIJ_SESSION_NAME;
  }
  return null;
}

function getMuxWindowId(): string | null {
  if (process.env.TMUX_PANE) return process.env.TMUX_PANE;
  return null;
}

function detectTerminal(): string | null {
  if (process.env.TERM_PROGRAM) return process.env.TERM_PROGRAM;
  if (process.env.TERMINAL_EMULATOR) return process.env.TERMINAL_EMULATOR;
  return null;
}

async function getGitInfo(): Promise<{ branch?: string; commit?: string; dirty?: boolean; remote?: string }> {
  try {
    const { execSync } = await import("node:child_process");
    
    const branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
    const commit = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    const status = execSync("git status --porcelain", { encoding: "utf-8" }).trim();
    const remote = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
    
    return {
      branch,
      commit,
      dirty: status.length > 0,
      remote,
    };
  } catch {
    return {};
  }
}
```

**Tests:**

```typescript
// packages/bridge/test/chitragupta-telemetry.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ChitraguptaBridge } from "../src/chitragupta.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("ChitraguptaBridge Telemetry", () => {
  let bridge: ChitraguptaBridge;
  let telemetryDir: string;
  
  beforeEach(async () => {
    telemetryDir = path.join(os.tmpdir(), `takumi-test-${Date.now()}`);
    process.env.TAKUMI_TELEMETRY_DIR = telemetryDir;
    bridge = new ChitraguptaBridge();
    await bridge.connect();
  });
  
  afterEach(async () => {
    await bridge.disconnect();
    await fs.rm(telemetryDir, { recursive: true, force: true });
  });
  
  it("should emit heartbeat", async () => {
    await bridge.telemetryHeartbeat({
      process: {
        pid: process.pid,
        ppid: process.ppid ?? null,
        uptime: process.uptime(),
        heartbeatAt: Date.now(),
        startedAt: Date.now(),
      },
      state: { activity: "working", idle: false },
    });
    
    const file = path.join(telemetryDir, `${process.pid}.json`);
    const content = await fs.readFile(file, "utf-8");
    const data = JSON.parse(content);
    
    expect(data.schemaVersion).toBe(2);
    expect(data.process.pid).toBe(process.pid);
    expect(data.state.activity).toBe("working");
  });
  
  it("should cleanup telemetry file", async () => {
    await bridge.telemetryHeartbeat({
      process: {
        pid: process.pid,
        ppid: null,
        uptime: 0,
        heartbeatAt: Date.now(),
        startedAt: Date.now(),
      },
    });
    
    const file = path.join(telemetryDir, `${process.pid}.json`);
    await expect(fs.access(file)).resolves.toBeUndefined();
    
    await bridge.telemetryCleanup(process.pid);
    await expect(fs.access(file)).rejects.toThrow();
  });
  
  it("should generate snapshot", async () => {
    await bridge.telemetryHeartbeat({
      process: {
        pid: process.pid,
        ppid: null,
        uptime: 0,
        heartbeatAt: Date.now(),
        startedAt: Date.now(),
      },
      session: { id: "test-session", file: "test.json", name: "test" },
      state: { activity: "working", idle: false },
      context: {
        tokens: 100,
        contextWindow: 1000,
        remainingTokens: 900,
        percent: 10,
        pressure: "normal",
        closeToLimit: false,
        nearLimit: false,
      },
    });
    
    const snapshot = await bridge.telemetrySnapshot();
    
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.counts.total).toBe(1);
    expect(snapshot.counts.working).toBe(1);
    expect(snapshot.aggregate).toBe("working");
  });
  
  it("should filter stale instances", async () => {
    await bridge.telemetryHeartbeat({
      process: {
        pid: process.pid,
        ppid: null,
        uptime: 0,
        heartbeatAt: Date.now() - 20000,  // 20s ago
        startedAt: Date.now() - 20000,
      },
      session: { id: "test", file: "test.json", name: "test" },
      state: { activity: "working", idle: false },
      context: {
        tokens: 0,
        contextWindow: 1000,
        remainingTokens: 1000,
        percent: 0,
        pressure: "normal",
        closeToLimit: false,
        nearLimit: false,
      },
    });
    
    const snapshot = await bridge.telemetrySnapshot(10000);  // 10s threshold
    
    expect(snapshot.counts.total).toBe(0);  // Stale instance filtered out
  });
});
```

**Success Criteria:**
- ✅ Telemetry files created in `~/.takumi/telemetry/instances/`
- ✅ Heartbeats emitted at correct intervals
- ✅ Files cleaned up on graceful shutdown
- ✅ Snapshot aggregates multiple instances correctly

---

### 14.3 Snapshot CLI Tool (1 day)

**New File:** `bin/telemetry-snapshot.ts`

```typescript
#!/usr/bin/env tsx
import { createChitraguptaBridge } from "@takumi/bridge";

async function main() {
  const args = process.argv.slice(2);
  
  const staleMs = args.includes("--stale-ms")
    ? Number(args[args.indexOf("--stale-ms") + 1])
    : 10000;
  
  const pretty = args.includes("--pretty");
  
  const bridge = createChitraguptaBridge();
  await bridge.connect();
  
  try {
    const snapshot = await bridge.telemetrySnapshot(staleMs);
    console.log(pretty ? JSON.stringify(snapshot, null, 2) : JSON.stringify(snapshot));
  } finally {
    await bridge.disconnect();
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
```

**Update `package.json`:**

```json
{
  "bin": {
    "takumi": "./bin/takumi.ts",
    "takumi-telemetry-snapshot": "./bin/telemetry-snapshot.ts"
  }
}
```

**Usage Examples:**

```bash
# Default JSON (compact)
takumi-telemetry-snapshot

# Pretty-printed
takumi-telemetry-snapshot --pretty

# Custom stale threshold
takumi-telemetry-snapshot --stale-ms 5000

# Pipe to jq for filtering
takumi-telemetry-snapshot | jq '.instances[] | select(.state.activity == "working")'

# Watch mode (with watch command)
watch -n 1 "takumi-telemetry-snapshot --pretty"
```

**Success Criteria:**
- ✅ CLI executes without errors
- ✅ Output matches TelemetrySnapshot schema
- ✅ Can be piped to jq for filtering

---

### 14.4 Context Pressure UI (2 days)

**Goal:** Visual feedback for approaching context limits

**Files to modify:**
1. `packages/tui/src/status-bar.ts` — Add context pressure indicator
2. `packages/agent/src/loop.ts` — Trigger auto-consolidation

**Status Bar Integration:**

```typescript
// packages/tui/src/status-bar.ts

import type { TelemetryContext } from "@takumi/bridge";

export class StatusBar {
  // ... existing code ...
  
  renderContextPressure(context: TelemetryContext): string {
    const icon = {
      "normal": "✓",
      "approaching_limit": "⚠️",
      "near_limit": "🔶",
      "at_limit": "🔴",
    }[context.pressure];
    
    const color = {
      "normal": this.theme.success,
      "approaching_limit": this.theme.warning,
      "near_limit": this.theme.warning,
      "at_limit": this.theme.error,
    }[context.pressure];
    
    const text = `${icon} Context: ${context.percent.toFixed(0)}%`;
    
    return this.colorize(text, color);
  }
  
  showContextWarning(context: TelemetryContext): void {
    if (context.pressure === "approaching_limit") {
      this.showBanner("⚠️ Context approaching limit (85%)", "warning");
    } else if (context.pressure === "near_limit") {
      this.showBanner("🔶 Context near limit (95%) — consider consolidation", "warning");
    } else if (context.pressure === "at_limit") {
      this.showBanner("🔴 Context at limit — consolidation required", "error");
    }
  }
}
```

**Auto-Consolidation Trigger:**

```typescript
// packages/agent/src/loop.ts

async function runAgentLoop(ctx: AgentContext): Promise<void> {
  // ... existing setup ...
  
  while (true) {
    const context = calculateContextPressure(ctx.messages, ctx.model.contextWindow);
    
    // Show UI warning
    if (ctx.ui) {
      ctx.ui.statusBar.showContextWarning(context);
    }
    
    // Auto-consolidate if near limit
    if (context.nearLimit && !ctx.consolidationInProgress) {
      ctx.consolidationInProgress = true;
      
      try {
        await ctx.bridge.consolidateSession(ctx.sessionId, {
          minEventsToKeep: 10,
          targetCompressionRatio: 0.5,
        });
        
        // Reload messages after consolidation
        ctx.messages = await loadConsolidatedMessages(ctx.sessionId);
        
        if (ctx.ui) {
          ctx.ui.statusBar.showBanner("✓ Session consolidated", "success");
        }
      } catch (err) {
        if (ctx.ui) {
          ctx.ui.statusBar.showBanner(`Consolidation failed: ${err.message}`, "error");
        }
      } finally {
        ctx.consolidationInProgress = false;
      }
    }
    
    // ... rest of turn logic ...
  }
}
```

**Success Criteria:**
- ✅ Status bar shows context percentage with color coding
- ✅ Warnings appear at 85%/95%/100% thresholds
- ✅ Auto-consolidation triggers at 95%
- ✅ UI updates after consolidation

---

## Testing Strategy

### Unit Tests
- Context pressure calculation (all 4 levels)
- Token estimation (string and array messages)
- Telemetry serialization (schema v2 compliance)
- Heartbeat file operations (create, update, cleanup)
- Snapshot aggregation (counts, context stats, sessions)
- Stale instance filtering

### Integration Tests
- Full agent loop with telemetry emission
- Multi-process scenario (spawn 3 agents, check snapshot)
- Auto-consolidation trigger
- Graceful shutdown cleanup

### Manual Tests
- Run `takumi` and watch `~/.takumi/telemetry/instances/*.json`
- Run `takumi-telemetry-snapshot` while agent is active
- Test with `watch -n 1 "takumi-telemetry-snapshot --pretty"`
- Verify pi-statusbar can consume Takumi telemetry (if available)

---

## Migration Notes

**Backwards Compatibility:**
- Existing sessions unaffected (telemetry is additive)
- Old Chitragupta memory files unchanged
- No breaking API changes

**First Run:**
- Telemetry directory auto-created on first heartbeat
- No manual setup required
- Orphan files from crashes will be ignored (stale filtering)

**Performance Impact:**
- Telemetry write: ~1-2ms per heartbeat (atomic file write)
- Snapshot read: ~5-10ms for 10 instances
- Negligible impact on agent loop performance

---

## Success Metrics

### Phase 14 Complete When:
- ✅ All pi-telemetry v2 interfaces defined
- ✅ Heartbeats emitted at correct lifecycle events
- ✅ Snapshot CLI working and tested
- ✅ Context pressure UI integrated
- ✅ Auto-consolidation triggers at 95%
- ✅ All tests passing (2053+ tests)
- ✅ Documentation updated

### Ecosystem Compatibility:
- ✅ pi-statusbar can consume Takumi telemetry
- ✅ Custom monitoring tools can read snapshots
- ✅ Remote clients can observe agent state (via HTTP bridge in Phase 16)

---

## Next Steps After Phase 14

### Phase 15: Side Agent Integration
- Hybrid orchestration (validators + work agents)
- Tmux + worktree pattern from pi-side-agents
- Optional validator isolation mode

### Phase 16: HTTP Bridge
- Fastify server with bearer token auth
- `/status`, `/watch`, `/latest/<pid>`, `/send` endpoints
- Mobile/web client support

---

## Questions / Decisions

### Q1: Should telemetry be opt-out?
**Decision:** Always on, minimal overhead, essential for observability

### Q2: Should we match pi-telemetry field names exactly?
**Decision:** Yes, for ecosystem compatibility (even if some fields seem redundant)

### Q3: Should auto-consolidation be configurable?
**Decision:** Yes, add `autoConsolidate: boolean` to config (default: true)

### Q4: Should we support custom telemetry backends (not just files)?
**Decision:** Not in Phase 14, but design for extensibility (future: SQLite, Redis)

---

## Resources

- **pi-telemetry spec:** https://github.com/jademind/pi-telemetry
- **pi-statusbar (consumer):** https://github.com/jademind/pi-statusbar
- **Context pressure model:** TELEMETRY_CLOSE_PERCENT=85, TELEMETRY_NEAR_PERCENT=95
- **Schema v2:** See `packages/bridge/src/chitragupta-types.ts`

---

**Ready to start? Begin with 14.1 Schema Alignment!** ⚡
