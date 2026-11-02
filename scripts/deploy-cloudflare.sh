#!/usr/bin/env bash
# Deploy public/ to Cloudflare Pages by direct upload (no Git integration needed).
# One-time: run `npx wrangler login` and sign in to your Cloudflare account.
#
# Usage: scripts/deploy-cloudflare.sh [project-name]   (default: za-calculator, or $CF_PROJECT)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="${1:-${CF_PROJECT:-za-calculator}}"

command -v npx >/dev/null 2>&1 || { echo "error: npx (Node.js) is required to run wrangler" >&2; exit 1; }

"$ROOT/scripts/build-manifest.sh"

cd "$ROOT"
npx --yes wrangler pages deploy public --project-name "$PROJECT"
