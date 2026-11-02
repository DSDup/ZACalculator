#!/usr/bin/env bash
# Serve the site locally with Python's built-in web server (no Docker or Node needed).
#
# Usage: scripts/serve.sh [port]     (default port 8080, or $PORT)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-${PORT:-8080}}"

"$ROOT/scripts/build-manifest.sh" || echo "warning: some tariff files have problems (see above)" >&2

if command -v python3 >/dev/null 2>&1; then PY=python3
elif command -v python >/dev/null 2>&1; then PY=python
else echo "error: python is required to serve locally" >&2; exit 1; fi

echo "Serving http://localhost:$PORT (Ctrl+C to stop)"
exec "$PY" -m http.server "$PORT" --directory "$ROOT/public"
