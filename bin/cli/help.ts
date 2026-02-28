export function printHelp(version: string): void {
	console.log(`
Takumi v${version} — Terminal UI for AI coding agents

Usage:
  takumi [options] [prompt...]        Interactive TUI (default)
  takumi "analyze this file"          One-shot mode
  takumi --print "summarize code"     Non-interactive, stdout output
  cat file.ts | takumi "review this"  Piped input

Subcommands:
  takumi list                List saved sessions
  takumi status <id>         Show session metadata and token usage
  takumi logs <id>           Print full conversation log (colour-coded)
  takumi export <id>         Export session as Markdown to stdout
  takumi delete <id>         Delete a saved session
  takumi jobs                List detached background jobs
  takumi watch [job-id]      Live monitor detached jobs (or one specific job)
  takumi attach <job-id>     Attach to a detached job log stream
  takumi stop <job-id>       Stop a detached background job

Options:
  -h, --help                Show this help message
  -v, --version             Show version number
  -m, --model <model>       AI model to use (default: claude-sonnet-4-20250514)
  -P, --provider <name>     Provider name (see below)
  --api-key <key>           API key (overrides environment)
  --endpoint <url>          Custom API endpoint URL
  -t, --thinking            Enable extended thinking
  --thinking-budget <n>     Thinking token budget (default: 10000)
  -p, --proxy <url>         Darpana proxy URL
  --print                   Non-interactive mode: stream output to stdout
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
  deepseek               DeepSeek
  mistral                Mistral AI
  together               Together AI
  openrouter             OpenRouter (multi-provider)
  ollama                 Local Ollama (no key needed)

Examples:
  ANTHROPIC_API_KEY=... pnpm takumi
  OPENAI_API_KEY=... pnpm takumi --provider openai --model gpt-4.1
  pnpm takumi "Fix tests" -d                    # Run in background
  pnpm takumi jobs                               # Show detached jobs
  pnpm takumi watch                              # Live monitor jobs
  pnpm takumi attach job-k3j4x1                 # Stream job logs
  pnpm takumi stop job-k3j4x1                   # Stop detached job
`);
}
