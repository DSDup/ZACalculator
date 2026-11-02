#!/usr/bin/env bash
# Run and maintain the calculator with Docker Compose.
#
# Usage: scripts/docker.sh <command>
#   up       build the image if needed and start the site in the background (default)
#   update   after changing code or tariff files: rebuild the image and restart
#   restart  restart only (enough after adding or editing files in public/data/)
#   logs     follow the container logs
#   status   show container state
#   down     stop and remove the container
#
# Set PORT to change the host port (default 8080), e.g.  PORT=9000 scripts/docker.sh up
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  echo "error: Docker Compose is not installed" >&2
  exit 1
fi

cmd="${1:-up}"
case "$cmd" in
  up)
    scripts/build-manifest.sh || echo "warning: some tariff files have problems (see above)" >&2
    "${DC[@]}" up -d --build
    echo "Running at http://localhost:${PORT:-8080}"
    ;;
  update)
    scripts/build-manifest.sh || echo "warning: some tariff files have problems (see above)" >&2
    "${DC[@]}" build --pull
    "${DC[@]}" up -d
    echo "Updated. Running at http://localhost:${PORT:-8080}"
    ;;
  restart) "${DC[@]}" restart ;;
  logs)    "${DC[@]}" logs -f ;;
  status)  "${DC[@]}" ps ;;
  down)    "${DC[@]}" down ;;
  *)
    echo "Unknown command: $cmd" >&2
    sed -n '2,12p' "${BASH_SOURCE[0]}" >&2
    exit 1
    ;;
esac
