#!/usr/bin/env bash
# Detach our own disk images before bundling.
#
# `bundle_dmg.sh` attaches a scratch volume and then a volume named after the
# app. Either one still mounted from a previous build — or from installing the
# last DMG by hand — makes the next build fail with nothing but "error running
# bundle_dmg.sh", which says nothing about a mount.
#
# Only volumes this project creates are touched: the app's own name and the
# `dmg.XXXXXX` scratch images that bundle_dmg.sh leaves behind when it dies.
set -euo pipefail

APP_NAME="LAF Agent"

detach() {
  local volume="$1"
  [ -d "$volume" ] || return 0
  echo "==> Detaching stale volume: $volume"
  hdiutil detach "$volume" -force >/dev/null 2>&1 \
    || echo "    could not detach $volume — eject it in Finder and build again" >&2
}

detach "/Volumes/$APP_NAME"
for scratch in /Volumes/dmg.*; do
  detach "$scratch"
done
