# Release readiness

What stands between the current build and something a stranger can install.
Written 2026-08-14 against `0.1.1`. Every claim here was measured on this
machine, and the commands to re-check are included so this can be re-run rather
than believed.

## The one blocker that is not code

**Nobody but you can install the app today.** Not "it warns" — it does not
install.

```bash
codesign --verify --deep --strict "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/LAF Agent.app"
```

Before the ad-hoc signing fix this printed `code has no resources but signature
indicates they must be present`, and `spctl` agreed. There was no
`_CodeSignature` directory in the bundle at all: Tauri signs the .app only when
given an identity, and with none it left the bundle unsigned while the linker's
own ad-hoc signature stayed on the binary inside. macOS reads that pair as a
damaged app, which is worse than an unsigned one — the right-click-Open escape
hatch has nothing to validate, so testers cannot get past it either.

That part is fixed: `bun run build` now signs ad hoc when no identity is
configured, and the bundle verifies. **This does not make it distributable.**
Ad-hoc means "signed by nobody"; Gatekeeper on any other Mac still refuses it.

To actually ship you need, in this order:

1. **An Apple Developer Program membership** — $99/year, and the only thing
   that produces a Developer ID Application certificate. There is no free path;
   ad-hoc, self-signed, and unsigned all fail on someone else's machine.
2. **Notarization** — uploading the signed app to Apple, which staples a ticket
   proving it was scanned. An app signed with a Developer ID but not notarized
   still warns on first launch. Both are needed.
3. **The six repository secrets** the release workflow already expects and
   documents at the top of `.github/workflows/release.yml`:
   `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
   `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.

The workflow is already written for this and does the right thing without them:
it builds an unsigned draft and says so. No code change is needed when the
secrets arrive.

## The updater does not work yet, and cannot until a release is published

```bash
curl -sI "https://github.com/LAF-labs/prime/releases/latest/download/latest.json" | head -1
```

`HTTP/2 404`. The only release on the repository is a **draft**, and GitHub does
not serve `releases/latest` from drafts. This is why every app launch logs
`update endpoint did not respond with a successful status code`, and why
Settings shows an update error a user can do nothing about.

Two things unblock it, neither of them code:

1. **A minisign keypair** for `TAURI_SIGNING_PRIVATE_KEY`, generated with
   `bunx tauri signer generate`. The public half is already committed in
   `tauri.conf.json`, so the private half must be the one that matches it — if
   you generate a fresh pair, the config's `pubkey` has to change with it or
   every installed app will refuse the update as unsigned.
2. **Publishing the draft**, so `releases/latest` resolves.

The workflow already fails loudly rather than shipping an unsigned manifest,
and normalizes the two encodings people paste the key in as. Nothing to fix
there.

## What is fixed and needs no decision

- **Ad-hoc signing of local builds** — the artifact verifies instead of reading
  as damaged. `scripts/prepare-signing.sh`; the release workflow's identity
  passes through untouched.
- **macOS permission prompts** — `src-tauri/Info.plist`. These strings appear
  verbatim in the system dialog every user meets the first time the assistant
  touches Desktop, Documents or Downloads, and they said "to open projects
  located there". Accurate about a code editor, meaningless for this product,
  and a prompt that reads as jargon is a prompt people deny. They now say what
  the assistant does with the folder.

## Known gaps that are product decisions, not bugs

Ranked by how often a real user would hit them.

1. **`.hwp` cannot be read.** On the machine this was developed on there are
   21 of them across Desktop, Documents and Downloads — more than PDF. For a
   Korean everyday assistant that is a common document, and the current answer
   is an honest refusal suggesting a re-save as PDF. `.hwpx` is a zip of XML
   and would use the same machinery `.docx` already does; `.hwp` proper is a
   compound binary and needs a library.
2. **Question cards never appear.** The component, its parser, its paging and
   free-text answers, and its tests all exist. `parseQuestions` wants a
   `[1]: question` / `a. option` shape, and nothing tells the model to produce
   one — every question the assistant asked across a day of live runs parses to
   zero cards. Fix is a tool, prompt budget (63 characters free of 2,700), or
   deleting the UI.
3. **No way to search inside files.** `laf-skills/find-file/SKILL.md` opens
   with "There is no search tool here." Finding a file the user cannot name
   means listing folders one at a time; measured at 21 tool calls to find a
   contract in Downloads. It worked — it was just expensive.
4. **`remember` fires about two-thirds of the time.** Measured across six
   phrasings: 4 of 6 after the nudge, 1 of 4 before it. The failure is silent
   within a session, because the model answers correctly from its own context
   and only forgets after a restart.
5. **The daemon socket namespace is the harness's, not ours.**
   `$TMPDIR/prime-agent-<uid>` is hardcoded upstream, so a user who also
   installs the real `prime-agent` CLI shares a socket with it. Needs a patch
   to the harness fork, a tag, and a sidecar rebuild.

## Re-checking this document

```bash
codesign --verify --deep --strict "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/LAF Agent.app" && echo "bundle signature OK"
spctl -a -vvv -t exec "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/LAF Agent.app"
curl -sI "https://github.com/LAF-labs/prime/releases/latest/download/latest.json" | head -1
```

The first should pass. The second should fail with `rejected` until a Developer
ID exists — that is the expected state, not a regression. The third should stop
being a 404 once a release is published.
