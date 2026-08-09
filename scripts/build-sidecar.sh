#!/usr/bin/env bash
# Build the bundled agent-harness sidecar into src-tauri/resources/prime-agent.
#
# The harness is built from LAF's own fork (LAF-labs/prime-harness) at a
# PINNED ref, never from a moving branch. This is what makes releases
# reproducible and decouples us from upstream's cadence: upstream releases
# land in the fork only when we merge them (see scripts/harness-upstream.sh).
# To take a new harness version: merge/tag in the fork, bump HARNESS_REF here,
# rebuild, commit both together.
#
# The sidecar is an npm-package-shaped folder:
#   node                  — Node.js runtime (>= 22.8, arm64)
#   package.json          — {"type":"module"} + native deps
#   dist/                 — prime-agent compiled output (bundle/cli.js entry)
#   node_modules/         — native modules the bundle keeps external
#                           (zeromq, koffi, undici, photon-node, clipboard, cmake-ts)
#
# The app spawns: <resources>/prime-agent/node dist/bundle/cli.js --mode rpc
#
# Note: the bun-compiled standalone binary (dist/pi) is NOT used — zeromq's
# NAPI addon calls uv_async_init, which Bun does not support yet
# (https://github.com/oven-sh/bun/issues/18546).

set -euo pipefail

HARNESS_REPO="${HARNESS_REPO:-https://github.com/LAF-labs/prime-harness}"
# The single source of truth for which harness this app ships.
HARNESS_REF="${HARNESS_REF:-v0.7.0}"
WORK="$(mktemp -d)"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO_ROOT/src-tauri/resources/prime-agent"

echo "==> Cloning harness at ${HARNESS_REF}"
git clone --quiet --branch "$HARNESS_REF" --depth 1 "$HARNESS_REPO" "$WORK/prime-agent"
HARNESS_SHA="$(git -C "$WORK/prime-agent" rev-parse HEAD)"

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
  piConfig: { name: 'prime-agent', configDir: '.prime/agent' },
  dependencies: {
    ...Object.fromEntries(
      ['zeromq', 'koffi', 'undici', '@silvia-odwyer/photon-node', '@mariozechner/clipboard']
        .map((m) => [m, ver(m)])
    ),
    // OS-level bash sandbox used by the LAF gate (sandbox-exec / bubblewrap).
    // Not a harness dependency — pinned here, resolved by the gate at runtime.
    '@anthropic-ai/sandbox-runtime': '0.0.70',
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

echo "==> Bundling Node runtime"
cp "$(readlink -f "$(which node)")" node

# uv is prime-agent's only Python installer: it fetches a standalone CPython
# and builds ~/.prime/agent/kernel-venv on first run. Bundling the single
# static binary means a fresh machine needs no Python and no uv install step
# — the app just needs network for the one-time kernel setup.
echo "==> Bundling uv"
UV_VERSION="${UV_VERSION:-0.10.2}"
case "$(uname -m)" in
  arm64|aarch64) UV_TARGET="aarch64-apple-darwin" ;;
  x86_64)        UV_TARGET="x86_64-apple-darwin" ;;
  *) echo "unsupported arch $(uname -m)" >&2; exit 1 ;;
esac
UV_URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${UV_TARGET}.tar.gz"
curl -fsSL "$UV_URL" | tar -xz -C "$WORK"
cp "$WORK/uv-${UV_TARGET}/uv" uv
chmod +x uv

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
  "commit": "${HARNESS_SHA}",
  "repo": "${HARNESS_REPO}",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "==> Done: $(du -sh "$OUT" | cut -f1) at $OUT (harness ${HARNESS_REF} @ ${HARNESS_SHA:0:8})"
