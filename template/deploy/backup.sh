#!/usr/bin/env bash
# Runs on the server from cron. A failed dump never replaces (or masquerades as) a good one.
set -euo pipefail
umask 077
cd /opt/__APP_SLUG__/deploy

dest=/var/backups/__APP_SLUG__
mkdir -p -m 700 "$dest"
chmod 700 "$dest"

out="$dest/db-$(date +%F).sql.gz"
tmp="$out.tmp"
trap 'rm -f "$tmp"' EXIT

docker compose --env-file /etc/__APP_SLUG__/.env exec -T postgres pg_dump -U __APP_DB__ __APP_DB__ \
  | gzip > "$tmp"
mv "$tmp" "$out"

find "$dest" -name 'db-*.sql.gz' -mtime +14 -delete
