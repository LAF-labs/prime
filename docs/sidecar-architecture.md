# How LAF Agent ships the agent runtime

A record of why the agent runs the way it does, and when that should change.

## Who owns the harness

The sidecar is built from **LAF's own fork** —
[LAF-labs/prime-harness](https://github.com/LAF-labs/prime-harness) — at the
pinned `HARNESS_REF` in `scripts/build-sidecar.sh`, never from upstream
directly and never from a moving branch. `HARNESS.json` inside the sidecar
records the exact ref, commit, and build time; the app shows it in Settings.

Upstream (`PrimeIntellect-ai/prime-agent`) ships fast — 40+ releases. We
follow it deliberately, not automatically: `scripts/harness-upstream.sh`
shows what upstream has shipped since our pinned ref, and taking an update
means merging the upstream tag into the fork, re-tagging, bumping
`HARNESS_REF`, rebuilding, and committing both together. Harness-level
features we own (the permission gate, sandboxing, provider compatibility)
land in the fork as first-class code rather than riding along as external
patches.

## What ships today

`src-tauri/resources/prime-agent/` is a 192 MB folder inside the app bundle:

| Part | Size | Why |
|---|---|---|
| `node` | 108 MB | Node.js 22 — prime-agent is JavaScript and needs a runtime |
| `uv` | 42 MB | Astral's installer; the only way prime-agent provisions Python |
| `dist/` | 21 MB | prime-agent 0.7.0, compiled |
| `node_modules/` | 21 MB | native modules the JS bundle keeps external |

Plus, on first run, roughly 350 MB into the user's home directory: a
standalone CPython 3.11 and the kernel venv. That part is not redistributed.

`agent_launch.rs` resolves, in order: a user-configured binary, this sidecar,
then `prime-agent` on PATH.

## Why not the alternatives

**Require the CLI separately** (`curl … | sh`, then point the app at it). This
was the first implementation. It costs the user a terminal step before the app
does anything, and every support conversation starts with "which version do
you have". Rejected once the goal became a Claude-app-grade install.

**Download the runtime on first launch.** Smaller DMG, always-current agent.
Rejected for now because it moves a hard dependency to install time: a first
launch on a captive-portal network, a corporate proxy, or a locked-down
machine fails with nothing to fall back on. It also means signing and
notarizing something we did not build, or running unsigned downloaded
executables — a Gatekeeper problem with no clean answer.

**Embed the SDK in-process.** prime-agent publishes a TypeScript SDK. Our
backend is Rust, so using it would mean either rewriting the backend in
Node/Electron or embedding a JS engine. Both are larger changes than the
problem justifies, and both give up the process isolation that currently makes
a crashed agent a recoverable event rather than a crashed app.

**Compile prime-agent to a single binary** (`bun build --compile`). Tried and
abandoned: ZeroMQ's native addon calls `uv_async_init`, which Bun does not
implement ([oven-sh/bun#18546](https://github.com/oven-sh/bun/issues/18546)),
so the binary crashes at startup. Revisit if Bun closes that gap — it would
remove the 108 MB Node copy.

## The real cost: version drift

prime-agent shipped v0.5.0 through v0.7.0 in three days, 40 releases so far.
A bundled copy is a snapshot, so LAF Agent's agent version is whatever the
last DMG was built with. Two consequences:

1. **Upstream fixes need an app release.** There is no way for a user to take
   an agent-side fix without downloading a new DMG.
2. **The kernel venv is invalidated by upgrades.** prime-agent hashes its
   Python runtime source into `kernel-venv/.bootstrap-version`; when the hash
   changes the venv is deleted and rebuilt. Every sidecar bump that touches
   `prime-agent-runtime` therefore costs the user another ~350 MB download.

Neither is fatal today — the app is pre-1.0 and ships often anyway — but both
get worse as the user base grows.

## When to change this

Move to **download-on-first-run with the bundle as a fallback** when any of
these becomes true:

- DMG size starts costing downloads (watch the drop-off between download and
  first launch),
- agent-side fixes are landing faster than app releases can carry them, or
- a second platform doubles the bundled native-module matrix.

The shape that keeps both properties: ship the current sidecar as the
fallback, and let the app fetch and verify a newer prime-agent into
`~/.laf-agent/runtime/` on a background schedule, preferring it when the
signature checks out. That keeps a working offline install while decoupling
the agent's release cadence from ours. It needs a signed manifest — the same
minisign infrastructure the app updater will need anyway — so it is worth
doing once, together.

Do **not** move to a pure download model. An app that cannot start without
the network is a worse product than one that ships 200 MB.
