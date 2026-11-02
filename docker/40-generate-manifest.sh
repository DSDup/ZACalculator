#!/bin/sh
# Runs on every container start (nginx image executes /docker-entrypoint.d/*.sh).
# Rebuilds data/index.json so files mounted or copied into /data show up without a rebuild.
set -eu

DIR=/usr/share/nginx/html/data
cd "$DIR"

{
  printf '{\n  "files": ['
  first=1
  for f in *.json; do
    [ -e "$f" ] || continue
    [ "$f" = "index.json" ] && continue
    if [ "$first" -eq 1 ]; then first=0; else printf ','; fi
    printf '\n    "%s"' "$f"
  done
  printf '\n  ]\n}\n'
} > index.json.tmp && mv index.json.tmp index.json \
  || echo "generate-manifest: could not write $DIR/index.json (read-only mount?). Using the existing file."
