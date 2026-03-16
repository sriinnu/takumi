# Installing Takumi

## Prerequisites

| Requirement  | Minimum | Why |
|-------------|---------|-----|
| **Node.js** | 22.0+   | ES2024 target, native `fetch`, stable `node:test` |
| **pnpm**    | 9.0+    | Workspace protocol, lockfile v9 |
| **Git**     | 2.30+   | Worktree for side-agent isolation |
| **tmux**    | 3.0+    | Side-agent terminal windows *(optional on Windows — falls back to ProcessOrchestrator)* |

---

## Platform Matrix

| Platform           | CLI | Desktop (web) | Side Agents | Notes |
|-------------------|-----|---------------|-------------|-------|
| **macOS (arm64)**  | ✅  | ✅            | ✅ tmux     | Primary dev platform |
| **macOS (x64)**    | ✅  | ✅            | ✅ tmux     |  |
| **Linux (x64)**    | ✅  | ✅            | ✅ tmux     |  |
| **Linux (arm64)**  | ✅  | ✅            | ✅ tmux     |  |
| **Windows (WSL2)** | ✅  | ✅            | ✅ tmux     | Recommended Windows path |
| **Windows (native)** | ✅ | ✅           | ⚠️ process  | No tmux; uses ProcessOrchestrator fallback |

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/YugenLab/takumi.git
cd takumi
pnpm install
```

### 2. Build

```bash
pnpm build    # TypeScript compilation for all packages
pnpm bundle   # esbuild → dist/takumi.cjs (single-file CLI bundle)
```

### 3. Run from Source

```bash
pnpm takumi                          # Interactive TUI mode
pnpm takumi exec "explain this repo" # One-shot mode
```

### 4. Run the Bundle

```bash
node dist/takumi.cjs                          # Interactive
node dist/takumi.cjs exec "explain this repo" # One-shot
```

### 5. Link Globally (optional)

```bash
pnpm link --global
takumi                    # Now available system-wide
```

---

## macOS Setup

```bash
# Install prerequisites
brew install node@22 pnpm git tmux

# Clone & build
git clone https://github.com/YugenLab/takumi.git && cd takumi
pnpm install && pnpm build
```

## Linux Setup

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs tmux git
npm install -g pnpm

# Clone & build
git clone https://github.com/YugenLab/takumi.git && cd takumi
pnpm install && pnpm build
```

## Windows Setup

### Recommended: WSL2

```powershell
# Enable WSL2 (PowerShell as Admin)
wsl --install -d Ubuntu

# Inside WSL2 — follow the Linux instructions above
```

### Native Windows

```powershell
# Install Node.js 22+ from https://nodejs.org
# Install pnpm
npm install -g pnpm

# Clone & build (PowerShell or Git Bash)
git clone https://github.com/YugenLab/takumi.git
cd takumi
pnpm install
pnpm build
```

> **Note**: Native Windows does not have tmux. The side-agent cluster
> automatically falls back to `ProcessOrchestrator`, which uses Node.js
> `child_process` for agent isolation. For the full tmux experience, use WSL2.

---

## Authentication

Takumi needs an API key for at least one LLM provider. Set one of:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."        # Claude (default)
export OPENAI_API_KEY="sk-..."               # OpenAI / GPT
export GOOGLE_GENERATIVE_AI_API_KEY="AI..."  # Gemini
```

Run `takumi doctor` to verify your setup:

```bash
pnpm takumi doctor
```

---

## Desktop UI (Development)

The desktop UI is a Vite + React 19 SPA that connects to the HTTP bridge:

```bash
# Terminal 1: Start the agent with HTTP bridge
pnpm takumi

# Terminal 2: Start the desktop dev server
cd apps/desktop
pnpm dev        # Opens at http://localhost:5173
```

---

## Configuration

Takumi looks for config in platform-specific directories:

| Platform | Config Dir | Cache Dir |
|----------|-----------|-----------|
| macOS    | `~/Library/Application Support/takumi` | `~/Library/Caches/takumi` |
| Linux    | `~/.config/takumi` | `~/.cache/takumi` |
| Windows  | `%APPDATA%\takumi` | `%LOCALAPPDATA%\takumi` |

Override with environment variables:

```bash
export TAKUMI_CONFIG_DIR="/custom/config/path"
export TAKUMI_CACHE_DIR="/custom/cache/path"
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `pnpm: command not found` | `npm install -g pnpm` |
| `node: unsupported engine` | Install Node.js 22+ |
| `tmux: command not found` | Install tmux or use `--no-tmux` flag (ProcessOrchestrator fallback is automatic) |
| Build fails with ESM errors | Ensure `"type": "module"` in all package.json files (already set) |
| Tests fail on Windows | Run in WSL2 for full compatibility |

### Doctor Command

```bash
pnpm takumi doctor
```

Checks: Node version, pnpm, Git, tmux, API keys, config dirs.
