# Keybindings — Takumi (匠)

> Complete reference for keyboard shortcuts, slash commands, and
> input modes.

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
| `/session` | Session management (`list`, `show <id>`, `resume <id>`) | `Ctrl+O` | |
| `/diff` | Show git diff | | |
| `/cost` | Show token costs breakdown | | |
| `/sidebar` | Toggle sidebar | `Ctrl+B` | |
| `/undo` | Undo last file change | | |
| `/permission` | Manage tool permissions (`list`, `reset`) | | |
| `/think` | Toggle extended thinking (budget in tokens) | | |

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
