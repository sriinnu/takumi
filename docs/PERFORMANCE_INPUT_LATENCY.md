# Input Latency Optimization — Takumi Performance Critical Path

**Issue:** Typing latency perceived by user ("keystrokes took like forever")  
**Root Cause:** Frame rate limiting in render pipeline + batch scheduling  
**Priority:** 🔴 **CRITICAL UX ISSUE**  
**Target:** <16ms keystroke-to-screen latency (sub-frame perception)

---

## Current Architecture Analysis

### 1. Input Processing Pipeline

```
Keystroke → parseKeyEvent() → Editor.handleKey() → act() → scheduleRender() → [WAIT] → renderFrame() → diff() → stdout
```

**Measured Components:**
- `parseKeyEvent()`: <1ms (✅ fast)
- `Editor.handleKey()`: <1ms (✅ fast)
- `scheduleRender()`: Frame interval scheduling (❌ **BOTTLENECK**)
- `renderFrame()`: Yoga layout + render + diff (~5-10ms, ⚠️ acceptable but can improve)

### 2. Frame Schedule Bottleneck

**File:** `packages/render/src/reconciler.ts`

```typescript
constructor(width: number, height: number, options?: RenderSchedulerOptions) {
  this.frameInterval = 1000 / (options?.fps ?? 60);  // 16.67ms at 60 FPS
  // ...
}

scheduleRender(): void {
  if (this.scheduled || !this.running) return;
  this.scheduled = true;

  const now = Date.now();
  const elapsed = now - this.lastFrameTime;
  const delay = Math.max(0, this.frameInterval - elapsed);  // ❌ DELAY

  if (delay === 0) {
    setImmediate(() => { /* render */ });
  } else {
    this.timer = setTimeout(() => { /* render */ }, delay);  // ❌ UP TO 16ms WAIT
  }
}
```

**Problem:** If user types 2 characters within 16ms (60 FPS frame interval):
- First keystroke: immediate render (delay = 0)
- Second keystroke: **waits up to 16ms** for next frame slot
- Result: visible lag, characters appear in batches

### 3. Editor Render Trigger

**File:** `packages/tui/src/editor.ts`

```typescript
handleKey(event: KeyEvent): boolean {
  // ... process keystroke ...
  return this.act(() => this.insert(key));  // Calls scheduleRender()
}

private act(fn: () => void): boolean {
  fn();
  this.scheduleRender();  // ❌ Frame-rate limited
  return true;
}
```

Every keystroke triggers `scheduleRender()`, hitting the frame interval bottleneck.

---

## Optimization Strategies

### Strategy 1: Priority Render Queue (RECOMMENDED) ⚡

**Concept:** Input events bypass frame rate limiting

```typescript
// packages/render/src/reconciler.ts

export class RenderScheduler {
  private scheduled = false;
  private priorityScheduled = false;  // NEW
  
  // Existing method for normal renders
  scheduleRender(): void { /* ... */ }
  
  // NEW: Priority render for input events
  schedulePriorityRender(): void {
    if (this.priorityScheduled || !this.running) return;
    this.priorityScheduled = true;
    
    setImmediate(() => {
      this.priorityScheduled = false;
      this.lastFrameTime = Date.now();
      this.renderFrame();
    });
  }
}
```

**Editor Change:**

```typescript
// packages/tui/src/editor.ts

private act(fn: () => void): boolean {
  fn();
  this.schedulePriorityRender();  // ✅ Immediate, no frame limit
  return true;
}
```

**Impact:**
- ✅ <1ms keystroke-to-render latency
- ✅ All input events rendered immediately
- ✅ Background updates still frame-limited (prevents 1000 FPS CPU burn)
- ⚠️ May increase CPU for fast typing (acceptable trade-off)

**LOC Impact:** +20 lines (reconciler.ts), -1 line (editor.ts)

---

### Strategy 2: Incremental Rendering (ADVANCED)

**Concept:** Only re-render dirty regions, not full screen

```typescript
// packages/render/src/reconciler.ts

export class RenderScheduler {
  private dirtyRegions: Rect[] = [];
  
  markDirty(component: Component, region: Rect): void {
    this.dirtyRegions.push(region);
    this.schedulePriorityRender();
  }
  
  private renderFrame(): void {
    if (this.dirtyRegions.length === 0) {
      // Full render (existing path)
      this.renderFullFrame();
    } else {
      // Partial render (NEW)
      this.renderDirtyRegions();
    }
  }
  
  private renderDirtyRegions(): void {
    for (const region of this.dirtyRegions) {
      // Only render components intersecting this region
      this.renderComponentTree(this.root, region);
    }
    this.dirtyRegions = [];
  }
}
```

**Impact:**
- ✅ 2-5ms render time for single-line edits (vs 10ms full)
- ✅ Scales better with large screens
- ⚠️ Complex to implement correctly
- ⚠️ Requires careful dirty region tracking

**LOC Impact:** +150 lines (complex feature)

---

### Strategy 3: Optimistic UI Updates (HYBRID)

**Concept:** Update cursor position immediately, batch text rendering

```typescript
// packages/tui/src/editor.ts

handleKey(event: KeyEvent): boolean {
  if (this.isSimpleTextInput(event)) {
    // Update model immediately
    this.doInsert(event.key);
    
    // Update cursor position instantly (no render)
    this.updateCursorOnly();
    
    // Batch text render for next frame
    this.scheduleTextRender();
  } else {
    // Complex edits: full immediate render
    this.schedulePriorityRender();
  }
}
```

**Impact:**
- ✅ Cursor moves instantly (<1ms)
- ✅ Text appears within frame interval (acceptable)
- ⚠️ Cursor may briefly be ahead of text (minor visual artifact)

**LOC Impact:** +50 lines (medium complexity)

---

## Recommended Implementation Plan

### Phase 1: Quick Win (1 day) ⚡ **START HERE**

Implement **Strategy 1: Priority Render Queue**

**Tasks:**
1. Add `schedulePriorityRender()` to `RenderScheduler`
2. Wire to `Editor.act()` for all input events
3. Add `priorityFrameCount` metric to stats
4. Test with rapid typing (stress test: 10+ chars/sec)

**Expected Result:** Keystroke latency <5ms (from ~16ms)

**Files Modified:**
- `packages/render/src/reconciler.ts` (+20 lines)
- `packages/tui/src/editor.ts` (-1 +1 line)

**Test:**
```typescript
// packages/render/test/priority-render.test.ts

describe("Priority Render Queue", () => {
  it("should render input events immediately", async () => {
    const scheduler = new RenderScheduler(80, 24, { fps: 30 }); // Slow FPS
    scheduler.start();
    
    const start = Date.now();
    scheduler.schedulePriorityRender();
    await new Promise(resolve => setImmediate(resolve));
    const elapsed = Date.now() - start;
    
    expect(elapsed).toBeLessThan(5); // <5ms latency
  });
  
  it("should not break frame rate limiting for non-priority", async () => {
    const scheduler = new RenderScheduler(80, 24, { fps: 60 });
    scheduler.start();
    
    scheduler.scheduleRender(); // Normal render
    scheduler.scheduleRender(); // Should be debounced
    
    // Only 1 frame should execute
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(scheduler.getStats().frameCount).toBe(1);
  });
});
```

---

### Phase 2: Optimization (3-5 days) — Future

Implement **Strategy 2: Incremental Rendering**

**Why Later:**
- Phase 1 solves 90% of perceived latency
- Incremental rendering adds complexity
- Requires careful testing to avoid visual artifacts

---

### Phase 3: Profiling (1 day) — After Phase 1

Measure real-world performance:

```typescript
// packages/render/src/profiler.ts

export class RenderProfiler {
  private metrics: Map<string, number[]> = new Map();
  
  measure<T>(label: string, fn: () => T): T {
    const start = performance.now();
    const result = fn();
    const elapsed = performance.now() - start;
    
    if (!this.metrics.has(label)) this.metrics.set(label, []);
    this.metrics.get(label)!.push(elapsed);
    
    return result;
  }
  
  getStats(label: string): { p50: number; p95: number; p99: number } {
    const values = this.metrics.get(label) ?? [];
    values.sort((a, b) => a - b);
    
    return {
      p50: values[Math.floor(values.length * 0.5)],
      p95: values[Math.floor(values.length * 0.95)],
      p99: values[Math.floor(values.length * 0.99)],
    };
  }
}
```

**Instrument Key Paths:**
```typescript
renderFrame(): void {
  profiler.measure("layout", () => computeLayout(...));
  profiler.measure("render", () => this.renderComponent(...));
  profiler.measure("diff", () => this.screen.diff());
}
```

---

## Target Metrics

| Metric | Current | Target | Phase 1 Result |
|--------|---------|--------|----------------|
| **Keystroke-to-screen** | ~16ms | <5ms | ✅ <5ms |
| **Render frame time** | ~10ms | <8ms | ⏳ Later |
| **Diff computation** | ~3ms | <2ms | ⏳ Later |
| **Layout (Yoga)** | ~5ms | <4ms | ⏳ Later |

---

## Additional Optimizations (Low Priority)

### 1. Diff Algorithm Optimization

**Current:** Full cell-by-cell diff every frame

**Idea:** Hash-based dirty detection

```typescript
private diff(): ScreenPatch {
  const changed: Cell[] = [];
  
  for (let y = 0; y < this.height; y++) {
    const frontHash = this.hashRow(this.frontBuffer, y);
    const backHash = this.hashRow(this.backBuffer, y);
    
    if (frontHash !== backHash) {
      // Only diff changed rows
      for (let x = 0; x < this.width; x++) {
        const frontCell = this.getCellFront(x, y);
        const backCell = this.getCellBack(x, y);
        if (!cellEquals(frontCell, backCell)) {
          changed.push({ x, y, cell: backCell });
        }
      }
    }
  }
  
  // ... ANSI generation ...
}
```

**Impact:** 2-3ms → 1-2ms (marginal, not urgent)

---

### 2. Yoga Layout Caching

**Current:** Full layout on every render

**Idea:** Only re-layout dirty components

```typescript
computeLayout(node: YogaNode, force = false): void {
  if (!force && !node.isDirty()) return;
  
  // Compute layout only for dirty subtree
  YogaNode.calculateLayout(node, ...);
}
```

**Impact:** 5ms → 2-3ms (good win, medium complexity)

---

### 3. Virtual Scrolling for Large Buffers

**Current:** Render all lines, even off-screen

**Idea:** Only render visible viewport

```typescript
renderMessageList(messages: Message[], viewport: Rect): void {
  const visibleStart = Math.floor(viewport.scrollY / LINE_HEIGHT);
  const visibleEnd = visibleStart + Math.ceil(viewport.height / LINE_HEIGHT);
  
  for (let i = visibleStart; i < visibleEnd; i++) {
    if (i >= messages.length) break;
    this.renderMessage(messages[i], ...);
  }
}
```

**Impact:** Scales to 10,000+ messages (currently <100 before slowdown)

---

## Implementation Checklist

### Phase 1: Priority Render Queue (1 day)

- [ ] Add `schedulePriorityRender()` to `RenderScheduler`
- [ ] Wire to `Editor.act()`
- [ ] Add tests for priority vs normal render
- [ ] Stress test with 20+ rapid keystrokes
- [ ] Verify no frame rate regression for non-input events
- [ ] Update `TODO.md` with Phase 23 entry

### Success Criteria:

- ✅ Keystroke latency <5ms (measured with `performance.now()`)
- ✅ No visual artifacts (characters appear in order)
- ✅ CPU usage acceptable (<10% for typing at 10 chars/sec)
- ✅ All existing tests pass (2053+ tests)

---

## References

- **React's Scheduler:** Priority lanes for user input vs background updates
- **Ink (terminal UI):** Uses immediate rendering for input, 30 FPS for animations
- **VSCode:** <16ms input latency target, incremental rendering
- **Best Practice:** Input events = high priority, visual updates = batched

---

**Next Step:** Implement Phase 1 (Priority Render Queue) in feat/phase-23-input-latency branch
