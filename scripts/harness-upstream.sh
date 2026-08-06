#!/usr/bin/env bash
# Show what upstream prime-agent has shipped since the harness ref we bundle.
#
# LAF Agent builds its sidecar from LAF-labs/prime-harness at the pinned
# HARNESS_REF in build-sidecar.sh — never from upstream directly. Upstream
# moves fast (40 releases and counting); this script is how we look before
# deciding to follow.
#
# Usage:
#   scripts/harness-upstream.sh            # summary: releases + commit log since our ref
#   scripts/harness-upstream.sh --diff     # full diff against upstream's latest tag
#
# Taking an update is deliberate, in the fork, never here:
#   1. In a prime-harness clone: git fetch upstream --tags
#   2. Merge the upstream tag into main (resolve against our harness patches)
#   3. Tag the result (e.g. v0.8.0-laf.1) and push with --tags
#   4. Bump HARNESS_REF in build-sidecar.sh, rebuild the sidecar, run the app,
#      commit the sidecar + ref bump together.

set -euo pipefail

UPSTREAM="https://github.com/PrimeIntellect-ai/prime-agent"
FORK="https://github.com/LAF-labs/prime-harness"

# Read the pinned ref straight from the build script so this never drifts.
PINNED="$(sed -n 's/^HARNESS_REF="\${HARNESS_REF:-\(.*\)}"$/\1/p' "$(dirname "$0")/build-sidecar.sh")"
[ -n "$PINNED" ] || { echo "could not read HARNESS_REF from build-sidecar.sh" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> Bundled harness: ${PINNED} (from ${FORK})"
git clone --quiet --filter=blob:none --no-checkout "$UPSTREAM" "$WORK/up"
cd "$WORK/up"
git fetch --quiet --tags

LATEST="$(git tag --sort=-v:refname | head -1)"
echo "==> Upstream latest:  ${LATEST}"

if [ "$LATEST" = "$PINNED" ]; then
  echo "==> Up to date."
  exit 0
fi

COUNT="$(git rev-list "${PINNED}..${LATEST}" --count 2>/dev/null || echo '?')"
echo
echo "==> ${COUNT} commits between ${PINNED} and ${LATEST}:"
echo
git log --oneline --no-decorate "${PINNED}..${LATEST}" | head -60

echo
echo "==> Files touched:"
git diff --stat "${PINNED}" "${LATEST}" | tail -1

if [ "${1:-}" = "--diff" ]; then
  echo
  git diff "${PINNED}" "${LATEST}"
fi
