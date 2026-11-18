#!/usr/bin/env bash
set -euo pipefail

variant="${1:-}"
case "$variant" in
  empty | shop) ;;
  *)
    echo "usage: smoke-template.sh empty|shop" >&2
    exit 2
    ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cd "$ROOT"
pnpm -r build
mkdir -p "$TMP/tarballs"
pnpm -r exec pnpm pack --pack-destination "$TMP/tarballs"

bash "$ROOT/skills/new/scaffold.sh" \
  --dir "$TMP/app" \
  --slug smoke-app \
  --title "Smoke App" \
  --bot-username smoke_app_bot \
  --domain smoke.example.com \
  --variant "$variant" \
  --tma-source "$TMP/tarballs"

cd "$TMP/app"
pnpm install --no-frozen-lockfile
pnpm db:create
pnpm db:migrate
pnpm -r typecheck
pnpm -r test
pnpm -r build

echo "smoke OK: $variant"
