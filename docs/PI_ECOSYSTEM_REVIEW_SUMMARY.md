# Pi Ecosystem Review — Summary & Next Actions

**Date:** January 2026  
**Reviewed Projects:** 8 external pi-ecosystem repositories  
**Takumi Status:** Phase 13 complete (2053 tests passing)  
**Recommendation:** Proceed with Phase 20 (pi-telemetry v2 alignment)

---

## 📊 Review Scope

Analyzed the following external projects for ecosystem integration:

1. **pi-mono** (badlogic) — Core Pi framework
2. **pi-statusbar** (jademind) — macOS status bar with telemetry consumer + HTTP bridge
3. **pi-telemetry** (jademind) — Structured telemetry schema v2 standard
4. **pi-ssh** (hjanuschka) — Remote SSH workflow extension
5. **pi-nanny** (hjanuschka) — Bedtime enforcement extension  
6. **pi-side-agents** (pasky) — Parallel agent orchestration with tmux + worktrees
7. **pi-design-deck** (nicobailon) — Browser-based visual decision tool
8. **Mario Zechner's anti-MCP blog** — Bash-first tool philosophy

**Architecture Context:**
- **Takumi** (this repo): Terminal UI for AI coding agents (Japanese names: Takumi 匠, Kagami 鏡)
- **Chitragupta** (external): AI agent platform at `AUriva/chitragupta` (Vedic names: Akasha, Vidhi, Vasana, Smriti, Niyanta, etc.)
- **Integration**: Takumi → `@takumi/bridge` → `@yugenlab/chitragupta` (v0.1.16) → daemon/MCP
- Takumi is the presentation layer, Chitragupta is the cognitive engine

---

## 🎯 Key Findings

### ✅ Takumi is Ahead
- **Multi-agent orchestration:** 7-role cluster (planner, workers, validators) vs pi's single-child model
- **arXiv strategies:** 6 research papers integrated (ensemble, reflexion, MoA, ToT, etc.)
- **Bandit learning:** Niyanta strategy selection with Thompson sampling
- **Daemon socket:** Already implemented correctly (ControlMaster pattern)

### ⚠️ Gaps Identified
1. **Telemetry schema mismatch:** Takumi's custom schema ≠ pi-telemetry v2 standard
2. **No context pressure model:** Missing 4-level pressure tracking (normal/approaching/near/at-limit)
3. **No HTTP bridge:** Cannot support remote/mobile clients
4. **Limited multi-process telemetry:** Current consolidation insufficient

### 🔗 Opportunities
- **pi-side-agents pattern:** Hybrid orchestration (validators in threads + work agents in worktrees)
- **pi-design-deck concept:** Visual decision-making for Takumi TUI
- **Bash-first tools:** Simplify tool definitions (200 tokens vs 13,000 for MCP)

---

## 📝 Documents Created

### 1. `PI_ECOSYSTEM_ANALYSIS.md` (Comprehensive)
- Detailed analysis of all 8 projects
- Architecture comparisons
- Schema specifications with code examples
- Implementation recommendations
- Testing strategy

**Location:** `/Users/srinivaspendela/Sriinnu/Personal/takumi/docs/PI_ECOSYSTEM_ANALYSIS.md`

### 2. `PHASE_14_PLAN.md` (Renamed to Phase 20)
- 4 sub-phases with detailed task breakdowns
- Code samples for all interfaces
- Test specifications
- Success criteria

**Location:** `/Users/srinivaspendela/Sriinnu/Personal/takumi/docs/PHASE_20_PLAN.md`

### 3. `TODO.md` Updated
- Added Phase 20-22: Pi Ecosystem Integration
- Phase 20: Telemetry & Observability (1-2 weeks) 🎯 **NEXT UP**
- Phase 21: Side Agent Integration (2-3 weeks) 🔄 FUTURE
- Phase 22: HTTP Bridge (1-2 weeks) 🔄 FUTURE

**Location:** `/Users/srinivaspendela/Sriinnu/Personal/takumi/TODO.md` (lines 1151-1298)

---

## 🚀 Immediate Next Actions

### Phase 20.1: Schema Alignment (START HERE) ⚡
**Timeline:** 3-4 days  
**Effort:** ~20 hours

**Tasks:**
1. Add pi-telemetry v2 interfaces to `packages/bridge/src/chitragupta-types.ts`
   - 10 new interfaces: `TelemetryProcess`, `TelemetrySystem`, etc.
   - `AgentTelemetry` (per-instance schema)
   - `TelemetrySnapshot` (aggregated schema)

2. Add telemetry constants to `packages/core/src/constants.ts`
   - `TELEMETRY_DIR = ~/.takumi/telemetry/instances`
   - `TELEMETRY_HEARTBEAT_MS = 1500`
   - `TELEMETRY_CLOSE_PERCENT = 85`
   - `TELEMETRY_NEAR_PERCENT = 95`
   - `TELEMETRY_STALE_MS = 10000`

3. Implement helpers in `packages/agent/src/loop.ts`
   - `calculateContextPressure(messages, contextWindow)` → 4 levels
   - `estimateTokens(messages)` → rough token count
   - `renderLastAssistantHtml(content)` → safe HTML

4. Write tests: `packages/agent/test/telemetry.test.ts`
   - Context pressure calculation (all 4 levels)
   - Token estimation (string + array content)
   - Edge cases (empty, overflow, etc.)

**Success Criteria:**
- ✅ All interfaces compile without errors
- ✅ Tests pass for pressure calculation
- ✅ Build succeeds with no type errors
- ✅ Target: 2405+ tests passing

**Start Command:**
```bash
cd /Users/srinivaspendela/Sriinnu/Personal/takumi
git checkout -b feat/phase-20-telemetry
code packages/bridge/src/chitragupta-types.ts
```

---

## 🧭 Accepted Productization Priorities

After the Pi research and the later production-readiness review, the next **highest-value product additions** are now explicitly accepted in this order:

1. **Approvals + audit trail**
2. **Eval / regression gate**
3. **Artifact persistence + handoff UX**
4. **Packaging / distribution**
5. **Operator observability**

### Why this order

- **Approvals + audit trail** turns existing permission primitives into a product-grade trust model.
- **Eval / regression gate** keeps Takumi from becoming impossible to evolve safely.
- **Artifact persistence + handoff UX** makes structured work survive session boundaries.
- **Packaging / distribution** makes Takumi usable as a product across terminal, desktop, Windows, and WSL surfaces.
- **Operator observability** turns telemetry from a data stream into an operational control plane.

### Recommended execution model

```text
Phase 20-22  Pi interoperability foundation
P-Track 1    Approvals + audit trail
P-Track 2    Eval / regression gate
P-Track 3    Artifact persistence + handoff UX
P-Track 4    Packaging / distribution
P-Track 5    Operator observability
```

### Scope of each accepted addition

#### 1. Approvals + audit trail
- approval queue and review surface (`/approvals`, pending items, escalation)
- persistent approval records with actor / time / tool / reason
- exportable audit log (JSONL + CSV)

#### 2. Eval / regression gate
- benchmark corpus for core coding-agent tasks
- tracked metrics: success, cost, latency, retries, human intervention
- release / CI gate that blocks unacceptable regressions

#### 3. Artifact persistence + handoff UX
- durable storage behind existing artifact types
- artifact browser and export flow
- handoff/reattach flow between sessions, branches, and side agents

#### 4. Packaging / distribution
- polished CLI install/start paths for macOS/Linux/Windows/WSL
- packaged desktop shell release flow
- clear surface model: terminal-first runtime + desktop companion + headless bridge

#### 5. Operator observability
- per-session and fleet-level dashboards
- context/cost/failure alerts
- replay/debug views for degraded runs and routing fallbacks

### Product principle

Takumi should not copy Pi's shape blindly. Pi is **terminal-first with companion surfaces**; Takumi should follow the same product pattern:

- privileged local runtime in terminal
- optional desktop/operator window
- optional headless / bridge / remote surface

---

## 🏗️ Architecture Decisions

### 1. Hybrid Orchestration (Phase 21)
**Decision:** Keep Takumi's blind validators in parallel threads (fast, reasoning-focused) **+** add pi-side-agents pattern for work parallelization (tmux + worktrees)

**Rationale:**
- Takumi's cluster orchestration is ahead of pi ecosystem
- pi-side-agents pattern useful for independent feature work
- Hybrid approach gives best of both worlds

**Config:**
```typescript
orchestration: {
  validatorIsolation: "thread" | "worktree",  // Per use case
  sideAgents: { enabled: true, maxConcurrent: 4 }
}
```

### 2. Telemetry-First Approach (Phase 20)
**Decision:** Full pi-telemetry v2 compatibility before HTTP bridge or side-agents

**Rationale:**
- Telemetry is foundation for remote monitoring
- HTTP bridge (Phase 22) depends on telemetry data
- Side-agents (Phase 21) benefit from telemetry tracking
- Enables pi-statusbar consumption immediately

### 3. Bash-First Tools (Future)
**Decision:** Explore bash-first tool definitions (Mario's anti-MCP philosophy)

**Rationale:**
- 200 tokens vs 13,000 for MCP schema
- Model already knows bash (no learning curve)
- Easy to extend on-demand
- MCP reserved for complex integrations

**Example:**
```bash
# ~/.takumi/tools/browser-tools/start.js
./start.js [--profile]

# ~/.takumi/tools/browser-tools/eval.js
./eval.js 'document.title'
```

---

## 📊 Phase 20 Roadmap

```
Phase 20.1: Schema Alignment         [████░░░░] 3-4 days   (START HERE)
Phase 20.2: Heartbeat Emission       [░░░░░░░░] 2-3 days   (After 20.1)
Phase 20.3: Snapshot CLI             [░░░░░░░░] 1 day      (After 20.2)
Phase 20.4: Context Pressure UI      [░░░░░░░░] 2 days     (After 20.3)

Total Phase 20 Estimate: 8-10 days (1-2 weeks)
```

**Milestones:**
- **M20.1:** All interfaces defined, tests passing
- **M20.2:** Telemetry files created, heartbeats working
- **M20.3:** `takumi-telemetry-snapshot` CLI functional
- **M20.4:** Context pressure UI with auto-consolidation

**Target:** 2425+ tests passing at Phase 20 completion

---

## 🔗 Cross-References

### Documentation
- `AGENTS.md` — Repository conventions, build commands
- `CLAUDE.md` — AI agent rules (no Co-Authored-By trailers!)
- `TAKUMI_MASTER_SPEC.md` — Overall project vision
- `docs/ARCHITECTURE.md` — System architecture
- `docs/orchestration.md` — Multi-agent orchestration details

### External Resources
- pi-telemetry spec: https://github.com/jademind/pi-telemetry
- pi-statusbar repo: https://github.com/jademind/pi-statusbar
- pi-side-agents repo: https://github.com/pasky/pi-side-agents
- pi-design-deck repo: https://github.com/nicobailon/pi-design-deck
- Mario's blog: https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/

---

## ✨ Summary

**Takumi is architecturally ahead** with advanced multi-agent orchestration and arXiv research integration. The **main priority is ecosystem interoperability** via pi-telemetry v2 alignment.

**Next Step:** Begin Phase 20.1 (Schema Alignment) — 3-4 days of focused work to add all telemetry interfaces and helpers.

**Expected Outcome:** After Phase 20-22, Takumi will be a **superset** of pi capabilities with:
- ✅ Full ecosystem compatibility (telemetry, tools, extensions)
- ✅ Advanced reasoning (6 arXiv strategies, bandit learning)
- ✅ Hybrid orchestration (validators + side agents)
- ✅ Remote access (HTTP bridge for mobile/web)

---

**Ready to start Phase 20.1? See `docs/PHASE_20_PLAN.md` for detailed implementation guide!**
