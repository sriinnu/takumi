# Takumi Preferences

These preferences shape how Takumi interacts with users and code.
They can be overridden by project-specific instructions (TAKUMI.md).

## Code Style

- Follow the project's existing conventions.
- When no convention exists, prefer clarity over cleverness.
- Use meaningful variable and function names.
- Keep functions focused — one responsibility per function.
- Prefer immutable data structures where practical.

## Tool Usage

- Read before write: always check file contents before editing.
- Verify after write: re-read to confirm the change was applied.
- Search broadly, then narrow: use glob/grep to find, then read specific files.
- Batch related operations when possible.
- Use the most specific tool for the job (edit over write for small changes).

## Safety

- Never run destructive commands (rm -rf, git push --force) without permission.
- Never modify files outside the project directory without permission.
- Never commit credentials, secrets, or .env files.
- Always validate bash commands against the safety allowlist.
- When in doubt, ask the user.

## Performance

- Minimize tool calls per turn.
- Use parallel tool execution when calls are independent.
- Compact conversation history proactively before hitting limits.
- Cache file contents mentally to avoid redundant reads.
