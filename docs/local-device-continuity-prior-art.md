# Local-First Device Continuity Prior Art

> Focused scan of adjacent GitHub projects and research papers relevant to Takumi's local-first continuity direction.

## Short verdict

There is **plenty of prior art for terminal sharing** and **some prior art for local-first coordination models**, but in this scan I did **not** find an obvious system that combines all of the following in one coherent product/runtime model:

- local machine remains the canonical control plane
- browser/phone acts as a companion surface first
- attach supports replay/resume semantics
- write-capable execution is governed by an explicit **single-writer lease**
- execution authority can transfer across devices without making a vendor cloud the session sovereign

So the idea is **not from nowhere**, but the exact Takumi shape still looks differentiated.

## Open-source systems already doing adjacent pieces

| System | What it clearly does | Why it matters | What it does **not** give us |
| --- | --- | --- | --- |
| [`tmate`](https://github.com/tmate-io/tmate) | Instant terminal pairing as a fork of tmux | Proof that shared terminal control is a real demand | No browser/mobile companion model, no lease transfer semantics, no local-first control plane story |
| [`upterm`](https://github.com/owenthereal/upterm) | Secure terminal sharing over SSH, self-hostable server, optional WebSocket transport, force-command for tmux/container workflows | Strong precedent for secure session sharing and self-hostable pairing | Still a host/client sharing tool, not a multi-device continuity control plane with executor lease transfer |
| [`teleconsole`](https://github.com/gravitational/teleconsole) | Share UNIX terminal and forward local TCP ports to trusted users | Shows older appetite for trusted terminal collaboration | Archived/shut down, and still terminal sharing rather than local-first continuity |
| [`GoTTY`](https://github.com/yudai/gotty) | Turn a CLI command into a browser-accessible terminal; read-only by default, writable by explicit flag | Strong precedent for browser companion surfaces and observer-first safety | No canonical session identity, replay, or cross-device executor handoff |
| [`ttyd`](https://github.com/tsl0922/ttyd) | Share a terminal over the web; read-only by default, writable by explicit flag | Modern, maintained browser terminal prior art | Same gap: exposes a terminal, not a continuity protocol |
| [`WeTTY`](https://github.com/butlerx/wetty) | Browser terminal over HTTP/HTTPS backed by SSH/login | Useful precedent for browser/mobile attach surfaces | Browser access is the product; it does not model transfer of runtime sovereignty |

## Closest conceptual takeaways

### Terminal-sharing lineage

The terminal-sharing lineage is real and mature:

- `tmate` proves the basic pairing problem matters
- `upterm` improves the model with secure SSH and self-hostable transport
- `GoTTY` / `ttyd` / `WeTTY` prove browser attach is normal and useful
- `teleconsole` shows trusted remote sharing + forwarding was already compelling years ago

But these systems mostly answer:

> "How do I let another person or browser access this terminal?"

Takumi is trying to answer a harder question:

> "How do I preserve **local authority** while letting multiple devices attach, observe, and safely transfer execution ownership?"

That is a different systems question, not just a prettier web terminal.

## Research papers that matter

### Local-first theory

- [`LoRe: A Programming Model for Verifiably Safe Local-First Software`](https://arxiv.org/abs/2304.07133)
  - Relevant claim: local-first systems keep data/processing local while collaborating over unreliable networks, and some interactions require selective strong coordination to preserve safety.
  - Why it matters: validates the Takumi instinct that "local-first" is a real design space, not marketing glitter.

- [`Behavioural Types for Local-First Software`](https://arxiv.org/abs/2305.04848)
  - Relevant claim: peers should retain autonomy and continue to make local progress even with unreliable connectivity; consistency can be recovered under well-formed coordination rules.
  - Why it matters: supports the split between autonomous devices and explicit coordination boundaries.

### Remote pair-programming studies

- [`From Collaboration to Solitude and Back: Remote Pair Programming during COVID-19`](https://arxiv.org/abs/2105.05454)
  - Relevant claim: remote pair programming shifted between active co-editing and more passive co-reading/screen-sharing depending on tools and context.
  - Why it matters: reinforces that Takumi should support more than one collaboration intensity.

- [`The Impact of Remote Pair Programming in an Upper-Level CS Course`](https://arxiv.org/abs/2204.03066)
  - Relevant claim: remote pair programming performed as well as in-person pairing in that study context.
  - Why it matters: says the product bet is socially plausible; it does **not** define the runtime architecture.

## What still looks novel for Takumi

The distinctive pieces are not QR codes by themselves. QR pairing is table stakes.

The more novel bundle is this:

1. **Companion-first attach**
   - phone/browser joins as observer/commenter/approver first
   - no silent escalation to full executor

2. **Replayable continuity**
   - new device attaches from a known boundary and reconstructs recent truth
   - continuity is not "open a raw socket and hope"

3. **Single-writer executor lease**
   - multi-device observation, one execution authority
   - avoids cursed multi-writer terminal semantics

4. **Local control plane sovereignty**
   - Chitragupta remains canonical
   - private network tools are transport, not authority
   - cloud is optional rather than the home of the session

5. **Transfer as a first-class state machine**
   - claim / yield / blocked / degraded / witness-confirmed transfer
   - this is much richer than ordinary "attach to shell"

## Product implication

The right comparison target is **not** "Can Takumi also do terminal sharing?"

That would be a boring yes.

The real comparison target is:

- terminal sharers already solved attach
- browser terminals already solved web rendering
- local-first research already explored autonomy + coordination
- Takumi can combine those ideas into a runtime where **authority transfer** is explicit, local-first, and operator-owned

## Working conclusion

There is enough prior art to say the direction is grounded, and enough missing integration to say the Takumi version is still interesting.

If we build this well, the novelty is not a single feature. It is the combination of:

- companion surfaces
- replayable attach
- explicit executor leases
- private/local authority
- transfer semantics that treat continuity as a control-plane problem

That combo is the part that still feels underexplored rather than already commoditized.
