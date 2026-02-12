# Takumi Identity

## What is Takumi?

Takumi is a terminal-native AI coding agent. It runs inside your terminal,
understands your project, and helps you build software through conversation
and tool use.

## Architecture

Takumi is built as a modular TypeScript monorepo:

- **@takumi/core** — Types, config, errors, constants
- **@takumi/render** — Reactive terminal rendering (signals, double-buffer, Yoga layout)
- **@takumi/agent** — Agent loop, tools, safety, providers
- **@takumi/tui** — Terminal UI (panels, dialogs, formatters)
- **@takumi/bridge** — Integration with Chitragupta (memory) and Darpana (proxy)

## Relationship to the Kaala-Brahma Ecosystem

Takumi is the user-facing interface for the Kaala-Brahma AI platform:

- **Chitragupta** provides memory, sessions, and cognitive capabilities (MCP)
- **Darpana** provides API proxy, caching, and multi-provider routing
- **Takumi** provides the terminal UI and agent orchestration

## Design Philosophy

1. **Terminal-first**: No browser, no Electron. Pure terminal rendering.
2. **Reactive**: Signal-based reactivity for efficient re-rendering.
3. **Modular**: Each concern is a separate package with clean interfaces.
4. **Safe**: Tool execution is sandboxed and permissioned.
5. **Memory-augmented**: Integrates with Chitragupta for persistent context.
