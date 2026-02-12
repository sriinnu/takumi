# Takumi (匠) — Implementation TODO

## Phase 0: Scaffold & Foundation (Week 1)

### Repo Setup
- [ ] Initialize git repo
- [ ] Create `pnpm-workspace.yaml`
- [ ] Create `tsconfig.base.json`
- [ ] Create `biome.json`
- [ ] Create `vitest.config.ts`
- [ ] Create root `package.json`
- [ ] Create `.gitignore`
- [ ] Create LICENSE (MIT)

### Package: `@takumi/core`
- [ ] `packages/core/package.json`
- [ ] `packages/core/tsconfig.json`
- [ ] `src/types.ts` — All shared type definitions
  - [ ] `Cell`, `Rect`, `Size`, `Position` types
  - [ ] `KeyEvent`, `MouseEvent` types
  - [ ] `AgentEvent` union type
  - [ ] `ToolDefinition`, `ToolResult`, `ToolContext` types
  - [ ] `PermissionRule`, `PermissionAction` types
  - [ ] `Message`, `ContentBlock`, `Usage` types
  - [ ] `SessionInfo`, `SessionState` types
  - [ ] `TakumiConfig` type
- [ ] `src/config.ts` — Config loader (file + env + defaults)
- [ ] `src/errors.ts` — Typed error hierarchy
- [ ] `src/constants.ts` — Key codes, ANSI sequences, limits
- [ ] `src/logger.ts` — File-based structured logger (never stdout)
- [ ] `src/index.ts` — Public exports
- [ ] Tests: config loading, error types

### Package: `@takumi/render`
- [ ] `packages/render/package.json` (dep: `yoga-wasm-web`)
- [ ] `packages/render/tsconfig.json`
- [ ] Stub `src/index.ts`

### Package: `@takumi/agent`
- [ ] `packages/agent/package.json`
- [ ] `packages/agent/tsconfig.json`
- [ ] Stub `src/index.ts`

### Package: `@takumi/tui`
- [ ] `packages/tui/package.json`
- [ ] `packages/tui/tsconfig.json`
- [ ] Stub `src/index.ts`

### Package: `@takumi/bridge`
- [ ] `packages/bridge/package.json`
- [ ] `packages/bridge/tsconfig.json`
- [ ] Stub `src/index.ts`

### Entry Point
- [ ] `bin/takumi.ts` — CLI entry (parse args, load config, launch)
- [ ] Verify `pnpm install` works
- [ ] Verify `pnpm -r run build` works
- [ ] Verify `pnpm -r run test` works (empty tests pass)

---

## Phase 1: Kagami Renderer (Week 2-3)

### ANSI Primitives (`render/src/ansi.ts`)
- [ ] `cursorTo(x, y)` — absolute positioning
- [ ] `cursorMove(dx, dy)` — relative movement
- [ ] `cursorShow()` / `cursorHide()`
- [ ] `clearScreen()` / `clearLine()` / `clearDown()`
- [ ] `fg(color)` / `bg(color)` — 256 + truecolor
- [ ] `bold()`, `dim()`, `italic()`, `underline()`, `strikethrough()`
- [ ] `reset()` — clear all styles
- [ ] `visibleLength(str)` — strip ANSI, count visible chars
- [ ] Tests: escape sequence generation, visibleLength accuracy

### Color System (`render/src/color.ts`)
- [ ] Named colors (16 standard)
- [ ] 256-color palette
- [ ] Truecolor (RGB) support
- [ ] Color interpolation (for gradients/themes)
- [ ] Terminal capability detection (256 vs truecolor)
- [ ] Tests: color conversion, capability detection

### Text Measurement (`render/src/text.ts`)
- [ ] `measureText(str)` — visible column width
- [ ] `segmentGraphemes(str)` — grapheme cluster iteration
- [ ] `isFullwidth(char)` — East Asian Width detection
- [ ] `wrapText(str, width)` — word-aware line wrapping
- [ ] `truncate(str, width, ellipsis?)` — truncation with ellipsis
- [ ] `padRight(str, width)` / `padLeft(str, width)` / `center(str, width)`
- [ ] Tests: CJK width, emoji width, ANSI stripping, wrapping edge cases

### Screen Buffer (`render/src/screen.ts`)
- [ ] `Cell` class with char + style
- [ ] `Screen` class — double-buffered grid
- [ ] `resize(width, height)` — handle terminal resize
- [ ] `clear()` — reset current buffer
- [ ] `writeCell(x, y, cell)` — write single cell
- [ ] `writeText(x, y, text, style)` — write styled text
- [ ] `diff()` — compute changed cells between frames
- [ ] `flush()` — write ANSI diff to stdout
- [ ] `swap()` — swap current ↔ previous buffer
- [ ] Handle SIGWINCH (terminal resize)
- [ ] Tests: cell operations, diff algorithm, resize

### Yoga Integration (`render/src/yoga.ts`)
- [ ] Load yoga-wasm-web
- [ ] `createNode()` — create Yoga node with defaults
- [ ] `applyStyle(node, style)` — map CSS-like props to Yoga
- [ ] `computeLayout(root, width, height)` — run layout pass
- [ ] `getComputedLayout(node)` — extract {left, top, width, height}
- [ ] Style mapping: flexDirection, justifyContent, alignItems, flexGrow, padding, margin, border
- [ ] Tests: basic layouts (row, column, nested), edge cases

### Signal System (`render/src/signals.ts`)
- [ ] `signal<T>(initial)` — create reactive signal
- [ ] `computed<T>(fn)` — derived signal (lazy, cached)
- [ ] `effect(fn)` — side-effect on signal change
- [ ] `batch(fn)` — batch multiple writes, single update
- [ ] `untrack(fn)` — read without tracking dependency
- [ ] Auto-dependency tracking via global stack
- [ ] Cycle detection (error on circular dependencies)
- [ ] Tests: basic reactivity, computed caching, batch, cycles

### Base Component (`render/src/component.ts`)
- [ ] `Component` abstract class
- [ ] Yoga node creation/destruction
- [ ] Child management (add, remove, reorder)
- [ ] Dirty marking + propagation
- [ ] Mount/unmount lifecycle
- [ ] `render(area: Rect): Cell[][]` abstract method
- [ ] Tests: lifecycle, dirty propagation

### Reconciler (`render/src/reconciler.ts`)
- [ ] Collect dirty components
- [ ] Run Yoga layout pass
- [ ] Render dirty components into screen buffer
- [ ] Diff + flush
- [ ] requestRender() with RAF-like batching (setTimeout(0))
- [ ] Tests: render cycle, batched updates

### Theme System (`render/src/theme.ts`)
- [ ] `Theme` interface (colors for each semantic role)
- [ ] Default theme (inspired by Catppuccin Mocha)
- [ ] `getTheme()` / `setTheme()` global accessors
- [ ] Semantic roles: primary, secondary, success, warning, error, muted, text, border, background
- [ ] Tests: theme application

---

## Phase 2: Core Components (Week 3-4)

### Box (`render/src/components/box.ts`)
- [ ] Flexbox container mapping to Yoga node
- [ ] Props: flexDirection, justifyContent, alignItems, flexGrow, flexShrink
- [ ] Props: padding, margin, width, height, minWidth, maxWidth
- [ ] Props: overflow (hidden, visible)
- [ ] Border rendering (single, double, rounded, heavy)
- [ ] Background color fill
- [ ] Tests: layout composition, borders, overflow

### Text (`render/src/components/text.ts`)
- [ ] Styled text span
- [ ] Props: content, color, bgColor, bold, dim, italic, underline
- [ ] Word wrapping within parent bounds
- [ ] Truncation with ellipsis
- [ ] Tests: wrapping, truncation, style application

### Input (`render/src/components/input.ts`)
- [ ] Single-line text input with cursor
- [ ] Props: prompt, value, placeholder, onSubmit, onChange
- [ ] Cursor positioning and rendering
- [ ] Character insertion/deletion
- [ ] Cursor movement (left, right, home, end)
- [ ] Word-level movement (ctrl+left, ctrl+right)
- [ ] Line editing (ctrl+u, ctrl+k, ctrl+w)
- [ ] History (up/down arrows)
- [ ] Multiline support (shift+enter)
- [ ] Tests: cursor movement, editing operations, history

### Scroll (`render/src/components/scroll.ts`)
- [ ] Scrollable viewport with virtual rendering
- [ ] Props: scrollTop, onScroll
- [ ] Only render visible region
- [ ] Scroll indicators (arrows or bar)
- [ ] Page up/page down support
- [ ] Smooth scroll (optional)
- [ ] Tests: virtual rendering, scroll boundaries

### List (`render/src/components/list.ts`)
- [ ] Virtual list — renders only visible items
- [ ] Props: items, renderItem, itemHeight
- [ ] Keyboard navigation (up/down/enter)
- [ ] Filtering/search
- [ ] Selection highlight
- [ ] Tests: virtual rendering, navigation, filtering

### Spinner (`render/src/components/spinner.ts`)
- [ ] Animated loading indicator
- [ ] Styles: braille, dots, line, bounce
- [ ] Auto-start/stop based on visibility
- [ ] Tests: frame cycling

### Border (`render/src/components/border.ts`)
- [ ] Box-drawing decorator
- [ ] Styles: single, double, rounded, heavy, dashed
- [ ] Title placement in border
- [ ] Tests: border rendering, title

### Markdown (`render/src/components/markdown.ts`)
- [ ] Parse markdown to AST (lightweight parser, no deps)
- [ ] Render headings (# ## ###) with colors
- [ ] Render bold, italic, strikethrough, inline code
- [ ] Render code blocks with syntax highlighting
- [ ] Render lists (ordered + unordered, nested)
- [ ] Render blockquotes with border
- [ ] Render links (underline + color)
- [ ] Render tables (GFM)
- [ ] Render horizontal rules
- [ ] Word wrapping within parent width
- [ ] Tests: each markdown element, edge cases

### Syntax Highlighter (`render/src/components/syntax.ts`)
- [ ] Token-based regex highlighter
- [ ] Language: TypeScript / JavaScript
- [ ] Language: Python
- [ ] Language: Go
- [ ] Language: Rust
- [ ] Language: Bash / Shell
- [ ] Language: JSON / YAML / TOML
- [ ] Language: HTML / CSS
- [ ] Language: Generic fallback
- [ ] Auto-detect language from fence or heuristics
- [ ] Theme-aware token colors
- [ ] Tests: tokenization per language

### Diff Viewer (`render/src/components/diff.ts`)
- [ ] Unified diff rendering
- [ ] Line numbers (old + new)
- [ ] Color coding (red=removed, green=added, dim=context)
- [ ] Side-by-side mode (Phase 2+)
- [ ] Tests: diff rendering

---

## Phase 3: Agent Loop (Week 4-5)

### LLM Provider (`agent/src/providers/`)
- [ ] `darpana.ts` — HTTP client for Darpana proxy
  - [ ] POST /v1/messages (non-streaming)
  - [ ] POST /v1/messages (streaming via SSE)
  - [ ] Health check (GET /)
  - [ ] Auto-launch darpana if not running
- [ ] `direct.ts` — Direct Anthropic SDK client (fallback)
  - [ ] Streaming support
  - [ ] API key from env var
- [ ] Provider interface: `stream(messages, options) → AsyncIterable<AgentEvent>`
- [ ] Tests: mock provider, event parsing

### Message Builder (`agent/src/message.ts`)
- [ ] Build system prompt (project context + personality)
- [ ] Build user message (with @-reference expansion)
- [ ] Build tool result message
- [ ] Conversation history management
- [ ] Tests: message construction

### Agent Loop (`agent/src/loop.ts`)
- [ ] Core loop: send → stream → accumulate → tool use → repeat
- [ ] Yield `AgentEvent` for each stream event
- [ ] Handle stop reasons: end_turn, tool_use, max_tokens
- [ ] Handle errors: API errors, network errors, timeout
- [ ] Support cancellation via AbortSignal
- [ ] Tests: mock loop with canned responses

### Stream Parser (`agent/src/stream.ts`)
- [ ] Parse SSE events from Anthropic format
- [ ] Map to AgentEvent types
- [ ] Handle: message_start, content_block_start, content_block_delta, content_block_stop, message_delta, message_stop
- [ ] Handle thinking blocks
- [ ] Tests: SSE parsing, event mapping

### Tool Registry (`agent/src/tools/registry.ts`)
- [ ] Register/unregister tools
- [ ] Dispatch tool calls by name
- [ ] Generate tool definitions for LLM (JSON Schema)
- [ ] Timeout per tool (default 120s)
- [ ] Tests: registration, dispatch

### Built-in Tools
- [ ] `Read` — Read file contents with line numbers
- [ ] `Write` — Create/overwrite file
- [ ] `Edit` — Search & replace in file
- [ ] `Bash` — Execute shell command (sandboxed)
- [ ] `Glob` — Find files by pattern
- [ ] `Grep` — Search file contents by regex
- [ ] `Ask` — Ask user a question
- [ ] Tests: each tool with fixtures

### Command Sandbox (`agent/src/safety/sandbox.ts`)
- [ ] Safe command allowlist
- [ ] Dangerous character detection
- [ ] Dangerous command blocklist
- [ ] Timeout enforcement
- [ ] Process kill on cancel
- [ ] Tests: allowlist, rejection, timeout

### Context Management (`agent/src/context/`)
- [ ] `builder.ts` — System prompt construction
- [ ] `project.ts` — Detect project type, load CLAUDE.md / TAKUMI.md
- [ ] `compact.ts` — Summarize old turns when context >80%
- [ ] Token counting (estimate: 4 chars ≈ 1 token)
- [ ] Tests: prompt construction, compaction

---

## Phase 4: TUI Application (Week 5-7)

### App Shell (`tui/src/app.ts`)
- [ ] Root layout: header + main + input + status
- [ ] Main area: message list + sidebar (split pane)
- [ ] Terminal resize handling
- [ ] Focus management between panels
- [ ] Global keyboard shortcuts
- [ ] Tests: layout composition

### Message List (`tui/src/panels/message-list.ts`)
- [ ] Scrollable list of messages
- [ ] User message rendering (blue border)
- [ ] Assistant message rendering (markdown)
- [ ] Thinking block rendering (collapsible, dimmed)
- [ ] Tool call rendering (expandable, with args + result)
- [ ] Streaming: incremental text append
- [ ] Auto-scroll on new content
- [ ] Render caching (only re-render changed messages)
- [ ] Tests: message formatting, scroll behavior

### Editor Panel (`tui/src/panels/editor.ts`)
- [ ] Multiline input editor
- [ ] Prompt display (匠>)
- [ ] @-reference expansion (trigger file picker)
- [ ] /-command trigger (trigger command palette)
- [ ] !-command trigger (shell mode)
- [ ] Submit on Enter (empty line or Ctrl+Enter for multiline)
- [ ] Input history
- [ ] Tests: input modes, submission

### Status Bar (`tui/src/panels/status-bar.ts`)
- [ ] Model name display
- [ ] Token count (input/output)
- [ ] Cost display
- [ ] Context usage % (with warning colors)
- [ ] Git branch display
- [ ] Chitragupta health indicator
- [ ] Tests: status formatting

### Header Bar (`tui/src/panels/header.ts`)
- [ ] Logo + project name
- [ ] Current model
- [ ] Session ID (if resumed)
- [ ] Git branch + dirty indicator
- [ ] Tests: header rendering

### Sidebar (`tui/src/panels/sidebar.ts`)
- [ ] Modified files list
- [ ] Session info (turns, tokens, cost)
- [ ] Chitragupta memory hints
- [ ] Toggle visibility (Ctrl+B)
- [ ] Tests: sidebar content

### Tool Output Panel (`tui/src/panels/tool-output.ts`)
- [ ] Tool call header (name, args summary)
- [ ] Expandable/collapsible (Enter to toggle)
- [ ] Status indicator (running spinner, done checkmark, error X)
- [ ] Duration display
- [ ] Result content (truncated if long)
- [ ] Diff rendering for Edit tool
- [ ] Tests: tool display states

### Dialogs
- [ ] Command palette (`tui/src/dialogs/command-palette.ts`)
  - [ ] Fuzzy search over slash commands
  - [ ] Keyboard navigation
  - [ ] Ctrl+K to open/close
- [ ] Model picker (`tui/src/dialogs/model-picker.ts`)
  - [ ] List available models from Darpana
  - [ ] Current model highlighted
- [ ] Permission dialog (`tui/src/dialogs/permission.ts`)
  - [ ] Tool name + args display
  - [ ] y/a/n options
  - [ ] Auto-dismiss on response
- [ ] Session list (`tui/src/dialogs/session-list.ts`)
  - [ ] Recent sessions from Chitragupta
  - [ ] Resume selection
- [ ] File picker (`tui/src/dialogs/file-picker.ts`)
  - [ ] Fuzzy file search
  - [ ] Preview on hover (Phase 2)
- [ ] Tests: each dialog interaction

### Formatters
- [ ] Message formatter (user/assistant/system)
- [ ] Tool call formatter (name, args, result, duration)
- [ ] Thinking block formatter (collapsible, dimmed)
- [ ] Error formatter (red, with stack trace option)
- [ ] Tests: formatting edge cases

### Slash Commands (`tui/src/commands.ts`)
- [ ] Command registry
- [ ] `/model` — switch model
- [ ] `/clear` — clear conversation
- [ ] `/compact` — compact context
- [ ] `/session` — session management
- [ ] `/diff` — show file changes
- [ ] `/status` — show status info
- [ ] `/cost` — show token/cost breakdown
- [ ] `/help` — show help
- [ ] `/quit` — exit
- [ ] `/theme` — switch theme (Phase 2)
- [ ] `/undo` — undo last file change
- [ ] `/memory` — search chitragupta memory
- [ ] `/permission` — manage permissions
- [ ] Tab completion for commands
- [ ] Tests: command execution

### Key Bindings (`tui/src/keybinds.ts`)
- [ ] Global binding registry
- [ ] Ctrl+K — command palette
- [ ] Ctrl+C — cancel/clear
- [ ] Ctrl+D — exit (on empty input)
- [ ] Ctrl+L — clear screen
- [ ] Ctrl+B — toggle sidebar
- [ ] Ctrl+O — session list
- [ ] Ctrl+? — help
- [ ] Customizable via config
- [ ] Tests: binding dispatch

---

## Phase 5: Bridge & Integration (Week 7-8)

### Chitragupta Bridge (`bridge/src/chitragupta.ts`)
- [ ] Spawn chitragupta-mcp as child process (stdio)
- [ ] JSON-RPC message framing
- [ ] Tool call: `chitragupta_memory_search`
- [ ] Tool call: `chitragupta_session_list`
- [ ] Tool call: `chitragupta_session_show`
- [ ] Tool call: `chitragupta_handover`
- [ ] Tool call: `akasha_traces`
- [ ] Tool call: `akasha_deposit`
- [ ] Tool call: `vasana_tendencies`
- [ ] Tool call: `health_status`
- [ ] Reconnection on crash
- [ ] Tests: mock MCP server, message framing

### Darpana Bridge (`bridge/src/darpana.ts`)
- [ ] HTTP health check
- [ ] Auto-launch if not running
- [ ] Model list discovery
- [ ] Connection error handling
- [ ] Tests: mock HTTP server

### Git Bridge (`bridge/src/git.ts`)
- [ ] `gitStatus()` — current status
- [ ] `gitBranch()` — current branch
- [ ] `gitDiff()` — staged + unstaged diff
- [ ] `gitLog(n)` — recent commits
- [ ] `gitStash()` / `gitStashPop()` — checkpoint management
- [ ] Tests: git operations with temp repo

---

## Phase 6: CLI & Polish (Week 8-9)

### CLI Entry (`bin/takumi.ts`)
- [ ] Argument parsing (--model, --resume, --config, --port, --version, --help)
- [ ] Config resolution (CLI > env > file > defaults)
- [ ] Startup sequence: config → bridge init → TUI launch
- [ ] Non-interactive mode (--print flag, pipe-friendly)
- [ ] Prompt mode: `takumi "do something"` (one-shot)
- [ ] Tests: arg parsing, startup

### Soul / Personality
- [ ] `soul/personality.md` — tone, style, behavior
- [ ] `soul/preferences.md` — user preferences (coding style, language, tools)
- [ ] `soul/identity.md` — who the assistant is
- [ ] Loader: reads soul/ dir, injects into system prompt
- [ ] Tests: soul loading

### Polish
- [ ] Graceful error handling (no stack traces to user)
- [ ] Graceful shutdown (Ctrl+C cleanup)
- [ ] Terminal state restoration on exit (cursor, raw mode, alternate screen)
- [ ] SIGWINCH handling (resize without crash)
- [ ] SIGTERM / SIGINT handling
- [ ] Log rotation (~/.takumi/logs/)
- [ ] First-run experience (auto-detect project, suggest config)

---

## Phase 7: Advanced Features (Week 9+)

### Mouse Support
- [ ] Enable mouse reporting (SGR mode)
- [ ] Click to focus panel
- [ ] Click to select message
- [ ] Scroll wheel for viewport scrolling
- [ ] Click to expand/collapse tool output

### Multiple Themes
- [ ] Catppuccin Mocha (default)
- [ ] Catppuccin Latte (light)
- [ ] Dracula
- [ ] Tokyo Night
- [ ] One Dark
- [ ] Gruvbox
- [ ] Theme hot-reload via `/theme` command

### Advanced Editor
- [ ] Multi-cursor (Phase 3)
- [ ] Bracket matching
- [ ] Auto-indent
- [ ] Clipboard integration (OSC 52)
- [ ] Vim keybindings mode

### Session Management
- [ ] Session fork (branch from any point)
- [ ] Session export (markdown)
- [ ] Session share (URL via chitragupta)
- [ ] Session timeline navigation

### Coding Agent Mode
- [ ] `/code` command — dedicated coding workflow
- [ ] Plan → Branch → Execute → Validate → Review → Commit pipeline
- [ ] Progress bar through phases
- [ ] Diff preview before commit
- [ ] Approval prompts at critical points

### Smart Routing (via Chitragupta)
- [ ] Task classification (coding/chat/research/debug)
- [ ] Model selection based on task type
- [ ] Cost optimization (cheap model first, escalate)
- [ ] Provider fallback chain
- [ ] Usage tracking + reporting

---

## Test Coverage Targets

| Package | Target | Focus |
|---------|--------|-------|
| `@takumi/core` | 95% | Config, types, errors |
| `@takumi/render` | 90% | Layout, signals, components |
| `@takumi/agent` | 85% | Tool execution, streaming, sandboxing |
| `@takumi/tui` | 75% | Panel rendering, key handling |
| `@takumi/bridge` | 85% | MCP protocol, git operations |

---

## Milestones

| Milestone | Target | Definition of Done |
|-----------|--------|-------------------|
| **M0: Scaffold** | Week 1 | All packages created, builds pass, empty tests run |
| **M1: Hello Screen** | Week 3 | Kagami renders a Box with Text, resizes correctly |
| **M2: Chat Works** | Week 5 | Type message → LLM responds → displayed with markdown |
| **M3: Tools Work** | Week 6 | Agent can read/write/edit files with permission prompts |
| **M4: Production MVP** | Week 8 | Full TUI with sidebar, status, sessions, slash commands |
| **M5: Polish** | Week 9 | Themes, mouse, advanced editor, coding agent mode |
