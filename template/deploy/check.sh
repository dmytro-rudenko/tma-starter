#!/usr/bin/env bash
# Static checks for the deploy artifacts. Run from anywhere: bash deploy/check.sh
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "deploy check failed: $*" >&2; exit 1; }

required=(
  apps/api/Dockerfile apps/api/bot/profile.json deploy/docker-compose.yml
  deploy/nginx/__APP_SLUG__.conf deploy/nginx/__APP_SLUG__-bootstrap.conf
  deploy/deploy.sh deploy/backup.sh deploy/server-setup.sh deploy/README.md
  .env.example .github/workflows/deploy.yml
)
for f in "${required[@]}"; do
  [[ -f "$f" ]] || fail "missing $f"
done
[[ -e deploy/set-webhook.sh ]] && fail "deploy/set-webhook.sh must not exist: tma-bot setup replaces it"

for f in deploy/*.sh; do
  bash -n "$f" || fail "syntax error in $f"
done

if docker compose version >/dev/null 2>&1; then
  sed "s#/etc/__APP_SLUG__/.env#$PWD/.env.example#" deploy/docker-compose.yml > deploy/.compose-check.yml
  trap 'rm -f deploy/.compose-check.yml' EXIT
  if ! out="$(PG_PASSWORD=check docker compose -f deploy/.compose-check.yml config -q 2>&1)"; then
    if grep -qiE 'cannot connect|daemon' <<<"$out"; then
      echo "skip: docker compose config could not reach a daemon"
    else
      echo "$out" >&2
      fail "docker compose config"
    fi
  fi
else
  echo "skip: docker compose not available"
fi

conf=deploy/nginx/__APP_SLUG__.conf
grep -q 'client_max_body_size 10m' "$conf" || fail "client_max_body_size 10m missing"
grep -q 'server_name __DOMAIN__' "$conf" || fail "server_name missing"
grep -q 'try_files $uri /index.html' "$conf" || fail "try_files missing"
grep -q 'proxy_pass http://127.0.0.1:__API_PORT__;' "$conf" || fail "proxy_pass to 127.0.0.1:__API_PORT__ missing"
grep -q 'ssl_certificate /etc/letsencrypt/live/__DOMAIN__/fullchain.pem' "$conf" \
  || fail "nginx ssl_certificate missing"
grep -q 'location /.well-known/acme-challenge/' "$conf" || fail "ACME location missing (webroot renewals)"
grep -q 'location /.well-known/acme-challenge/' deploy/nginx/__APP_SLUG__-bootstrap.conf \
  || fail "__APP_SLUG__-bootstrap.conf must serve the ACME challenge"

grep -q 'location ^~ /api/socket.io/ {' "$conf" || fail "nginx: socket.io location missing"
grep -q 'proxy_set_header Upgrade $http_upgrade;' "$conf" || fail "nginx: websocket Upgrade header missing"
grep -q 'proxy_set_header Connection "upgrade";' "$conf" || fail "nginx: websocket Connection header missing"
grep -q 'location ^~ /bot/ {' "$conf" || fail "nginx: /bot/ location missing"

grep -qE 'location = /index.html' "$conf" || fail "index.html location (no-cache) missing"
[[ "$(grep -c 'Cache-Control "no-cache"' "$conf")" -ge 2 ]] \
  || fail "index.html and the SPA fallback must both send Cache-Control: no-cache"

grep -q 'corepack' apps/api/Dockerfile && fail "Dockerfile uses corepack (absent in Node >= 25)"
grep -q 'npm i -g pnpm@10.28.0' apps/api/Dockerfile || fail "Dockerfile must npm i -g pnpm@10.28.0"
fetch_line="$(grep -n 'pnpm fetch --frozen-lockfile' apps/api/Dockerfile | head -1 | cut -d: -f1 || true)"
copy_line="$(grep -n '^COPY \. \.' apps/api/Dockerfile | head -1 | cut -d: -f1 || true)"
[[ -n "$fetch_line" && -n "$copy_line" && "$fetch_line" -lt "$copy_line" ]] \
  || fail "Dockerfile must run pnpm fetch --frozen-lockfile before COPY . ."
grep -qE '^COPY pnpm-lock\.yaml ' apps/api/Dockerfile || fail "Dockerfile must COPY pnpm-lock.yaml before fetch"
grep -q 'pnpm install --frozen-lockfile --offline' apps/api/Dockerfile \
  || fail "Dockerfile must install --offline from the fetched store"
grep -qF '/app/apps/api/bot' apps/api/Dockerfile || fail "Dockerfile must ship apps/api/bot for tma-bot setup"

grep -q 'pnpm --filter @__APP_SLUG__/web build' deploy/deploy.sh \
  || fail "deploy.sh must build @__APP_SLUG__/web"
grep -qF 'BOT_PROFILE=/app/apps/api/bot/profile.json' deploy/deploy.sh \
  || fail "deploy.sh must run tma-bot setup with BOT_PROFILE"
grep -q 'npx tma-bot setup' deploy/deploy.sh || fail "deploy.sh must run npx tma-bot setup"

grep -q '^umask 077' deploy/backup.sh || fail "backup.sh must umask 077"
grep -q 'mkdir -p -m 700' deploy/backup.sh || fail "backup.sh must mkdir -m 700"
grep -q '\.tmp' deploy/backup.sh && grep -q '^trap ' deploy/backup.sh && grep -q 'mv ' deploy/backup.sh \
  || fail "backup.sh must dump to .tmp, mv on success and trap-clean on failure"

grep -q '^name: __APP_SLUG__$' deploy/docker-compose.yml || fail "compose needs top-level name: __APP_SLUG__"
grep -qF '${PG_PASSWORD:?PG_PASSWORD is required}' deploy/docker-compose.yml \
  || fail "compose must require PG_PASSWORD"
grep -qF '"127.0.0.1:${API_HOST_PORT:-__API_PORT__}:3000"' deploy/docker-compose.yml \
  || fail "compose must publish the api on 127.0.0.1:\${API_HOST_PORT:-__API_PORT__}"

for svc in api postgres; do
  block="$(awk -v s="  $svc:" '$0==s{f=1; next} f && /^  [a-z]/{f=0} f && /^[a-z]/{f=0} f' deploy/docker-compose.yml)"
  case $svc in api) mem=768m ;; postgres) mem=512m ;; esac
  grep -q "mem_limit: $mem" <<<"$block" || fail "compose $svc needs mem_limit: $mem"
  grep -q 'driver: json-file' <<<"$block" && grep -q 'max-size: "10m"' <<<"$block" \
    && grep -q 'max-file: "3"' <<<"$block" || fail "compose $svc needs json-file logging (10m x 3)"
done

grep -qE 'system prune|volume prune|--volumes' deploy/deploy.sh && fail "deploy.sh must never prune system/volumes"
grep -qF 'docker image prune -f --filter label=com.docker.compose.project=__APP_SLUG__' deploy/deploy.sh \
  || fail "deploy.sh must prune only __APP_SLUG__'s dangling images"
grep -q '/var/backups/__APP_SLUG__/pre-deploy-' deploy/deploy.sh || fail "deploy.sh must dump the db before migrating"

grep -q 'if nginx -t; then' deploy/server-setup.sh || fail "server-setup.sh must nginx -t before reload"
grep -q 'certbot certonly --webroot' deploy/server-setup.sh || fail "server-setup.sh must use certbot --webroot"
grep -q 'if \[\[ ! -e "\$env_file" \]\]' deploy/server-setup.sh || fail "server-setup.sh must create .env only if absent"

wf=.github/workflows/deploy.yml
grep -q 'workflow_dispatch' "$wf" || fail "workflow must allow workflow_dispatch"
grep -qE 'branches: \[main\]' "$wf" || fail "workflow must deploy on push to main"
grep -qE '^[[:space:]]+(pull_request|pull_request_target|schedule):' "$wf" && fail "workflow must not run on pull_request/schedule"
grep -q 'needs: test' "$wf" || fail "deploy job must need the unit test job"
grep -qF "if: github.ref == 'refs/heads/main'" "$wf" || fail "deploy job must run only on main"
grep -q 'environment: production' "$wf" || fail "deploy job must use environment: production"
grep -qF "paths-ignore: ['docs/**', '**/*.md']" "$wf" || fail "push trigger must ignore docs-only changes"
grep -qE 'playwright|e2e' "$wf" && fail "CI runs unit tests only"
grep -qE '^concurrency:' "$wf" && grep -q 'group: deploy' "$wf" || fail "workflow needs concurrency group deploy"
for s in DEPLOY_SSH_KEY DEPLOY_HOST DEPLOY_USER DEPLOY_KNOWN_HOSTS BOT_TOKEN; do
  grep -qF "secrets.$s }}" "$wf" || fail "workflow does not use secrets.$s"
done
grep -qE 'set -x|set -o xtrace' "$wf" && fail "workflow must not set -x"
grep -q 'node-version: 26.13.0' "$wf" || fail "workflow must use Node 26.13.0"
grep -q 'npm i -g pnpm@10.28.0' "$wf" || fail "workflow must install pnpm 10.28.0"

vars="$(grep -oE '^\s+[A-Z][A-Z0-9_]+[!?]?:' apps/api/src/config/env.ts | tr -d ' !?:')"
for v in $vars; do
  grep -qE "^$v=" .env.example || fail ".env.example lacks $v"
done

echo "deploy checks ok"
