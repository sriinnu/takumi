export function printHelp(version: string): void {
	console.log(`
Takumi v${version} — Terminal UI for AI coding agents

Usage:
  takumi [options] [prompt...]        Interactive TUI (default)
  takumi "analyze this file"          One-shot mode
  takumi exec "fix the login bug"     Headless run for automation
  takumi --print "summarize code"     Non-interactive, stdout output
  cat file.ts | takumi "review this"  Piped input

Subcommands:
  takumi exec <prompt...>      Run the agent headlessly for scripts/IPC
  takumi list                List saved sessions
  takumi status <id>         Show session metadata and token usage
  takumi logs <id>           Print full conversation log (colour-coded)
  takumi export <id>         Export session as Markdown to stdout
  takumi delete <id>         Delete a saved session
  takumi jobs                List detached background jobs
  takumi watch [job-id]      Live monitor detached jobs (or one specific job)
  takumi attach <job-id>     Attach to a detached job log stream
  takumi stop <job-id>       Stop a detached background job
  takumi daemon [action]     Manage the chitragupta daemon (start|stop|status|restart|logs)
  takumi doctor              Show CLI/platform readiness diagnostics
  takumi platform [watch]    Show or live-monitor the local platform surface
  takumi init [action]       Create or inspect project TAKUMI.md instructions
  takumi config [action]     Create, inspect, or reveal Takumi config files
  takumi package <action>    Manage Takumi workflow packages (list|inspect|doctor|scaffold)
  takumi side-agents <action> Inspect or repair the persisted side-agent registry
  takumi ide [action]        Inspect IDE launchers or open the current project (status|open)
  takumi keybindings [path]  Create or reveal the user keybindings config

Options:
  -h, --help                Show this help message
  -v, --version             Show version number
  -m, --model <model>       AI model to use (default: claude-sonnet-4-20250514)
  -P, --provider <name>     Provider name (see below)
  --api-key <key>           API key (overrides environment)
  --endpoint <url>          Custom API endpoint URL
  --json                    Emit JSON for machine-readable operational commands
  --fix                     Apply safe automatic remediation where supported
  --startup-trace           Print an opt-in startup phase trace for CLI profiling
  -t, --thinking            Enable extended thinking
  --thinking-budget <n>     Thinking token budget (default: 10000)
  -p, --proxy <url>         Darpana proxy URL
  --print                   Non-interactive mode: stream output to stdout
  --headless                Force non-TUI execution (useful with exec/spawn)
  --stream <format>         Output format for headless runs: text or ndjson
  --theme <name>            UI theme (default: default)
  --log-level <level>       Log level: debug, info, warn, error, silent
  -C, --cwd <dir>           Working directory
  -r, --resume <id>         Resume a previous session by ID
  --fallback <provider>     Fallback provider on primary failure
  --pr                      Auto-create a GitHub PR when task completes
  --ship                    Auto-create + auto-merge PR when task completes
  -d, --detach              Run agent in background (detached process)
  -i, --issue <url|#n>      Pre-fetch GitHub issue body as task context

Providers:
  anthropic (default)    Direct Anthropic API
  openai                 OpenAI (GPT-4.1, etc.)
  gemini                 Google Gemini
  github                 GitHub Models (free — uses gh auth token)
  groq                   Groq (fast inference)
  xai                    xAI / Grok-compatible endpoints
  deepseek               DeepSeek
  mistral                Mistral AI
  together               Together AI
  openrouter             OpenRouter (multi-provider)
  alibaba                Alibaba / DashScope-compatible endpoints
  bedrock                Bedrock-compatible gateway endpoints
  zai                    Z.AI / GLM (OpenAI-compatible)
  moonshot               Moonshot AI / Kimi (OpenAI-compatible)
  minimax                MiniMax (OpenAI-compatible)
  ollama                 Local Ollama (no key needed)

Authentication (priority order):
  1. Direct credentials:       provider API keys from env/config or pinned TAKUMI_API_KEY
  2. Local auth files:         Claude config API key, Codex API-key auth, Gemini CLI .env
  3. GitHub CLI / Copilot:     gh auth token or Copilot OAuth for GitHub Models
  4. Ollama local server:      localhost:11434 (auto-detected)

Examples:
  gh auth login                                  # Authenticate with GitHub CLI
  ANTHROPIC_API_KEY=... pnpm takumi              # Direct Anthropic API
  OPENAI_API_KEY=... pnpm takumi --provider openai --model gpt-4.1
  ZAI_API_KEY=... pnpm takumi --provider zai --model glm-4.7-flash
  MOONSHOT_API_KEY=... pnpm takumi --provider moonshot --model kimi-k2.5
  MINIMAX_API_KEY=... pnpm takumi --provider minimax --model MiniMax-M2.7
  pnpm takumi exec --headless --stream=ndjson "Fix auth router"
                                              # emits takumi.exec.v1 envelopes + bootstrap status
  pnpm takumi "Fix tests" -d                    # Run in background
  pnpm takumi jobs                               # Show detached jobs
  pnpm takumi watch                              # Live monitor jobs
  pnpm takumi attach job-k3j4x1                 # Stream job logs
  pnpm takumi stop job-k3j4x1                   # Stop detached job
  pnpm takumi doctor                            # Check auth, daemon, telemetry, and jobs
  pnpm takumi doctor --json                     # Same report, machine-readable
  pnpm takumi doctor --fix                      # Start safe remediations like the daemon
  pnpm takumi platform                          # Roll up doctor, jobs, daemon, and sessions
  pnpm takumi platform --json                   # Platform summary as structured JSON
  pnpm takumi platform watch                    # Live dashboard with single-keystroke controls
  pnpm takumi init                              # Create and open TAKUMI.md in the project root
  pnpm takumi init show                         # Show instruction-file search order and the active file
  pnpm takumi config                            # Open the active Takumi config (or create the global one)
  pnpm takumi config show                       # Show config search order and the active file
  pnpm takumi config project                    # Create or reveal a project-local .takumi/config.json
  pnpm takumi side-agents inspect              # Inspect persisted side-agent registry health
  pnpm takumi side-agents repair               # Explicitly rewrite malformed registry state
  pnpm takumi ide                               # Show detected IDE launchers for this project
  pnpm takumi ide open cursor                   # Open the repo in Cursor
  pnpm takumi keybindings                      # Create and reveal the keybindings config
  pnpm takumi keybindings path                 # Print the keybindings config path only
  pnpm takumi package list                      # Show discovered Takumi packages
  pnpm takumi package inspect review-kit        # Inspect one package in detail
  pnpm takumi package doctor                    # Validate package inventory and warnings
  pnpm takumi package scaffold review-kit       # Create a local package skeleton
  pnpm takumi jobs --json                       # Script-friendly job inventory
  pnpm takumi status <id> --json                # Session metadata as JSON

Platform watch keys:
  q / Esc / Ctrl+C        Quit watch mode
  r                       Refresh immediately
  R                       Hard refresh and clear transient errors
  f                       Apply safe fixes and refresh
  d                       Toggle doctor details
  s                       Toggle sessions section
  j                       Toggle detached jobs section
  1 / 2 / 3               Focus doctor / sessions / jobs
  Tab                     Cycle focus
  Space                   Toggle the focused section
  p                       Pause or resume auto-refresh
  g / G                   Jump focus to first / last section
  ? / h                   Toggle key help
`);
}
