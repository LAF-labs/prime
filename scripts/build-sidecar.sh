#!/usr/bin/env bash
# Build the bundled prime-agent sidecar into src-tauri/resources/prime-agent.
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

PRIME_AGENT_REPO="${PRIME_AGENT_REPO:-https://github.com/PrimeIntellect-ai/prime-agent}"
WORK="$(mktemp -d)"
OUT="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/resources/prime-agent"

echo "==> Cloning prime-agent"
git clone --depth 1 "$PRIME_AGENT_REPO" "$WORK/prime-agent"

echo "==> Installing monorepo deps"
cd "$WORK/prime-agent"
npm install

echo "==> Building coding-agent"
cd packages/coding-agent
npm run build   # tsgo compile + copy-assets (theme, export-html, runtime, skills) + bundle

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
  dependencies: Object.fromEntries(
    ['zeromq', 'koffi', 'undici', '@silvia-odwyer/photon-node', '@mariozechner/clipboard']
      .map((m) => [m, ver(m)])
  ),
};
fs.writeFileSync(`${out}/package.json`, JSON.stringify(pkg, null, 1));
EOF

cd "$OUT"
npm install --omit=dev --no-audit --no-fund
# zeromq loads its addon through cmake-ts/build/loader at runtime.
cp -r "$WORK/prime-agent/node_modules/cmake-ts" node_modules/cmake-ts

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

echo "==> Done: $(du -sh "$OUT" | cut -f1) at $OUT"
