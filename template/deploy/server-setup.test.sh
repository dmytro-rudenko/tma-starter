#!/usr/bin/env bash
# Exercises deploy/server-setup.sh against a throwaway root (TMA_ROOT) with stubbed
# nginx / systemctl / certbot. Run: bash deploy/server-setup.test.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
pass=0
fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { pass=$((pass + 1)); echo "ok - $*"; }

[[ -f "$here/server-setup.sh" ]] || fail "server-setup.sh missing"

# server-setup.sh reads the repo-root .env.example; a fixed copy keeps this test independent of it.
repo="$work/repo"
mkdir -p "$repo/deploy"
cp "$here/server-setup.sh" "$repo/deploy/"
cp -r "$here/nginx" "$repo/deploy/"
setup="$repo/deploy/server-setup.sh"
cat > "$repo/.env.example" <<'EOF'
BOT_TOKEN=
BOT_USERNAME=demo_bot
WEBAPP_URL=https://__DOMAIN__
WEBHOOK_SECRET=
WEBHOOK_PATH_TOKEN=
DATABASE_URL=
PORT=3100
BOT_API_ROOT=
RUN_WORKER=true
API_RATE_LIMIT=120
ADMIN_USER_IDS=
INIT_DATA_MAX_AGE_SEC=86400
EOF

# nginx -t fails when $work/nginx-fail exists and saves the site it checked as $work/seen.<n>.
mkdir -p "$work/bin"
cat > "$work/bin/nginx" <<EOF
#!/usr/bin/env bash
echo "nginx \$*" >> "$work/calls"
n="\$(grep -c '^nginx -t' "$work/calls")"
cp "\$TMA_ROOT/etc/nginx/sites-available/__DOMAIN__" "$work/seen.\$n" 2>/dev/null || true
[[ -e "$work/nginx-fail" ]] && { echo "nginx: [emerg] stub failure" >&2; exit 1; }
exit 0
EOF
cat > "$work/bin/systemctl" <<EOF
#!/usr/bin/env bash
echo "systemctl \$*" >> "$work/calls"
EOF
cat > "$work/bin/certbot" <<EOF
#!/usr/bin/env bash
echo "certbot \$*" >> "$work/calls"
d="\$TMA_ROOT/etc/letsencrypt/live/__DOMAIN__"
mkdir -p "\$d" && touch "\$d/fullchain.pem" "\$d/privkey.pem"
EOF
chmod +x "$work/bin/"*

run() {
  local root="$1"; shift
  PATH="$work/bin:$PATH" TMA_ROOT="$root" bash "$setup" "$@" > "$work/out" 2>&1
}
val() { grep -E "^$1=" "$2" | cut -d= -f2-; }

tok1='123456:AAbbCC_dd-ee'
tok2='654321:ZZyyXX_ww-vv'

R="$work/r1"; mkdir -p "$R"; : > "$work/calls"
printf '%s\n' "$tok1" | env -u BOT_TOKEN PATH="$work/bin:$PATH" TMA_ROOT="$R" bash "$setup" > "$work/out" 2>&1 \
  || { cat "$work/out"; fail "first run exited non-zero"; }
env="$R/etc/__APP_SLUG__/.env"
for d in etc/__APP_SLUG__ var/www/__APP_SLUG__ opt/__APP_SLUG__ var/backups/__APP_SLUG__; do
  [[ -d "$R/$d" ]] || fail "missing dir $d"
done
[[ "$(stat -c %a "$R/etc/__APP_SLUG__")" == 700 ]] || fail "/etc/__APP_SLUG__ not 700"
[[ "$(stat -c %a "$R/var/backups/__APP_SLUG__")" == 700 ]] || fail "/var/backups/__APP_SLUG__ not 700"
[[ -e "$R/data" ]] && fail "photo storage created: the template has no /data"
ok "directories"

[[ "$(stat -c %a "$env")" == 600 ]] || fail ".env not 600"
[[ "$(val BOT_TOKEN "$env")" == "$tok1" ]] || fail "BOT_TOKEN not set from stdin"
[[ "$(val WEBAPP_URL "$env")" == https://__DOMAIN__ ]] || fail WEBAPP_URL
[[ "$(val BOT_USERNAME "$env")" == demo_bot ]] || fail "BOT_USERNAME not kept from .env.example"
[[ "$(val PORT "$env")" == 3000 ]] || fail "PORT must be 3000, the container port compose publishes"
for k in PG_PASSWORD WEBHOOK_SECRET WEBHOOK_PATH_TOKEN; do
  [[ "$(val "$k" "$env")" =~ ^[0-9a-f]{64}$ ]] || fail "$k is not 64 hex chars"
  [[ "$(grep -c "^$k=" "$env")" == 1 ]] || fail "$k not exactly once"
done
pg="$(val PG_PASSWORD "$env")"
[[ "$(val DATABASE_URL "$env")" == "postgres://__APP_DB__:$pg@postgres:5432/__APP_DB__" ]] || fail "DATABASE_URL not literal"
[[ "$(val WEBHOOK_SECRET "$env")" != "$(val WEBHOOK_PATH_TOKEN "$env")" ]] || fail "path token == header secret"
[[ "$(val WEBHOOK_SECRET "$env")" != "$pg" ]] || fail "secrets not distinct"
grep -qx 'API_RATE_LIMIT=120' "$env" || fail "other .env.example keys dropped"
grep -qx 'RUN_WORKER=true' "$env" || fail "RUN_WORKER dropped"
grep -qx 'INIT_DATA_MAX_AGE_SEC=86400' "$env" || fail "INIT_DATA_MAX_AGE_SEC dropped"
grep -qE '^(MEDIA_SIGNING_SECRET|PHOTOS_DIR)=' "$env" && fail "photo storage keys written"
[[ "$(grep -c '^BOT_TOKEN=' "$env")" == 1 ]] || fail "BOT_TOKEN duplicated"
grep -qF "$tok1" "$work/out" && fail "token leaked to output"
ok ".env generated"

site="$R/etc/nginx/sites-available/__DOMAIN__"
link="$R/etc/nginx/sites-enabled/__DOMAIN__"
cmp -s "$site" "$here/nginx/__APP_SLUG__.conf" || fail "full HTTPS config not installed"
[[ -L "$link" && "$(readlink "$link")" == "$site" ]] || fail "sites-enabled symlink missing"
cmp -s "$work/seen.1" "$here/nginx/__APP_SLUG__-bootstrap.conf" || fail "bootstrap config not installed before the certificate"
cmp -s "$work/seen.2" "$here/nginx/__APP_SLUG__.conf" || fail "full config not checked after the certificate"
grep -q 'certbot certonly --webroot -w '"$R"'/var/www/__APP_SLUG__ -d __DOMAIN__' "$work/calls" \
  || fail "certbot webroot not called"
awk '/^nginx -t/{n++} /^certbot/{exit !(n==1)}' "$work/calls" || fail "certbot not between the two nginx checks"
[[ "$(grep -c '^nginx -t' "$work/calls")" -ge 2 ]] || fail "nginx -t not run for both configs"
[[ "$(grep -c '^systemctl reload nginx' "$work/calls")" -ge 2 ]] || fail "nginx not reloaded twice"
awk '/^nginx -t/{t=1} /^systemctl reload/{ if(!t) exit 1; t=0 }' "$work/calls" || fail "reload without nginx -t"
awk '/location \^~ \/bot\/ \{/{b=1} b&&/access_log off;/{f=1} b&&/proxy_pass http:\/\/127.0.0.1:__API_PORT__;/{p=1} b&&/^    \}/{exit} END{exit !(f&&p)}' "$site" \
  || fail "nginx: location /bot/ must proxy to the api with access_log off"
awk '/location \^~ \/api\/socket.io\/ \{/{b=1} b&&/proxy_http_version 1.1;/{v=1} b&&/proxy_pass http:\/\/127.0.0.1:__API_PORT__;/{p=1} b&&/^    \}/{exit} END{exit !(v&&p)}' "$site" \
  || fail "nginx: /api/socket.io/ must proxy websockets to the api"
awk '/location (\^~ |~ \^)?\/api\/ \{/{b=1} b&&/proxy_pass http:\/\/127.0.0.1:__API_PORT__;/{p=1} b&&/^    \}/{exit} END{exit !p}' "$site" \
  || fail "nginx: /api/ must proxy to the api"
grep -qE '^[[:space:]]*location[^{]*/media' "$site" && fail "nginx: /media location must be gone"
grep -q 'server_name __DOMAIN__;' "$site" || fail "nginx: server_name __DOMAIN__"
grep -q 'root /var/www/__APP_SLUG__;' "$site" || fail "nginx: static root /var/www/__APP_SLUG__"
ok "nginx bootstrap + certificate"

cron="$R/etc/cron.d/__APP_SLUG__-backup"
grep -q '/opt/__APP_SLUG__/deploy/backup.sh' "$cron" || fail "cron missing"
grep -qE '^30 3 \* \* \* root ' "$cron" || fail "cron line malformed"
ok "backup cron"

secrets_before="$(grep -E '^(PG_PASSWORD|WEBHOOK_SECRET|WEBHOOK_PATH_TOKEN|DATABASE_URL)=' "$env")"
cron_before="$(cat "$cron")"
: > "$work/calls"
BOT_TOKEN="$tok2" run "$R" < /dev/null || { cat "$work/out"; fail "re-run exited non-zero"; }
[[ "$(val BOT_TOKEN "$env")" == "$tok2" ]] || fail "BOT_TOKEN not replaced"
[[ "$(grep -c '^BOT_TOKEN=' "$env")" == 1 ]] || fail "BOT_TOKEN duplicated on re-run"
[[ "$(grep -E '^(PG_PASSWORD|WEBHOOK_SECRET|WEBHOOK_PATH_TOKEN|DATABASE_URL)=' "$env")" == "$secrets_before" ]] \
  || fail "secrets regenerated on re-run"
[[ "$(grep -c '^PG_PASSWORD=' "$env")" == 1 ]] || fail "PG_PASSWORD duplicated on re-run"
[[ "$(stat -c %a "$env")" == 600 ]] || fail ".env not 600 after upsert"
grep -q '^certbot' "$work/calls" && fail "certbot called although the cert exists"
[[ "$(cat "$cron")" == "$cron_before" ]] || fail "cron changed"
grep -qF "$tok2" "$work/out" && fail "token leaked on re-run"
ok "idempotent re-run, token upsert"

run "$R" < /dev/null || { cat "$work/out"; fail "run without token failed although .env has one"; }
[[ "$(val BOT_TOKEN "$env")" == "$tok2" ]] || fail "token lost when none passed"
ok "no token passed keeps existing"

bad='not a token'
BOT_TOKEN="$bad" run "$R" < /dev/null && fail "malformed token accepted"
grep -qF "$bad" "$work/out" && fail "malformed token echoed"
[[ "$(val BOT_TOKEN "$env")" == "$tok2" ]] || fail "malformed token written"
ok "malformed token rejected"

echo "# previous working config" > "$site"
: > "$work/calls"; touch "$work/nginx-fail"
run "$R" < /dev/null && fail "nginx -t failure did not fail the script"
[[ "$(cat "$site")" == "# previous working config" ]] || fail "previous nginx config not restored"
[[ -L "$link" ]] || fail "symlink removed although it existed before"
grep -q '^systemctl reload' "$work/calls" && fail "reloaded after failed nginx -t"
rm -f "$work/nginx-fail"
ok "nginx -t failure restores previous config"

R="$work/r2"; mkdir -p "$R"; touch "$work/nginx-fail"; : > "$work/calls"
BOT_TOKEN="$tok1" run "$R" < /dev/null && fail "fresh nginx failure did not fail the script"
[[ -e "$R/etc/nginx/sites-available/__DOMAIN__" ]] && fail "new site file left behind"
[[ -L "$R/etc/nginx/sites-enabled/__DOMAIN__" ]] && fail "new symlink left behind"
grep -q '^certbot' "$work/calls" && fail "certbot ran after failed nginx -t"
rm -f "$work/nginx-fail"
ok "fresh nginx failure removes our files"

R="$work/r1"
env="$R/etc/__APP_SLUG__/.env"
custom_secret="$(val WEBHOOK_SECRET "$env")"
grep -vE '^(WEBHOOK_PATH_TOKEN|INIT_DATA_MAX_AGE_SEC)=' "$env" > "$work/env.old"
sed -i 's/^API_RATE_LIMIT=.*/API_RATE_LIMIT=999/' "$work/env.old"
cp "$work/env.old" "$env"
run "$R" < /dev/null || { cat "$work/out"; fail "drift run exited non-zero"; }
[[ "$(val WEBHOOK_PATH_TOKEN "$env")" =~ ^[0-9a-f]{64}$ ]] || fail "missing WEBHOOK_PATH_TOKEN not generated"
[[ "$(val WEBHOOK_PATH_TOKEN "$env")" != "$custom_secret" ]] || fail "drift secret equals WEBHOOK_SECRET"
[[ "$(val INIT_DATA_MAX_AGE_SEC "$env")" == 86400 ]] || fail "missing INIT_DATA_MAX_AGE_SEC not appended with the example default"
[[ "$(val API_RATE_LIMIT "$env")" == 999 ]] || fail "existing API_RATE_LIMIT rewritten"
[[ "$(val WEBHOOK_SECRET "$env")" == "$custom_secret" ]] || fail "existing WEBHOOK_SECRET rewritten"
[[ "$(val BOT_TOKEN "$env")" == "$tok2" ]] || fail "BOT_TOKEN lost on drift"
[[ "$(head -n "$(wc -l < "$work/env.old")" "$env")" == "$(cat "$work/env.old")" ]] || fail "existing lines changed"
for k in WEBHOOK_PATH_TOKEN INIT_DATA_MAX_AGE_SEC PG_PASSWORD; do
  [[ "$(grep -c "^$k=" "$env")" == 1 ]] || fail "$k not exactly once after drift fix"
done
[[ "$(stat -c %a "$env")" == 600 ]] || fail ".env not 600 after drift fix"
grep -qE '[0-9a-f]{64}' "$work/out" && fail "generated secret leaked to output"
after_first="$(cat "$env")"
run "$R" < /dev/null || fail "second drift run failed"
[[ "$(cat "$env")" == "$after_first" ]] || fail "drift fix not idempotent"
ok ".env drift: missing keys appended, existing kept"

R="$work/r3"; mkdir -p "$R"
run "$R" < /dev/null && fail "first run without BOT_TOKEN succeeded"
ok "first run requires BOT_TOKEN"

echo "server-setup tests: $pass passed"
