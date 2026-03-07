<p align="center">
    <img src="./logo.svg" alt="Takumi logo" width="160" />
</p>

# Algorithms — Kagami Renderer (鏡)

> Rendering algorithms, layout computation, diffing strategy, and
> performance notes for the Kagami rendering engine.

## Rendering Pipeline

Every frame follows this six-stage pipeline:

```
Signal Change → Dirty Marking → Yoga Layout → Render Pass → Diff → ANSI Flush
```

### Stage 1 — Signal Change

When a reactive signal is written, all subscribers are notified immediately
(or batched when inside a `batch()` call). Subscribers include `computed`
nodes, `effect` nodes, and component dirty-trackers.

```
inputBuffer.value = "hello"
    ↓
Editor component subscribed → markDirty()
    ↓
Render scheduler picks up dirty component
```

**Complexity**: O(S) per write, where S = number of subscribers.

### Stage 2 — Dirty Marking

Components track dirtiness via a boolean flag. When a signal dependency
changes, `markDirty()` is called on the owning component. The render
scheduler collects all dirty components before the next frame.

In practice, the scheduler performs a **full tree traversal** each frame
(since layout relationships mean a parent's size change can affect
children). This keeps the implementation simple while staying well under
budget at typical tree depths (~20–50 nodes).

### Stage 3 — Yoga Layout

[Yoga](https://www.yogalayout.dev/) is Facebook's cross-platform flexbox
engine compiled to WebAssembly. Each component owns a `YogaNode` that
mirrors the component tree.

```
root.calculateLayout(terminalWidth, terminalHeight, DIRECTION_LTR)
```

After layout, every node has computed `left`, `top`, `width`, `height`
values representing its absolute position and size in terminal cells.

**Supported properties**: `flexDirection`, `justifyContent`, `alignItems`,
`flexGrow`, `flexShrink`, `flexBasis`, `padding`, `margin`, `border`,
`width`, `height`, `minWidth`, `maxWidth`, `overflow`, `position`.

**Complexity**: O(N) where N = number of Yoga nodes (single-pass for
simple layouts; up to O(N²) for deeply nested flex-wrap scenarios).

### Stage 4 — Render Pass

Each component's `render(screen, rect)` method writes cells into the
back buffer. The render traversal is depth-first, parent before children.

```typescript
renderComponent(component, rect):
    if component is hidden → skip
    component.render(screen, rect)   // writes to back buffer
    component.clearDirty()
    for child in component.children:
        childRect = child.getAbsoluteRect()
        renderComponent(child, childRect)
```

Components write characters to specific `(row, col)` positions on the
`Screen` back buffer. Each cell stores: character, foreground color,
background color, and style flags (bold, dim, italic, underline,
strikethrough).

### Stage 5 — Diff Pass

The `Screen` maintains two buffers: **front** (what's currently on the
terminal) and **back** (what we want). The diff pass compares them
cell-by-cell:

```typescript
for each cell (row, col):
    if back[row][col] !== front[row][col]:
        emit cursor-move + style-set + character
        front[row][col] = back[row][col]
```

**Optimization**: consecutive changed cells on the same row are batched
into a single cursor-move + string write. Style transitions (color,
bold, etc.) are tracked to avoid redundant escape sequences.

**Complexity**: O(W × H) where W = screen width, H = screen height.
Typical terminal: 200 × 50 = 10,000 cells — trivially fast.

### Stage 6 — ANSI Flush

The diff pass produces a string of ANSI escape sequences that is written
to stdout in a single `write()` call. When the terminal supports
**synchronized output** (DEC mode 2026), the string is wrapped:

```
ESC[?2026h   ← begin synchronized update
...patch...
ESC[?2026l   ← end synchronized update
```

This prevents visible tearing on terminals like Ghostty, WezTerm, and
Kitty that support the protocol.

## Double-Buffered Screen

The `Screen` class uses a flat `Cell[]` array for each buffer, indexed
as `row * width + col`.

```typescript
interface Cell {
    char: string;       // single grapheme
    fg: number;         // foreground color (ANSI 256 or -1 for default)
    bg: number;         // background color
    bold: boolean;
    dim: boolean;
    italic: boolean;
    underline: boolean;
    strikethrough: boolean;
}
```

### Buffer Operations

| Method | Description | Complexity |
|--------|-------------|------------|
| `clear()` | Reset back buffer to empty cells | O(W × H) |
| `resize(w, h)` | Reallocate both buffers | O(W × H) |
| `writeText(row, col, text, style)` | Write styled text at position | O(len) |
| `writeCell(row, col, cell)` | Write single cell | O(1) |
| `diff()` | Compare front/back, produce ANSI patch | O(W × H) |
| `invalidate()` | Force all cells dirty (full repaint) | O(W × H) |

## Reactive Signals — Myaku (脈)

Based on the [Preact Signals](https://preactjs.com/blog/signal-boosting/)
algorithm. The core insight: instead of a virtual DOM diffing tree, track
**which data changed** and **who depends on it**, then update only those
subscribers.

### Primitives

| Primitive | Purpose | Lazy? | Cached? |
|-----------|---------|-------|---------|
| `signal(value)` | Writable reactive value | — | — |
| `computed(fn)` | Derived value | Yes | Yes |
| `effect(fn)` | Side effect on change | No | — |
| `batch(fn)` | Group writes, single flush | — | — |
| `untrack(fn)` | Read without subscribing | — | — |

### Dependency Tracking

A global `currentObserver` variable tracks which computation is currently
evaluating. When a signal's `.value` getter is accessed, it registers
`currentObserver` as a subscriber:

```
effect(() => {
    statusBar.setTokenCount(tokens.value)  // tokens subscribes this effect
})
```

When `tokens.value` is later set, the effect is re-queued.

### Version Counter

A global monotonic counter (`globalVersion`) increments on every signal
write. Computed nodes compare their recorded version against the global
to determine staleness — avoiding unnecessary recomputation.

### Batch Semantics

Inside a `batch()` call, signal writes still update their internal value
but **defer** subscriber notifications. When the outermost `batch()`
exits, all pending effects run once. This prevents cascading updates
during multi-signal state changes (e.g., updating messages, tokens, and
cost simultaneously).

## Text Measurement

Terminal text measurement is non-trivial due to:

- **CJK characters** — 2 columns wide (fullwidth)
- **Emoji** — 1 or 2 columns depending on terminal
- **ANSI escapes** — 0 width (invisible control sequences)
- **Combining characters** — 0 width (accents, diacritics)

The `text.ts` module uses East Asian Width categorization plus grapheme
cluster segmentation:

```typescript
function measureText(text: string): number {
    let width = 0;
    for (const grapheme of segmentGraphemes(text)) {
        if (isANSIEscape(grapheme)) continue;
        width += isFullwidth(grapheme) ? 2 : 1;
    }
    return width;
}
```

**References**:
- Unicode Standard Annex #11: East Asian Width
- Unicode Standard Annex #29: Grapheme Cluster Boundaries

## Frame Scheduling

The `RenderScheduler` uses a frame-budget approach:

1. Target: 60 FPS (configurable), so frame interval = ~16.6 ms.
2. When `scheduleRender()` is called, the scheduler checks elapsed time
   since the last frame.
3. If enough time has passed → render immediately via `setImmediate()`.
4. Otherwise → schedule via `setTimeout(delay)` for the remaining budget.
5. During idle (no signal changes) → **zero frames rendered** (no busy loop).

```
scheduleRender():
    elapsed = now - lastFrameTime
    delay = max(0, frameInterval - elapsed)
    if delay == 0 → setImmediate(renderFrame)
    else          → setTimeout(renderFrame, delay)
```

### Adaptive Rendering During Streaming

During LLM streaming, tokens arrive at ~50–100/s. Rather than rendering
every token, the scheduler naturally debounces: multiple signal writes
within one frame interval produce a single render.

## Synchronized Output Protocol

Terminals that support [DEC mode 2026](https://gist.github.com/christianparpart/d8a62cc1ab659194571ec44513c69c40)
allow atomic screen updates. The renderer wraps each frame's ANSI output
in begin/end markers:

```
\x1b[?2026h   (begin sync)
...all ANSI for this frame...
\x1b[?2026l   (end sync)
```

Terminal detection is done via environment variables:

| Terminal | Detection | Sync Output |
|----------|-----------|-------------|
| Ghostty | `TERM_PROGRAM=ghostty` | Yes |
| WezTerm | `TERM_PROGRAM=WezTerm` | Yes |
| Kitty | `TERM_PROGRAM=Kitty` | Yes |
| iTerm2 | `TERM_PROGRAM=iTerm.app` | Yes |
| Apple Terminal | `TERM_PROGRAM=Apple_Terminal` | No |
| VS Code | `TERM_PROGRAM=vscode` | Yes |

## Performance Budget

### Per-Frame Budget (16 ms target)

| Stage | Budget | Typical |
|-------|--------|---------|
| Signal notification | 0.1 ms | 0.05 ms |
| Yoga layout | 2 ms | 0.5 ms |
| Render pass | 4 ms | 1.5 ms |
| Diff | 1 ms | 0.3 ms |
| ANSI flush | 1 ms | 0.2 ms |
| **Total** | **8.1 ms** | **2.55 ms** |

### Memory Budget

| Component | Budget | Notes |
|-----------|--------|-------|
| Screen buffers (80×24) | ~30 KB | 2 × 1920 cells × ~8 bytes |
| Screen buffers (200×50) | ~160 KB | 2 × 10000 cells × ~8 bytes |
| Yoga layout tree | <1 MB | ~50 nodes typical |
| Signal graph | <500 KB | ~200 signals typical |
| Total idle | <50 MB | Before any conversation |

## Comparison

| Approach | Render Overhead | Layout | Dependencies |
|----------|----------------|--------|-------------|
| React + Ink | ~8 ms | Yoga (via Ink) | react, ink, yoga |
| Blessed | ~12 ms | Absolute | blessed |
| Bubble Tea | ~3 ms | Lipgloss (Go) | bubbletea |
| **Kagami** | **~2 ms** | Yoga (direct) | yoga-wasm-web only |
