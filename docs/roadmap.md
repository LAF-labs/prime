# Roadmap

The governing principle: **data must be safe before users are invited, and the
moment it is, the release pipeline gets exercised for real.** Each phase has a
gate that decides "done"; a phase is pushed only after its gate passes.

Decided elsewhere and not revisited here: Apple Silicon only for now, Windows
later; Apple signing/notarization happens at the end, done by the maintainer;
nothing subscription/billing-shaped is implemented (open-source distribution —
extensibility is considered, features are not built).

## Phase 1 — Finish the durability and lifecycle leftovers

Audit findings that are still open, all of the "user data quietly rots" class:

- Drain the SQLite write queue and checkpoint the WAL on shutdown
  (`ThreadDatabase::shutdown` is dead code today; a 4 MB WAL was observed).
- Give every window a flush window on close, not just the last one.
- Quarantine an unparseable settings TOML instead of `unwrap_or_default()`
  overwriting it with defaults.
- Replay the resumption preamble on session-less reconnect so the agent does
  not forget the visible conversation.
- `kill_on_drop` for one-shot generators; abort the stderr reader task; move
  the 50 ms sleep out of the connections lock; cap stdout line length.
- Analytics load keeps the **newest** events when hitting the 50k cap, not the
  oldest.

**Gate:** automated tests incl. a shutdown-drain test; force-kill smoke check.

## Phase 2 — First release rehearsal

None of the release infrastructure has run end to end. Failures live here.

1. Make the release workflow tolerate missing Apple secrets (unsigned draft).
2. `bun run release` → tag → CI draft. Verify locally: DMG mounts, app
   launches, sidecar present, `latest.json` verifies against the minisign
   pubkey.
3. Publish, cut a second version, and drive the update loop as far as
   automation reaches; the final in-dialog click is a documented manual step.
4. The whole sequence becomes the QA checklist in `docs/releasing.md`.

**Gate:** update loop completed (machine-verified steps + the one manual click).

## Phase 3 — `cocoa` → `objc2`, Rust warnings to zero and gated

The 44 remaining warnings all come from the deprecated `cocoa` crate (traffic
lights, activation policy, corner radius). Window-rendering code, so the gate
is visual: build, launch, screenshot-compare the chrome. Then `-D warnings`
goes into CI, same as the frontend lint gate.

**Gate:** `cargo check` 0 warnings, visual parity, CI gate active.

## Phase 4 — Storage flip: SQLite becomes the real source of truth

The largest structural debt: the whole conversation history is rewritten as
one JSON blob every 10–30 s, so write amplification and the corruption
exposure window both grow with the user's history (hundreds of MB/year for a
heavy user).

- Read path becomes SQLite-first; `history.json` shrinks to a thin index
  (ordering, project mapping). The recovery path built earlier is half of
  this flip already.
- Checkpoint refs get a retention policy (~45k refs/year today, pinning
  commits against `git gc`); `checkpoint_revert` gets a stash safety net.
- Analytics events get a retention policy.

**Gate:** per-turn disk writes are constant-size on a 1,000-message thread;
migration is lossless on existing data.

## Phase 5 — Provider horizon (openclaude review as input)

Beyond API keys: subscription-account sign-in (Claude Pro / ChatGPT plans) is
what "any provider" means for non-developers. Start with a review of how
openclaude implements Codex OAuth, then a feasibility verdict on carrying an
OAuth provider in the `prime-harness` fork. **Implementation only starts after
the verdict is reviewed and approved** — the harness-side surgery could be
large.

**Gate:** feasibility report + go/no-go decision.

Windows groundwork (Job Objects for process groups, ConPTY, sidecar Windows
build, CI matrix) starts after Phase 4 — everything Phases 1–4 touch is
exactly what gets ported, so starting earlier means doing the work twice.

---

# Round 2 — after the defect sweep (2026-08-08)

Round 1 (Waves 1–5, all shipped) closed the P0/P1 findings from the
four-track product audit: storage-layer data loss, Rust panics/hangs,
trust-level UX defects, last-mile wiring (PR creation, rollback UI,
regenerate, edit-resend, global search, enforced plan mode), and full
Korean coverage with a regression test.

The next order is set by the GUI↔harness RPC alignment audit: the bundled
harness exposes ~45 in-session RPC commands and a daemon-mode session
manager; the GUI uses roughly a third of the commands and translates 18
event kinds. The gaps below are ranked impact-per-effort.

## Wave 6 — RPC alignment finish (S/M, high)

- Surface `/refine` outcomes: handle `refine_complete` / `refine_failed`
  notifications and show the result in the thread.
- Consume `thinking_level_changed` / `service_tier_changed` so the UI
  reflects levels changed agent-side.
- Settings toggles for `set_auto_compaction`, `set_auto_retry`,
  `set_steering_mode` (applied at session start and on change).
- ~~Scheduled prompts UI~~ — dropped: the harness rejects schedules outside
  daemon mode ("Cron jobs require daemon mode"), verified live. Folded into
  the Wave 9 daemon-mode item.

**Gate:** every harness notification kind is either handled or explicitly
listed as ignored with a reason; new toggles round-trip. **Shipped 016627e.**

## Wave 7 — Rust hygiene batch (P2 backlog, M)

Main-thread stalls (`task_create` sleep, quit-path `recv_timeout`,
window-close listener leak), thread_db reads without `spawn_blocking` +
poisoned-lock recovery, same-second dedupe collapse, analytics lock/fsync
hygiene + timestamp key truncation, watcher cap race, non-atomic
`.gitignore`/`auth.json`/confy writes, error strings leaking absolute
paths, debug_log IPC volume on the streaming hot path, agent-slot
check-then-insert race, stuck `probe_running` guard.

## Wave 8 — UX remainder (P2/P3, S/M)

Thread-delete affordance unification + undo toast, commit-button contract
unification (CodePanel vs CommitDialog), App.tsx async-listener cleanup
under StrictMode, remaining empty-state CTAs.

## Wave 9 — Competitive features (M/L, decide order with the owner)

Permission granularity (rule list + edits-only mode), context inspector,
menu-bar presence + global summon hotkey, MCP one-click gallery,
hunk-level diff ops / comment-to-prompt, daemon-mode session manager
(attach/detach, sessions that survive app restarts) as the long-term
architecture step.

## Cross-session messaging (deferred — hand to a subagent)

Claude Code shipped [cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging):
one session can send another a plain-text message, discovered with
`ListAgents` and delivered with `SendMessage`. Verdict from reading the
docs and our own gate extension:

**Interop with Claude Code itself: no.** Sessions find each other through
a per-session Unix socket plus on-disk registration files, and neither the
wire format nor the registration layout is published — only the settings
names (`crossSessionInbound`, `isolatePeerMachines`, `dialogExpiry`).
Reverse-engineering a private protocol would break on their next release.

**The same capability between our own threads: feasible, and simpler for
us than for them.** They need sockets because each session is its own
process. Every LAF Agent thread already lives in one Tauri backend, inside
`AgentState.connections` — no socket, no disk registration, no
cross-machine path.

What it takes:

- Rust: `list_threads` (the tasks map already holds them) and
  `send_thread_message(from, to, text)`, which injects a prompt into the
  target thread's connection.
- The model can only use it if the tools are declared to it. The gate
  extension already registers tools (`pi.registerTool(sandboxedBash)` in
  `resources/laf-agent-gate.ts`); `list_agents` / `send_message` go in the
  same place.
- Inbound control reuses the existing permission modes
  (ask / acceptEdits / auto) rather than inventing a second policy axis.
- Loop protection is not optional: Claude Code rate-limits per sender,
  drops identical repeats inside a short window, and caps unread messages
  at 50 per session. A naive implementation ping-pongs forever.
- A "Message from <thread>" row in the transcript, collapsed like a tool
  call.

Size M–L. The hard part is product design (inbound surface, loop policy),
not the plumbing. This is a power-user feature — sequence it behind the
empty-state cleanup and the next DMG.
