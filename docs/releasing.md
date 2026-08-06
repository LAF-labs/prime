# Releasing

## How an update reaches a user

The app checks for updates once at launch and every 30 minutes after
(`src/renderer/hooks/useUpdateChecker.ts`). When one is available,
`UpdateAvailableDialog` offers it; dismissing a version stops it being offered
again until the next one. So a user who opens the app the day after a release
is told about it without doing anything.

That only works if three things line up. All three were missing until the
updater was configured, and the checker failed silently every half hour:

1. **`pubkey`** in `src-tauri/tauri.conf.json` — the updater refuses any
   manifest it cannot verify. An empty value is not "unsigned mode"; it is a
   guaranteed failure.
2. **`endpoints`** — where to look for `latest.json`.
3. **`createUpdaterArtifacts`** in `bundle` — without it the build produces a
   DMG but no update artifacts, so there is nothing to serve.

## The signing key

Generated with `bunx tauri signer generate`. The **public** half lives in
`tauri.conf.json` and is checked in — that is what it is for. The **private**
half must never enter the repository.

It is stored outside the working tree at
`~/.laf-agent-release-keys/laf-agent-updater.key` and mirrored into GitHub
Actions secrets:

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | the contents of that file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password, or empty if it has none |

**Losing the private key is not recoverable.** Existing installs only trust
signatures from this key, so a replacement key means every user has to
re-download the app by hand. Back it up somewhere durable — a password
manager's secure-note field is the usual answer — before relying on it.

To rotate deliberately (not because it was lost), generate a new pair, ship a
release signed with the *old* key that carries the new `pubkey`, and only then
start signing with the new key. Users who skip that intermediate version will
be stranded.

## Cutting a release

```bash
bun run release
```

That bumps the version, writes the changelog, tags, and pushes. The tag
triggers `.github/workflows/release.yml`, which builds for
`aarch64-apple-darwin`, signs and notarizes, verifies the signature covers the
bundled Node and `uv` binaries, and publishes a **draft** release.

The draft is the gate. `releases/latest/download/latest.json` only serves
published releases, so nobody is offered the update until the draft is
published by hand. Check the DMG opens on a clean machine first.

## Platform

Releases target Apple Silicon only (`--target aarch64-apple-darwin`); the
sidecar ships arm64 native modules. Windows is planned but not built or
tested, and the Linux bundle targets are configured but unexercised.

## Release QA checklist

Run top to bottom for every release. Steps marked ⚙ are automatable and were
machine-verified during the v0.1.x rehearsal; steps marked 👤 need a human.

1. ⚙ CI green on the tag (typecheck, lint gate, 1.3k+ frontend tests, 320+
   Rust tests, macOS `-D warnings`).
2. ⚙ Draft release exists with: `.dmg`, `.app.tar.gz`, `.app.tar.gz.sig`,
   `latest.json`.
3. ⚙ `latest.json` sanity: `version` matches the tag, `platforms` has
   `darwin-aarch64`, the download URL points at this release's asset.
4. ⚙ Signature chain: the `.sig` verifies against the pubkey in
   `tauri.conf.json` (minisign format — `tauri signer` produced it).
5. ⚙ DMG mounts; the app inside contains the sidecar
   (`Contents/Resources/prime-agent/` with `node`, `uv`, `dist/`).
6. 👤 Fresh-account install: onboarding completes with a real API key, first
   message round-trips, app restart restores the session.
7. 👤 Update loop: with the previous version installed and this release
   published, launching the old app shows the update dialog; accepting it
   downloads, restarts, and reports the new version in About.
8. 👤 Publish the draft. Nothing is offered to users before this step.

Unsigned rehearsal drafts (no Apple secrets) will trip Gatekeeper on other
machines — right-click → Open, or `xattr -dr com.apple.quarantine`.
