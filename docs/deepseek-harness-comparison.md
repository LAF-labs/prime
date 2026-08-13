# What we took from deepseek-ai/deepseek-harness

Read 2026-08-13, the day it was published (MIT, TypeScript, ~8,600 files).
It is a developer coding agent — plugin tree, LSP, terminals, subagents — and
we are an everyday assistant for people who do not write software, so most of
its surface does not transfer. Its *rules* did.

Each item below was measured against our code before it was changed and after.

## Adopted

### The environment is part of what a shell command can read

> "Never hand untrusted output the ambient environment ... spawned commands get
> a scrubbed env (drop `*KEY*`/`*SECRET*`/`*TOKEN*`/`*PASSWORD*`) so harness
> credentials cannot leak into output, `env`, or spill files."
> — `docs/defensive-patterns.md`

We had just denied the sandboxed shell read access to `~/.lafagent`,
`~/.laf-agent` and `~/.prime/agent`, and considered credentials handled. Asked
to print its variable names, a real session's shell listed
`PRIME_AGENT_INTERNAL_DAEMON_WORKER_TOKEN` — the credential for the agent
daemon's own socket, which lives in a directory the sandbox lets commands
write to.

Denying the files while handing over the environment is half a fix, and the
half that is missing is the one that does not look missing.

Fixed in `57a4f40`: the shell gets a filtered copy of the environment
(credential shapes, plus the `LAF_` and `PRIME_AGENT_` prefixes), passed
structurally through `exec`'s own `env` option rather than smuggled in as shell
text.

### Fail closed when there is nobody to ask

Their tool pipeline documents the approval step as **"absent or unanswerable:
deny"**. Ours returned "allow" when `ctx.hasUI` was false.

Every branch above that line is a reason a call may proceed — a read, a
research child already refused every mutating tool, a saved rule, acceptEdits.
What was left was a session that reached a file-changing or command-running
tool with no way to ask permission. Allowing it made "the approval dialog
stands between the model and your files" true only when a dialog happened to
exist.

This harness answers its own no-UI prompt with `"cancel"`, so both references
fail closed. Fixed in `57a4f40`, after measuring that RPC sessions do bind a UI
— nothing a user sees changed.

### Bound a long result to head + marker + tail

Their `compaction-tool-result-pruner` replaces an oversized tool result with a
bounded head, a fixed omission marker, and a bounded tail. Ours kept the head
and dropped everything after it.

That is the wrong end to drop. The conclusion of a report, the total of a
statement, the signature on a contract, the newest line of a log — the end of a
document is usually where its answer is. Measured before reading their design:
asked for a long document's conclusion, our model read the front, said honestly
that it had only seen the front, and could go no further.

Fixed in `008c0b6`, using their 4:1 split (32k head, 8k tail of a 40k budget).
Same question, same document: one call, correct answer.

### A per-turn nudge beats a permanent prompt line

Their `repeat-tool-reminder` is "an advisory loop-breaker, not a model-facing
tool" — it injects an escalating reminder into the conversation at the moment
the behaviour appears, and never blocks. Zero tokens before the threshold.

We had the same problem in a different place: told "기억해줘", the model
answered "기억해 둘게요" and called nothing. Their shape — say it on the turn
it matters, not in the system prompt — is what our fix uses (`b2a1c7e`), which
also keeps it off a fixed prompt already at 2,637 of its 2,700-character
budget.

## Considered and not taken

- **`repeat-tool-reminder` itself.** Well designed, but we have no measured
  repeat-loop problem. Worth revisiting if one appears; the config shape
  (thresholds, include/exclude, per-agent `WeakMap` keying, untracked calls
  being transparent to the chain) is worth copying wholesale if so.
- **`spill` (persist oversized output, return a preview plus a retrieval
  locator).** Strictly better than truncation, and a much larger change: it
  needs a store, retention, and a locator the model can redeem. Head+tail plus
  `part: "end"` covers the cases we have measured.
- **The plugin tree (Cordis), profiles and bundles.** Their answer to "every
  part is replaceable from configuration". We deliberately have one profile;
  this is a cost we have no reason to pay.
- **`glob`/`grep` (`dsh-tool-fs-search`).** Confirms the shape of a gap we
  already know: `laf-skills/find-file/SKILL.md` opens with "There is no search
  tool here." Still an open product decision, not something their code settles.
- **`ask_user_question` as a tool.** Relevant to a defect this comparison
  surfaced (below) but a design decision of its own.

## Found while comparing, still open

`QuestionCards` is dead in the everyday profile. The component, its parser, its
paging and free-text answers, and its tests all exist; `parseQuestions` wants a
`[1]: question` / `a. option` format, and nothing tells the model to produce
one. Every question the agent actually asked in a day of live runs parses to
zero cards.

The three options are a tool (their `ask_user_question` shape), a documented
format in the system prompt (which needs budget we do not have — 63 characters
free), or deleting the UI. Not a code change to make on our own.
