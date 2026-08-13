#!/usr/bin/env bash
# Build the bundled agent-harness sidecar into src-tauri/resources/prime-agent.
#
# The harness is built from LAF's own fork (LAF-labs/prime-harness) at a
# PINNED ref, never from a moving branch. This is what makes releases
# reproducible and decouples us from upstream's cadence: upstream releases
# land in the fork only when we merge them (see scripts/harness-upstream.sh).
# To take a new harness version: merge/tag in the fork, bump HARNESS_REF and
# HARNESS_SHA here, rebuild, commit both together.
#
# The sidecar is an npm-package-shaped folder:
#   node                  — Node.js runtime (>= 22.8, arm64)
#   package.json          — {"type":"module"} + native deps
#   dist/                 — agent harness compiled output (bundle/cli.js entry)
#   node_modules/         — native modules the bundle keeps external
#                           (zeromq, koffi, undici, photon-node, clipboard, cmake-ts)
#
# The app spawns: <resources>/lafagent/node dist/bundle/cli.js --mode rpc
#
# Note: the bun-compiled standalone binary (dist/pi) is NOT used — zeromq's
# NAPI addon calls uv_async_init, which Bun does not support yet
# (https://github.com/oven-sh/bun/issues/18546).

set -euo pipefail

HARNESS_REPO="${HARNESS_REPO:-https://github.com/LAF-labs/prime-harness}"
# The single source of truth for which harness this app ships.
HARNESS_REF="${HARNESS_REF:-v0.7.0-laf.5}"
# Commit the tag above is expected to resolve to. Tags are movable; this pin
# is not. The build fails if the clone resolves elsewhere. When bumping
# HARNESS_REF, update this in the same change (or set HARNESS_SHA="" for a
# one-off unpinned build) — the new value ends up in HARNESS.json either way.
HARNESS_SHA="${HARNESS_SHA-7c3f01c68387b6776d684f76632e08d2e8bcfb9c}"
# Major version of the Node runtime the sidecar is allowed to ship. The
# binary is copied from the build machine, so without this the shipped
# runtime would silently float with whatever the runner has installed.
NODE_VERSION_EXPECTED="${NODE_VERSION_EXPECTED:-22}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO_ROOT/src-tauri/resources/lafagent"

# Guard the Node runtime before spending minutes on the build: the same
# binary that runs npm below is the one that ships in the sidecar.
NODE_BIN="$(readlink -f "$(which node)")"
NODE_VERSION="$("$NODE_BIN" --version)"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
if [[ "$NODE_MAJOR" != "$NODE_VERSION_EXPECTED" ]]; then
  echo "error: build machine has Node ${NODE_VERSION}, expected major ${NODE_VERSION_EXPECTED}" >&2
  echo "       (override with NODE_VERSION_EXPECTED=${NODE_MAJOR} if the bump is intentional)" >&2
  exit 1
fi

echo "==> Cloning harness at ${HARNESS_REF}"
git clone --quiet --branch "$HARNESS_REF" --depth 1 "$HARNESS_REPO" "$WORK/prime-agent"
HARNESS_SHA_ACTUAL="$(git -C "$WORK/prime-agent" rev-parse HEAD)"
if [[ -n "$HARNESS_SHA" && "$HARNESS_SHA_ACTUAL" != "$HARNESS_SHA" ]]; then
  echo "error: ${HARNESS_REF} resolved to ${HARNESS_SHA_ACTUAL}, expected ${HARNESS_SHA}" >&2
  echo "       The tag has moved (or the pin is stale). Verify the fork's history," >&2
  echo "       then update HARNESS_SHA in this script." >&2
  exit 1
fi

echo "==> Installing monorepo deps"
cd "$WORK/prime-agent"
npm install

echo "==> Building all workspace packages"
# The root build script compiles the packages in dependency order
# (tui → ai → agent → coding-agent). Building coding-agent alone fails on
# tagged releases because its siblings' dist/ and type declarations don't
# exist yet.
npm run build
cd packages/coding-agent

echo "==> Assembling sidecar"
rm -rf "$OUT"
mkdir -p "$OUT"

# Native deps stay external to the JS bundle — pin to the versions the
# monorepo resolved.
node - "$OUT" <<'EOF'
const fs = require('fs');
const out = process.argv[2];
const root = require(process.cwd() + '/../../package.json');
const ver = (m) => require(`${process.cwd()}/../../node_modules/${m}/package.json`).version;
const pkg = {
  name: 'laf-agent-sidecar',
  version: require(process.cwd() + '/package.json').version,
  private: true,
  type: 'module',
  // Names the harness answers to: its config directory (~/.lafagent), its
  // LAFAGENT_* environment switches, and the kernel venv underneath. Without
  // this the app would write its users' credentials into another product's
  // dotfile. See docs/sidecar-architecture.md.
  piConfig: { name: 'lafagent', configDir: '.lafagent' },
  dependencies: {
    ...Object.fromEntries(
      ['zeromq', 'koffi', 'undici', '@silvia-odwyer/photon-node', '@mariozechner/clipboard']
        .map((m) => [m, ver(m)])
    ),
    // OS-level bash sandbox used by the LAF gate (sandbox-exec / bubblewrap).
    // Not a harness dependency — pinned here, resolved by the gate at runtime.
    '@anthropic-ai/sandbox-runtime': '0.0.70',
    // Article extraction for the gate's web_fetch. Readability is the library
    // behind Firefox Reader View; linkedom gives it a DOM without pulling in
    // jsdom. Both resolved by the gate at runtime, like the sandbox above.
    //
    // This replaced a hand-written regex stripper. Measured on the same pages:
    // Wikipedia 1,011 KB -> 79 KB of prose with a title, and a Korean wiki
    // 462 KB -> 7 KB that the regex version could not extract at all.
    '@mozilla/readability': '0.6.0',
    'linkedom': '0.18.13',
    // Document text extraction for the gate's read_file. The people this app
    // is for keep their work in PDFs, Word files and spreadsheets, and until
    // these were here "summarize this report" answered "this file is not
    // text". One library per format, each doing nothing else, all loaded
    // lazily so a session that opens no documents pays nothing.
    'unpdf': '1.8.0',
    'mammoth': '1.12.1',
    'read-excel-file': '9.3.9',
    // .hwp is the ordinary document format in Korea and the second most common
    // one on the machine this was built for — 55 of them against 20 PDFs. It is
    // a compound binary rather than a zip of XML, so it needs a parser instead
    // of the unzip path the others share. Naver's, Apache-2.0, +4 MB, and it
    // read all 55 with the Hangul character count matching the same document's
    // PDF export exactly.
    'hwp.js': '0.0.3',
  },
};
fs.writeFileSync(`${out}/package.json`, JSON.stringify(pkg, null, 1));
EOF

cd "$OUT"
npm install --omit=dev --no-audit --no-fund
# zeromq loads its addon through cmake-ts/build/loader at runtime.
cp -r "$WORK/prime-agent/node_modules/cmake-ts" node_modules/cmake-ts

# Source maps are debugger-only: Node reads them for a stack trace exclusively
# under --enable-source-maps, which the sidecar never runs with. dist/ has been
# stripped since the beginning; node_modules had not been, and shipped ~10 MB of
# them (cmake-ts alone carries 4.7 MB).
find node_modules -name '*.map' -type f -delete

cp -r "$WORK/prime-agent/packages/coding-agent/dist" dist
rm -f dist/package.json      # inner package.json would break asset-root resolution
rm -rf dist/pi dist/bun dist/docs dist/examples
find dist -name '*.map' -delete
find dist -name '*.d.ts' -delete

# Keep only darwin-arm64 native prebuilds.
find node_modules/koffi/build/koffi -maxdepth 1 -type d ! -name koffi ! -name darwin_arm64 -exec rm -rf {} +
find node_modules/zeromq/build -maxdepth 1 -type d ! -name build ! -name darwin -exec rm -rf {} +
rm -rf node_modules/zeromq/build/darwin/x64

echo "==> Bundling Node runtime (${NODE_VERSION})"
cp "$NODE_BIN" node

# No uv, and no Python.
#
# uv was here to build ~/.lafagent/kernel-venv, the virtualenv behind the
# harness's `ipython` tool. The app spawns the agent with `--no-builtin-tools`,
# which removes that tool, so nothing ever asked uv for anything — it was a
# 44 MB static binary shipped to every user, plus a first-run CPython download
# on their network, for a feature the product does not have.
#
# If ipython ever comes back, so does this block: fetch the release asset,
# verify it against the .sha256 published beside it, and extract. Do not
# curl|tar an unauthenticated tarball into a binary that ships inside the app.

# The gate extension lives INSIDE the sidecar so its value imports resolve
# against the sidecar's node_modules (sandbox-runtime above). The tracked
# source stays at src-tauri/resources/laf-agent-gate.ts; this copy is what
# the app actually loads (agent_launch::gate resolution prefers it).
cp "$REPO_ROOT/src-tauri/resources/laf-agent-gate.ts" "$OUT/laf-gate.ts"

# Provenance: which harness this sidecar was built from. The app surfaces
# this in Settings ("Harness vX.Y.Z") and support asks for it first.
cat > "$OUT/HARNESS.json" <<EOF
{
  "ref": "${HARNESS_REF}",
  "commit": "${HARNESS_SHA_ACTUAL}",
  "repo": "${HARNESS_REPO}",
  "node": "${NODE_VERSION}",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "==> Done: $(du -sh "$OUT" | cut -f1) at $OUT (harness ${HARNESS_REF} @ ${HARNESS_SHA_ACTUAL:0:8})"
