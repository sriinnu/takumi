# Chitragupta → Takumi Exec Handoff

This document is the implementation handoff for treating Takumi as a spawned
local-process executor inside the Option C+ ecosystem.

Takumi now also ships a parent-side reference runner in `@takumi/bridge`:

- `runTakumiExec(request, options)`
- `TakumiExecTransportError`
- `isTakumiExecTerminalEvent(event)`

## Goal

When Chitragupta routes a coding task to `adapter.takumi.executor`, it should
spawn Takumi as a child process, parse its NDJSON stream, and treat stderr as
diagnostic only.

## Discovery order

1. `TAKUMI_EXEC_BIN`
2. `takumi` on `$PATH`

## Spawn contract

### Request shape

```ts
interface TakumiExecRequest {
	prompt: string;
	cwd: string;
	issue?: string;
	provider?: string;
	model?: string;
	fallbackProvider?: string;
	chitraguptaSocketPath?: string;
}
```

### Process shape

```text
command: $TAKUMI_EXEC_BIN || "takumi"
args:    ["exec", "--headless", "--stream=ndjson", <prompt>, ...optional flags]
cwd:     request.cwd
env:     CHITRAGUPTA_PROJECT=request.cwd
         CHITRAGUPTA_SOCKET=request.chitraguptaSocketPath (optional)
stdout:  takumi.exec.v1 NDJSON envelopes only
stderr:  human-readable diagnostics only
timeout: 120000ms default
```

## Output contract

Takumi stdout must be parsed line-by-line as NDJSON.

Expected envelope kinds:

1. `run_started`
2. `bootstrap_status`
3. zero or more `agent_event`
4. exactly one terminal envelope:
   - `run_completed`, or
   - `run_failed`

If stdout ends without a terminal envelope, parent should classify that as a
transport failure, not a successful run.

## Exit code handling

Published contract:

- `0` — success
- `1` — fatal/internal failure
- `2` — agent-loop failure
- `64` — usage failure
- `78` — config/auth failure

Recommended parent policy:

- retry transport failures only
- do not blindly retry `64` or `78`
- surface `2` as executor failure with preserved stderr and `run_failed.phase`

## Suggested parent loop

```ts
import { runTakumiExec } from "@takumi/bridge";

const result = await runTakumiExec(
	{
		prompt: "Fix the auth router and validate tests",
		cwd: "/repo/takumi",
		chitraguptaSocketPath: "/tmp/chitragupta.sock",
	},
	{
		onEvent: (event) => forwardToUser(event),
	},
);

if (result.terminalEvent?.kind === "run_failed") {
	// executor-level failure; transport was still valid
	log.warn(result.terminalEvent.phase, result.stderr);
}
```

The reference runner throws `TakumiExecTransportError` when:

- stdout contains invalid JSON
- stdout emits non-protocol payloads
- stdout ends without a terminal envelope
- the child times out before completing

## Chitragupta bootstrap expectation

Takumi already attempts daemon-first Chitragupta bootstrap internally during
`exec --headless` runs. Parent does **not** need to reimplement memory preload;
it only needs to pass project/socket context consistently.

Scarlett should be treated as a supervisory layer above this contract, not a
replacement for it. In practice that means:

- Chitragupta decides whether Scarlett supervision is required
- parent still invokes Takumi through `runTakumiExec(...)`
- Scarlett-related anomaly / heal / integrity signals should shape routing and
	retry policy around the exec run, not bypass the exec contract itself

## Non-goals

- parent parsing stderr as protocol
- parent re-implementing Takumi’s Chitragupta bootstrap logic
- parent assuming in-process execution
- vendor-specific routing in the Takumi adapter contract