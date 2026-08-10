# How LAF Agent ships the agent runtime

A record of why the agent runs the way it does, and when that should change.

## Who owns the harness

The sidecar is built from **LAF's own fork** —
[LAF-labs/prime-harness](https://github.com/LAF-labs/prime-harness) — at the
pinned `HARNESS_REF` in `scripts/build-sidecar.sh`, never from upstream
directly and never from a moving branch. Because a tag is movable and a
commit is not, the script also pins `HARNESS_SHA` and fails the build if the
cloned tag resolves to a different commit. `HARNESS.json` inside the sidecar
records the exact ref, commit, `node` and `uv` versions, and build time; the
app shows it in Settings.

Upstream (`PrimeIntellect-ai/prime-agent`) ships fast — 40+ releases. We
follow it deliberately, not automatically: `scripts/harness-upstream.sh`
shows what upstream has shipped since our pinned ref, and taking an update
means merging the upstream tag into the fork, re-tagging, bumping
`HARNESS_REF` and `HARNESS_SHA`, rebuilding, and committing both together. Harness-level
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

## How the build is pinned

Everything the sidecar ships is either pinned or asserted at build time
(`scripts/build-sidecar.sh`); nothing floats with the build machine or a
remote host:

- **Harness: tag + commit.** The clone uses `HARNESS_REF` (a fork tag), and
  the build fails unless the resolved `HEAD` equals `HARNESS_SHA`. A moved or
  force-pushed tag cannot silently change what ships. Bumps update both
  values together; `HARNESS_SHA=""` allows a one-off unpinned build.
- **uv: SHA256-verified download.** The release tarball is verified against
  the `.sha256` file uv publishes next to every GitHub release asset
  (`shasum -a 256 -c`) before extraction. A tampered or truncated download
  fails hard instead of shipping. `UV_VERSION` selects the release.
- **Node: major-version guard.** The runtime is copied from the build
  machine, so the script refuses to build unless `node --version` matches
  `NODE_VERSION_EXPECTED` (major, currently 22), and records the exact
  version in `HARNESS.json` under `node`.
- The work directory is a `mktemp -d` cleaned by an `EXIT` trap, so a failed
  build leaves nothing behind.

`HARNESS.json` is the provenance record for all of it: `ref`, `commit`,
`repo`, `node`, `uv`, `builtAt`.

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

## What the sandbox actually enforces

upstream prime-agent states plainly that it runs model-generated code with the
user's privileges and is "not a security sandbox". That is accurate for a CLI,
where the user opted into exactly that. A desktop app has a different bar: our
Settings screen offers a "Tight sandbox" toggle, defaulted on, and a toggle
that promises something has to deliver it.

So the gate extension (`src-tauri/resources/laf-agent-gate.ts`) adds two
layers on top of the approval prompt:

1. **Path canonicalization** on file-path tool arguments — `..` collapsed,
   symlinks resolved, relative paths resolved against the workspace.
2. **OS-level confinement of `bash`** via `@anthropic-ai/sandbox-runtime`
   (`sandbox-exec` on macOS, bubblewrap on Linux). Writes are limited to the
   workspace and temp dirs; `~/.ssh`, `~/.aws`, `~/.gnupg`, and `auth.json`
   are unreadable. Verified end to end: a model-issued `bash` writing to
   `$HOME` returns `Operation not permitted`.
3. **OS-level confinement of `ipython`** (`src-tauri/src/commands/kernel_sandbox.rs`).
   The kernel is a long-lived process the harness spawns itself, out of the
   gate's reach — but `PRIME_AGENT_KERNEL_PYTHON` lets us substitute the
   interpreter, so we point it at a wrapper that re-execs the venv python
   under a generated Seatbelt profile. Same write scope, same credential
   denials. Verified: workspace write succeeds, `$HOME` write and `auth.json`
   read both raise `PermissionError`, network still works, and the harness's
   own interpreter validation (ipykernel, prime-agent-runtime, default
   packages) passes through the wrapper.

Not covered, and stated in the UI rather than buried here:

- **Network** — deliberately open for both tools. A domain allowlist routes
  traffic through a proxy and breaks npm, pip, and git for every project.
- **Reads** — only credential files are denied; the rest of the disk is
  readable.
- **Non-macOS** — the kernel profile is `sandbox-exec`, so on Linux and
  Windows the kernel runs unconfined and the approval prompt is the only
  control. (`bash` is still confined on Linux via bubblewrap.)

The profile is `(allow default)` with targeted denials rather than
`(deny default)` with an allow-list. A deny-default profile for CPython means
enumerating every dylib, locale file, and framework it touches — derivable
only by bisecting against a running kernel, and brittle across Python
versions. Paths enter the profile as `-D` parameters, never by string
interpolation, so no path can alter the policy's structure.

The approval prompt remains the real control. This narrows the blast radius
when a user approves something they misread; it does not make untrusted
repositories safe to run.

## How web access works

Claude Code and Codex both solve web search the same way, and neither ships a
scraper or a third-party search key: the **model provider runs the search
server-side**, inside the turn. Anthropic exposes it as the
`web_search_20250305` tool on the Messages API; OpenAI as `web_search` on the
Responses API. Results reach the model directly and are billed with the turn
the user is already paying for.

prime-agent declares neither tool, so the gate appends the right one to the
outgoing request in its `before_provider_request` hook, sniffing the payload
shape to tell the two APIs apart. Providers that have no server-side search —
local models, third-party OpenAI-compatible endpoints — are left untouched.
`LAF_NATIVE_WEB_SEARCH=0` turns the injection off.

Two client-side tools fill the rest in, both keyless and provider-independent:

- **`web_fetch`** — always registered. Fetches a URL, strips markup, truncates.
  This is what makes a URL the user pastes readable on every provider.
- **`web_search`** — registered only when `LAF_WEB_SEARCH_URL` points at a
  [SearXNG](https://docs.searxng.org) instance, which is self-hostable and
  needs no account. Only its JSON API is parsed, so the instance needs `json`
  in `search.formats`; its HTML is theme-dependent and would rot silently.
  When the provider *does* have server-side search, the gate strips this
  declaration from the payload before injecting the native tool — both APIs
  reject a request that names one tool twice, and the server-side search is
  the better of the two.

What is deliberately absent is a keyless scrape of Google, Bing, or
DuckDuckGo. Measured from a normal machine, DuckDuckGo answers an unattended
client with a JS challenge (HTTP 202), Mojeek and Ecosia with 403, Brave with
429; public SearXNG instances serve results but rate-limit within a couple of
requests. A scraper would pass review and then fail in the field, which is
worse than not having one.

The bundled `websearch` skill that upstream ships — a Google wrapper over a
paid third-party search API — is deleted in our harness fork rather than
disabled. A tool that exists only to ask for an API key the app never uses is
a support burden, not a feature.

## The skill set is cut to two

`v0.7.0-laf.2` ships `notion` and `attach-image`. The other ten are deleted in
the fork for the same reason as `websearch`: `formatSkillsForPrompt` injects
every skill's name and description into the system prompt on every turn, and
the developer set measured ~1,390 tokens against a 2k fixed-input budget.

- `compact`, `goal`, `refine` duplicate slash commands the session already
  handles, and the skill versions additionally need the IPython kernel.
- `prime-intellect` is a third-party GPU/ML product CLI and was the single
  most expensive entry at 727 characters.
- `agent-message`, `agent-observe`, `rlm-heartbeat` are multi-agent daemon
  plumbing; `skill-creator` is authoring tooling for the harness itself.
- `edit` is an exact-string replace primitive — the everyday profile edits
  through the gate's `write_file` and `organize`.
- `linear` is a developer issue tracker.

Deleting rather than hiding matters: hiding a skill from the palette leaves it
in the prompt, where it still costs tokens and the model can still invoke it.
The harness does support `disable-model-invocation: true` for the middle case
(reachable by `/skill:name`, absent from the prompt).

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
