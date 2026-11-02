#!/usr/bin/env bash
# Rebuilds public/data/index.json (the list of tariff files the browser loads).
# No Node needed. If `jq` is installed, every file is also checked for valid JSON
# and the required fields (displayName, type, unit, bands).
#
# Usage: scripts/build-manifest.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT/public/data"

files=()
shopt -s nullglob
for f in "$DATA_DIR"/*.json; do
  name="$(basename "$f")"
  [ "$name" = "index.json" ] && continue
  files+=("$name")
done
shopt -u nullglob

failed=0
if command -v jq >/dev/null 2>&1; then
  for name in "${files[@]+"${files[@]}"}"; do
    if ! jq -e '(.displayName|type=="string") and (.type|type=="string") and (.unit|type=="string") and ((.bands|type=="array") and (.bands|length>0))' \
        "$DATA_DIR/$name" >/dev/null 2>&1; then
      echo "error: $name is not valid JSON or is missing displayName, type, unit or bands" >&2
      failed=1
    fi
  done
else
  echo "note: jq not found, skipping validation (install jq to check your JSON)" >&2
fi

{
  printf '{\n  "files": ['
  first=1
  for name in "${files[@]+"${files[@]}"}"; do
    if [ "$first" -eq 1 ]; then first=0; else printf ','; fi
    printf '\n    "%s"' "$name"
  done
  printf '\n  ]\n}\n'
} > "$DATA_DIR/index.json"

echo "Wrote public/data/index.json with ${#files[@]} file(s)."
exit "$failed"
