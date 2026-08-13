#!/usr/bin/env bash
# Make sure the bundle gets *a* signature, even when nobody has a Developer ID.
#
# Tauri signs the .app only when it is given an identity. With none, it leaves
# the bundle unsigned while the linker's own ad-hoc signature stays on the
# binary inside it — and that combination is not "unsigned", it is broken:
#
#   $ codesign --verify --deep --strict "LAF Agent.app"
#   code has no resources but signature indicates they must be present
#
# macOS treats that as a damaged app. It is not the ordinary "unidentified
# developer" warning a tester can click past; there is no _CodeSignature
# directory at all, so the right-click-Open escape hatch has nothing to
# validate. Every DMG this project has built so far was in that state.
#
# Signing ad hoc costs nothing and fixes the verification. Gatekeeper still
# refuses it on another machine — only a Developer ID and notarization change
# that, and that is a purchase, not a patch — but the artifact becomes a real
# app that installs with a warning instead of one the system calls corrupt.
#
# Only fills the variable in when it is empty, so the release workflow's real
# identity passes through untouched. Print what was decided: a build that
# quietly ad-hoc signs when it was supposed to use a Developer ID is exactly
# the silent downgrade worth being loud about.

set -euo pipefail

if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
	echo "[signing] using APPLE_SIGNING_IDENTITY from the environment"
	exit 0
fi

echo "[signing] no APPLE_SIGNING_IDENTITY set — signing ad hoc."
echo "[signing] The result runs on this machine and is NOT distributable:"
echo "[signing] Gatekeeper on another Mac will refuse it until it is signed"
echo "[signing] with a Developer ID and notarized. See docs/release-readiness.md."
