# Roadmap

The governing principle: **data must be safe before users are invited, and the
moment it is, the release pipeline gets exercised for real.** Each phase has a
gate that decides "done"; a phase is pushed only after its gate passes.

Decided elsewhere and not revisited here: Apple Silicon only for now, Windows
later; Apple signing/notarization happens at the end, done by the maintainer;
nothing subscription/billing-shaped is implemented (open-source distribution —
extensibility is considered, features are not built).

> **Shipped since this was written:** every git feature is gone — worktrees and
> the git panel first (`0a04712`), then turn checkpoints, file-tree git status,
> and the `git2` crate itself (`513fb7d`). Sections below that describe git
> branches, worktrees, or checkpoint retention are historical record, not
> pending work. The app is now a non-developer everyday agent.

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
restore-to-here, global search, enforced plan mode), and full
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

## Direction shift — the simple surface becomes the product (2026-08-09)

The default surface is now **simple mode**: chat-first, with developer
chrome — git branches, worktrees, the diff panel, terminal, debug log —
hidden behind a `uiMode` setting. Developer mode keeps the full harness;
nothing is removed from the codebase, the mode only decides what renders.
Installs that predate the split resolve to developer; fresh installs get
simple, and onboarding records the choice explicitly.

What this reorders:

- **Up**: MCP-first workspaces (sessions with no code tools, MCP data
  sources as the primary path — `--tools` / `--no-builtin-tools` needs
  re-verification on the current fork), onboarding that never says "API
  key", daemon mode (a resident assistant outlives its window), lazy
  kernel install (~350MB is a lot for a chat-first user).
- **Down**: context inspector, hunk-level diff ops, git stack — developer
  surface work.
- **Later, design only**: a per-user knowledge-graph view over sessions
  and documents (node graph). Not scheduled.

## One surface, one profile (2026-08-09)

The simple/developer split is gone — no `uiMode` setting, no toggle, no
onboarding choice, no `devOnly` command filter. Two modes meant two products
to keep coherent, and the gating only ever grew: every new control needed a
decision about which side it belonged on, and the answer was usually "both,
described differently".

What replaced it is context, not modes. Git buttons appear when the folder is
a git repository. The worktree option appears on the new-thread screen and is
meaningless outside a repo, which is a property of the folder rather than of
the user. The terminal, the editor launcher and the file tree are always
there; someone who does not need a terminal simply never opens it. The
command palette lists every command that can actually run — the only one
removed is `/refine`, which needed the Python kernel that no longer starts.

The agent runs one profile: `--no-builtin-tools` plus the gate's everyday
toolset, with the sandboxed shell available whenever OS confinement is on.
Reasoning effort is one picker with three steps (low/medium/high); the
harness's other four remain reachable through `/thinking`.

### What the profile does

Sessions spawn with `--no-builtin-tools`. Sessions spawn with `--no-builtin-tools`, so ipython —
and the Python kernel behind it — never starts, and the bundled gate
replaces the RLM system prompt (`"You are a general purpose agent that uses
code to solve tasks"`) with a ~350-token conversational one. The gate
registers the everyday toolset in its place: `read_file`, `list_dir`,
`write_file`, `organize`, `remember`, alongside the existing `web_fetch`
and `web_search`.

Nothing was deleted from the fork. The RLM prompt, the kernel, the
continual-harness CRUD, `refine`, and `rlm()` recursion are all still there;
the profile only decides what a session is given. That is deliberate — the
fork stays mergeable with upstream, and reversing the decision is a flag,
not a revert.

### The small-model failure modes are the design constraint

Verified live against `upstage/solar-mini`, deliberately chosen as a
small, cheap model in the class this profile targets. Three defects
surfaced within three turns, none of which any unit test would have found:

1. **Confinement was wrong.** Restricting file access to the home
   directory left a session unable to read the folder it was opened on.
   The workspace is now an allowed root in its own right; hidden entries
   and `~/Library` are still refused, checked relative to whichever root
   matched.
2. **The model guessed names.** It translated `보고서.txt` to `report.txt`
   and `받은파일` to `received_files`, then reported failure. Not-found now
   names what the folder actually contains and says not to translate or
   re-spell; the system prompt says the same thing up front.
3. **Long absolute paths get re-typed wrong.** One character off, in a
   UUID-bearing path. Tool results now report workspace-relative or
   `~/`-abbreviated paths, which is cheaper in tokens and more reliable.

The same reasoning produced the argument-repair layer: cheap models get
tool *intent* right far more often than tool *arguments*, so the gate
repairs the shapes it can be certain about (`filename` → `path`, an
`arguments` envelope, a lone operation where a list belongs, a JSON string
where a value belongs) and blocks with the exact expected shape only when
a call is genuinely ambiguous. Scoped to the everyday tools; developer
tool arguments are never rewritten.

### Research fan-out — real subagents, without the RLM recursion

Fanning research out across child agents is a context-management strategy,
not a luxury: each child reads its own sources and returns a short brief, so
the parent synthesizes from hundreds of tokens instead of a dozen full pages.
That matters *more* with a small model, not less.

The harness's own fan-out (`await rlm(...)`) lives inside ipython, which this
profile switches off, and the RPC surface can `observe` subagents but not
spawn them. So the gate spawns them itself: the same binary, in RPC mode,
with the everyday profile. Three properties keep it from running away —
depth (the tool is not registered for a child, so a child can never fan out
again), read-only (`LAF_READONLY=1` leaves the mutating tools unregistered
*and* refused), and hard bounds on question count, concurrency, per-child
wall clock and brief length.

Verified live: two children spawned in parallel, both answered, the parent
synthesized in Korean, no orphaned processes. Four defects were found and
fixed on the way, all of which cost real time to isolate and are worth
recording:

1. **A headless child blocks forever on an approval dialog.** It raises
   `extension_ui_request` and nothing answers; with stdin closed the harness
   reports "Blocked by user", with stdin open it hangs. Read-only children
   skip the dialog entirely, which is safe only because the mutating tools
   are already unreachable for them.
2. **`turn_end` is not the end of the agent's work.** It also fires after a
   turn that merely called a tool. Treating it as completion killed children
   mid-investigation — measured, a child answered at 33s and was cut off at
   23s, one tool call in, then reported as silent. Only `agent_end` ends a
   child.
3. **`web_fetch` returned navigation, not content.** A Wikipedia article came
   back as 40,000 characters of menus with the prose past the truncation
   limit; the model fetched twice, got the same wall of chrome, and gave up.
   The first fix was a hand-written regex stripper, which was the wrong thing
   to write — see *Adopt, don't reimplement* below.
4. **The page limit belongs to the model class, not the tool.** 40,000
   characters is fine for a large model and far too much for the small ones
   this profile serves; a single article at that size pushed a child past its
   budget without answering. The everyday profile takes 12,000.

A methodological note worth keeping: this feature was once withdrawn as
"broken, cause not established". It was not broken. The test harness driving
it never answered the approval dialog, which produces exactly the symptom
that was mistaken for a dead tool — `tool_execution_start`, no
`tool_execution_end`, and an `execute` body that appears never to run.
`write_file` reproduces it identically. Before concluding a tool is dead,
check that something is answering its dialogs.

### Adopt, don't reimplement

Article extraction was written from scratch as a regex stripper. It worked on
the page it was tested against and would have kept failing quietly on the
rest of the web. It is now `@mozilla/readability` — the library behind
Firefox Reader View — over `linkedom` for a DOM. Measured on the same pages:

| Page | Raw | Regex version | Readability |
|---|---|---|---|
| Wikipedia (Python) | 1,011 KB | 40 KB, no title | 79 KB of prose, title extracted |
| 나무위키 (파이썬) | 462 KB | not extractable | 7 KB, correct Korean body and title |
| npm registry JSON | 22 KB | passthrough | passthrough (no article found) |

The regex path stays as the fallback: Readability is a *reader*, and finds no
article in a JSON endpoint or a bare fragment, which still have to come back
as something. Cost is 6.8 MB in a 201 MB sidecar, Apache-2.0 and ISC, both
recorded in `THIRD-PARTY-NOTICES.md`.

The rule this is an instance of: before writing something, check whether it
is a solved problem with a decade of tuning behind it. Candidates still worth
auditing under that rule — the tool-argument repair table, the research
fan-out orchestration, and the permission-rule matcher — each of which was
written here rather than adopted.

### Still open

- **Scheduled tasks.** `cron-jobs` exists in the fork and is dormant.
  "Summarize my inbox every morning" is the consumer translation.
- **Activity history.** A plain-language timeline of files touched and
  sites visited — a trust surface, distinct from the developer debug log.
- **A model floor exists, and it is below the tier we ship.** Asked to list
  a folder and report a file's contents, `solar-mini` listed the folder and
  then invented the contents without ever calling `read_file`. Three
  guardrails failed to stop it: a system-prompt rule, an explicit
  never-state-unread-contents line, and a notice appended to `list_dir`'s own
  result. `solar-pro4`, one tier up, does it correctly and unprompted —
  `list_dir`, then `read_file` with the exact Korean filename, then an
  accurate answer. So the guardrails stay (cheap, and they work on a model
  that can follow them) and the conclusion is about which model we resell,
  not about prompting. A mechanical fallback exists if a cheap tier ever
  proves necessary: detect an answer describing a file with no `read_file`
  for that path in the turn, and make the model try again.
- **The Python kernel is now dead weight.** Nothing spawns ipython, so the
  bundled `uv` (42 MB) and the kernel provisioning path exist for a feature
  no session reaches. Removing them is a real bundle-size win and its own
  careful pass.
- **Escalation.** Two failed tool repairs in a row could retry once on a
  larger model. Needs the usage metering to be wired to a budget first.
- **Research progress.** A research turn is silent for half a minute or
  more. The children's briefs arrive all at once; showing them as they land
  would make the wait legible.
