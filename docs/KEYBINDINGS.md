<p align="center">
	<img src="./logo.svg" alt="Takumi logo" width="160" />
</p>

# Keybindings — Takumi (匠)

> Current reference for keyboard shortcuts, slash commands, and input modes on `main`.

## Global Keybindings

These work from any view or input mode.

| Shortcut | Action | Notes |
|----------|--------|-------|
| `Ctrl+Q` | Quit | Exit Takumi |
| `Ctrl+C` | Cancel / Quit | Cancels active agent run, or quits if idle |
| `Ctrl+D` | Exit | Quits if editor is empty |
| `Ctrl+L` | Clear screen | Invalidates screen and forces full re-render |
| `Ctrl+P` | Command palette | Toggle fuzzy command search |
| `Ctrl+K` | Command palette | Alias for Ctrl+P |
| `Ctrl+M` | Model picker | Toggle model selection dialog |
| `Ctrl+B` | Toggle sidebar | Show/hide the sidebar panel |
| `Ctrl+O` | Session list | Open session browser |
| `Ctrl+Shift+C` | Cluster status | Toggle cluster status panel |

## Input Modes

### Normal Mode

The default mode when the editor is focused.

| Key | Action |
|-----|--------|
| `Enter` | Submit message to agent |
| `Shift+Enter` | Insert newline (multiline editing) |
| `/` | Enter slash command mode |
| `@` | Enter file reference mode |
| `!` | Enter shell command mode |
| `Tab` | Autocomplete |
| `Esc` | Close dialog / cancel |

### Editor Keys

Standard text editing keys in the input editor.

| Key | Action |
|-----|--------|
| `←` / `→` | Move cursor left / right |
| `↑` / `↓` | Cycle input history |
| `Home` / `Ctrl+A` | Move to start of line |
| `End` / `Ctrl+E` | Move to end of line |
| `Ctrl+←` / `Ctrl+→` | Move by word |
| `Ctrl+W` | Delete word backward |
| `Ctrl+U` | Delete to start of line |
| `Ctrl+K` | Delete to end of line |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Backspace` | Delete character backward |
| `Delete` | Delete character forward |

### Slash Command Mode

Entered by typing `/` at the start of input.

| Key | Action |
|-----|--------|
| `Tab` | Cycle completions |
| `Enter` | Execute command |
| `Esc` | Back to normal mode |

### File Reference Mode

Entered by typing `@` in the input.

| Key | Action |
|-----|--------|
| `Tab` | Accept completion |
| `Enter` | Insert file reference |
| `Esc` | Cancel |

### Dialog Mode

Active when a dialog (command palette, model picker, etc.) is open.

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate options |
| `Enter` | Select / confirm |
| `Esc` | Dismiss dialog |
| Type | Filter / search |

### Permission Dialog

Shown when a tool requires user approval.

| Key | Action |
|-----|--------|
| `y` / `Enter` | Allow once |
| `a` | Allow for this session |
| `n` / `Esc` | Deny |

## View-Specific Keys

### Code View

Two-pane view: file list (left) and diff content (right).

| Key | Action | Pane |
|-----|--------|------|
| `Tab` | Toggle focus between list and diff | Both |
| `↑` / `k` | Previous item / scroll up | Both |
| `↓` / `j` | Next item / scroll down | Both |
| `Enter` | Focus diff pane for selected file | List |
| `PgUp` | Page up | Diff |
| `PgDn` | Page down | Diff |

### Logs View

Scrollable log viewer with level filtering.

| Key | Action |
|-----|--------|
| `↑` / `k` | Scroll up |
| `↓` / `j` | Scroll down |
| `PgUp` | Page up |
| `PgDn` | Page down |
| `l` | Cycle log level filter (debug → info → warn → error) |
| `g` | Scroll to top |
| `G` / `Shift+G` | Scroll to bottom (re-enable autoscroll) |

### Model Picker

| Key | Action |
|-----|--------|
| `↑` | Previous model |
| `↓` | Next model |
| `Enter` | Select model |
| `Esc` | Close picker |

## Slash Commands

Type `/` at the start of input to activate. Tab completes partial matches.

| Command | Description | Shortcut | Aliases |
|---------|-------------|----------|---------|
| `/quit` | Exit Takumi | `Ctrl+Q` | `/exit` |
| `/clear` | Clear conversation | `Ctrl+L` | |
| `/model` | Change model (tab for autocomplete) | `Ctrl+M` | |
| `/provider` | Switch AI provider (tab for autocomplete) | | |
| `/theme` | Change theme | | |
| `/help` | Show help | | |
| `/status` | Show session statistics | | |
| `/compact` | Trigger conversation compaction | | |
| `/session` | Local sessions plus Chitragupta-backed `dates`, `projects`, and `delete` operations | `Ctrl+O` | |
| `/diff` | Show git diff | | |
| `/cost` | Show token costs breakdown | | |
| `/sidebar` | Toggle sidebar | `Ctrl+B` | |
| `/undo` | Undo last file change | | |
| `/permission` | Manage tool permissions (`list`, `reset`) | | |
| `/think` | Toggle extended thinking (budget in tokens) | | |
| `/memory` | Search project memory, or `/memory scopes` | | |
| `/sessions` | List Chitragupta sessions | | |
| `/code` | Start coding agent | | |
| `/export` | Export the current conversation | | |
| `/retry` | Retry the last response | | |
| `/cluster` | Show cluster status | `Ctrl+Shift+C` | |
| `/validate` | Re-run cluster validation | | |
| `/checkpoint` | List or save checkpoints | | |
| `/resume` | Resume a cluster from checkpoint | | |
| `/isolation` | Get or set isolation mode | | |
| `/day` | Day-file browsing and search | | |
| `/vidhi` | Learned procedure listing and matching | | |
| `/consolidate` | Run Chitragupta consolidation | | |
| `/facts` | Extract structured facts | | |
| `/csession` | Create a Chitragupta session | | |
| `/daemon` | Show daemon status | | |
| `/turns` | List turns for a session | | |
| `/track` | Track the latest turn to Chitragupta | | |
| `/predict` | Show predicted next moves | | |
| `/patterns` | Show detected behavioral patterns | | |
| `/healthx` | Extended health from Chitragupta | | |
| `/capabilities` | List control-plane capabilities | | |
| `/route` | Show recent routing decisions | | |
| `/healthcaps` | Show capability health snapshots | | |
| `/integrity` | Show Scarlett integrity report | | `/scarlett` |
| `/branch` | Branch the current session | | `/br` |
| `/session-tree` | Show the session tree | | `/branches` |
| `/switch` | Switch to a session by ID | | `/sw` |
| `/siblings` | Show sibling session branches | | `/sib` |
| `/parent` | Navigate to the parent session | | `/up` |
| `/steer` | Queue a normal-priority directive | | `/st` |
| `/interrupt` | Queue a highest-priority directive | | `/int` |
| `/steerq` | Inspect the steering queue | | `/sq` |

### Notes

- `/tree` is the filesystem tree command.
- `/session-tree` is the conversation/session tree command.
- `/help` always shows the live registered command list from the running app and should win over stale memory.

## Special Prefixes

| Prefix | Mode | Example |
|--------|------|---------|
| `/` | Slash command | `/model opus` |
| `@` | File reference | `@src/app.ts` |
| `@...#L-L` | Line range reference | `@src/app.ts#10-20` |
| `@dir/` | Directory listing | `@src/` |
| `!` | Shell command | `!git status` |

## Mouse Support

| Action | Effect |
|--------|--------|
| Scroll wheel | Scroll message list (3 lines per tick) |
| Click (main area) | Focus input panel |
| Click (sidebar) | Focus sidebar panel |
