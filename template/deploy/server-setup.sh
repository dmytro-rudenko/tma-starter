#!/usr/bin/env bash
# Runs ON THE SERVER (deploy.sh calls it on every deploy; safe to re-run).
# The host nginx serves other sites too: every change is checked with `nginx -t` first and
# rolled back if it fails, and only our own site file and symlink are ever touched.
# TMA_ROOT (tests only) prefixes every absolute path; empty in production.
set -euo pipefail
umask 022

R="${TMA_ROOT:-}"
here="$(cd "$(dirname "$0")" && pwd)"
env_example="$here/../.env.example"
domain=__DOMAIN__
etc="$R/etc/__APP_SLUG__"
env_file="$etc/.env"
webroot="$R/var/www/__APP_SLUG__"
site="$R/etc/nginx/sites-available/$domain"
link="$R/etc/nginx/sites-enabled/$domain"
cert="$R/etc/letsencrypt/live/$domain/fullchain.pem"
cron_file="$R/etc/cron.d/__APP_SLUG__-backup"

die() { echo "server-setup.sh: $*" >&2; exit 1; }

token="${BOT_TOKEN:-}"
unset BOT_TOKEN
if [[ -z "$token" && ! -t 0 ]]; then
  IFS= read -r token || true
fi
token="${token%$'\r'}"
if [[ -n "$token" && ! "$token" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]]; then
  die "BOT_TOKEN has an unexpected format (expected <digits>:<chars>); not written"
fi

mkdir -p "$etc" "$webroot" "$R/opt/__APP_SLUG__" "$R/var/backups/__APP_SLUG__" \
  "$R/etc/nginx/sites-available" "$R/etc/nginx/sites-enabled" "$R/etc/cron.d"
chmod 700 "$etc" "$R/var/backups/__APP_SLUG__"

if [[ ! -e "$env_file" ]]; then
  [[ -r "$env_example" ]] || die "missing $env_example"
  pg="$(openssl rand -hex 32)"
  tmp="$(mktemp "$etc/.env.XXXXXX")"
  # Values reach awk through ENVIRON, not argv.
  PG_PASSWORD="$pg" \
  WEBHOOK_SECRET="$(openssl rand -hex 32)" \
  WEBHOOK_PATH_TOKEN="$(openssl rand -hex 32)" \
  DATABASE_URL="postgres://__APP_DB__:$pg@postgres:5432/__APP_DB__" \
  WEBAPP_URL="https://$domain" \
  PORT=3000 \
  awk '
    BEGIN {
      n = split("PG_PASSWORD WEBHOOK_SECRET WEBHOOK_PATH_TOKEN DATABASE_URL WEBAPP_URL PORT", ks, " ")
      for (i = 1; i <= n; i++) set[ks[i]] = ENVIRON[ks[i]]
    }
    match($0, /^[A-Z][A-Z0-9_]*=/) {
      k = substr($0, 1, RLENGTH - 1)
      if (k in set) { print k "=" set[k]; seen[k] = 1; next }
    }
    { print }
    END { for (i = 1; i <= n; i++) if (!(ks[i] in seen)) print ks[i] "=" set[ks[i]] }
  ' "$env_example" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$env_file"
  echo "created $env_file with fresh secrets"
fi
chmod 600 "$env_file"

# The API refuses to boot without new required keys, so every key of .env.example missing
# from .env is appended. Existing lines are never rewritten; values never reach output.
[[ -r "$env_example" ]] || die "missing $env_example"
random_keys=" WEBHOOK_SECRET WEBHOOK_PATH_TOKEN "
tmp="$(mktemp "$etc/.env.XXXXXX")"
cat "$env_file" > "$tmp"
if [[ -s "$tmp" && "$(tail -c 1 "$tmp")" != "" ]]; then echo >> "$tmp"; fi
added=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^([A-Z][A-Z0-9_]*)= ]] || continue
  k="${BASH_REMATCH[1]}"
  grep -qE "^$k=" "$tmp" && continue
  if [[ "$random_keys" == *" $k "* ]]; then
    printf '%s=%s\n' "$k" "$(openssl rand -hex 32)" >> "$tmp"
  else
    printf '%s\n' "$line" >> "$tmp"
  fi
  added+=("$k")
done < "$env_example"
if ((${#added[@]})); then
  chmod 600 "$tmp"
  mv "$tmp" "$env_file"
  echo "added to $env_file: ${added[*]}"
else
  rm -f "$tmp"
fi

if [[ -n "$token" ]]; then
  tmp="$(mktemp "$etc/.env.XXXXXX")"
  T="$token" awk '
    /^BOT_TOKEN=/ { if (!done) print "BOT_TOKEN=" ENVIRON["T"]; done = 1; next }
    { print }
    END { if (!done) print "BOT_TOKEN=" ENVIRON["T"] }
  ' "$env_file" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$env_file"
  echo "BOT_TOKEN updated"
elif ! grep -qE '^BOT_TOKEN=.+' "$env_file"; then
  die "BOT_TOKEN is empty in $env_file and none was passed (env BOT_TOKEN or stdin)"
fi
unset token T

install_site() {
  local src="$1" had_file=0 had_link=0 backup="$etc/nginx-site.bak"
  if [[ -L "$link" || -e "$link" ]]; then had_link=1; fi
  if ((had_link)) && cmp -s "$src" "$site"; then
    return 0
  fi
  if [[ -e "$site" ]]; then had_file=1; cp -p "$site" "$backup"; fi

  install -m 644 "$src" "$site.__APP_SLUG__-new"
  mv "$site.__APP_SLUG__-new" "$site"
  ln -sfn "$site" "$link"

  if nginx -t; then
    systemctl reload nginx
    rm -f "$backup"
    echo "nginx: installed $(basename "$src") as $site"
  else
    if ((had_file)); then mv "$backup" "$site"; else rm -f "$site"; fi
    if ((!had_link)); then rm -f "$link"; fi
    die "nginx -t failed with $(basename "$src"); previous config restored, nginx not reloaded"
  fi
}

if [[ ! -e "$cert" ]]; then
  install_site "$here/nginx/__APP_SLUG__-bootstrap.conf"
  certbot certonly --webroot -w "$webroot" -d "$domain" \
    --non-interactive --agree-tos --register-unsafely-without-email \
    --deploy-hook 'systemctl reload nginx'
  [[ -e "$cert" ]] || die "certbot did not produce $cert"
fi
install_site "$here/nginx/__APP_SLUG__.conf"

cron_line='30 3 * * * root bash /opt/__APP_SLUG__/deploy/backup.sh >> /var/log/__APP_SLUG__-backup.log 2>&1'
if [[ "$(cat "$cron_file" 2>/dev/null)" != "$cron_line" ]]; then
  tmp="$(mktemp "$R/etc/cron.d/.__APP_SLUG__-backup.XXXXXX")"
  printf '%s\n' "$cron_line" > "$tmp"
  chmod 644 "$tmp"
  mv "$tmp" "$cron_file"
  echo "installed $cron_file"
fi

echo "server setup ok"
