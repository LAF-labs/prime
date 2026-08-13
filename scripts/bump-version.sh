#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/bump-version.sh <major|minor|patch|x.y.z>
# Examples:
#   ./scripts/bump-version.sh patch   → 0.7.0 → 0.7.1
#   ./scripts/bump-version.sh minor   → 0.7.0 → 0.8.0
#   ./scripts/bump-version.sh major   → 0.7.0 → 1.0.0
#   ./scripts/bump-version.sh 1.2.3   → sets to 1.2.3 exactly

CURRENT=$(grep '"version"' package.json | head -1 | sed 's/.*"\([0-9]*\.[0-9]*\.[0-9]*\)".*/\1/')
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "${1:-}" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
  [0-9]*.[0-9]*.[0-9]*) IFS='.' read -r MAJOR MINOR PATCH <<< "$1" ;;
  *)
    echo "Usage: $0 <major|minor|patch|x.y.z>"
    echo "Current version: $CURRENT"
    exit 1
    ;;
esac

NEW="$MAJOR.$MINOR.$PATCH"

if [ "$NEW" = "$CURRENT" ]; then
  echo "Already at $CURRENT"
  exit 0
fi

echo "Bumping $CURRENT → $NEW"

# Substitute-and-verify. Each sed matches the CURRENT version taken from
# package.json — so a file that has drifted to some other version matches
# nothing, sed exits 0 anyway, and the bump "succeeds" while leaving that file
# behind. That is not hypothetical: Cargo.toml sat at 0.1.0 through the 0.1.1
# bump, and nothing said so. Grep for the NEW version afterwards and stop the
# release on the spot instead.
bump_file() {
  local file="$1" pattern="$2" replacement="$3"
  sed -i '' "$pattern" "$file"
  if ! grep -q "$replacement" "$file"; then
    echo "error: $file still lacks version $NEW after the bump." >&2
    echo "       Its version line no longer matches package.json's $CURRENT —" >&2
    echo "       fix the drift by hand, then re-run." >&2
    exit 1
  fi
}

# 1. package.json
bump_file package.json "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW\"/" "\"version\": \"$NEW\""

# 2. src-tauri/Cargo.toml (only the first version line)
bump_file src-tauri/Cargo.toml "0,/^version = \"$CURRENT\"/s//version = \"$NEW\"/" "^version = \"$NEW\""

# 3. src-tauri/tauri.conf.json
bump_file src-tauri/tauri.conf.json "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW\"/" "\"version\": \"$NEW\""

# 4. Update Cargo.lock
(cd src-tauri && cargo update -p laf-agent 2>/dev/null || true)

echo ""
echo "Updated:"
echo "  package.json          → $NEW"
echo "  src-tauri/Cargo.toml  → $NEW"
echo "  src-tauri/tauri.conf.json → $NEW"
echo ""
echo "Next steps:"
echo "  git add -A && git commit -m \"chore: bump version to $NEW\""
echo "  git tag v$NEW && git push origin main --tags"
