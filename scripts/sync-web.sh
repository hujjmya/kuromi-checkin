#!/usr/bin/env bash
# Copy web/ into Android assets without a full Gradle build.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/android/app/src/main/assets"
rm -rf "$DEST"
mkdir -p "$DEST"
cp "$ROOT/web/index.html" "$DEST/"
cp -R "$ROOT/web/css" "$ROOT/web/js" "$ROOT/web/fonts" "$DEST/"
echo "Synced web/ -> android/app/src/main/assets/"
