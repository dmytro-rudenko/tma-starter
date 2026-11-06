#!/usr/bin/env bash
# Exercises deploy/deploy.sh with stubbed pnpm / rsync / ssh (nothing leaves the machine).
# Run: bash deploy/deploy.test.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
pass=0
fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { pass=$((pass + 1)); echo "ok - $*"; }

[[ -f "$here/deploy.sh" ]] || fail "deploy.sh missing"

mkdir -p "$work/bin"
for c in pnpm rsync ssh; do
  cat > "$work/bin/$c" <<EOF
#!/usr/bin/env bash
printf '%s' "$c" >> "$work/argv"; printf ' %s' "\$@" >> "$work/argv"; echo >> "$work/argv"
if [[ "$c" == ssh ]]; then
  # FAIL_SSH_ON=<pattern>: this ssh call exits 1 when its remote command matches.
  if [[ -n "\${FAIL_SSH_ON:-}" && "\${@: -1}" == *"\$FAIL_SSH_ON"* ]]; then exit 1; fi
  # FAIL_SSH_ONCE_ON=<pattern>: only the first matching call exits 255 (a dropped connection).
  if [[ -n "\${FAIL_SSH_ONCE_ON:-}" && "\${@: -1}" == *"\$FAIL_SSH_ONCE_ON"* && ! -e "$work/failed-once" ]]; then
    touch "$work/failed-once"; exit 255
  fi
  # The build-log poll: header "<log bytes> <exit code>", the new bytes, then the "." sentinel.
  if [[ "\${@: -1}" == *"wc -c"* ]]; then printf '9 %s\nbuild-log\n.\n' "\${BUILD_RC:-0}"; fi
  { echo "--- \${@: -1}"; cat; echo; } >> "$work/stdin"
fi
EOF
done
printf '#!/usr/bin/env bash\n' > "$work/bin/sleep"
chmod +x "$work/bin/"*

call_with() { awk -v pat="$1" '/^(ssh|rsync|pnpm) /{if (rec ~ pat) printf "%s", rec; rec=""} {rec=rec $0 "\n"} END{if (rec ~ pat) printf "%s", rec}' "$work/argv"; }

tok='123456:SecretTokenValue_x'
run() { : > "$work/argv"; : > "$work/stdin"; rm -f "$work/failed-once"; PATH="$work/bin:$PATH" bash "$here/deploy.sh" > "$work/out" 2>&1; }

env -u DEPLOY_KEY DEPLOY_HOST=h.example DEPLOY_USER=root BOT_TOKEN="$tok" \
  bash -c "$(declare -f run); work='$work' here='$here'; run" || { cat "$work/out"; fail "deploy.sh failed"; }
grep -qF "$tok" "$work/argv" && fail "BOT_TOKEN in some argv"
grep -qF "$tok" "$work/out" && fail "BOT_TOKEN printed"
grep -q -- ' -i ' "$work/argv" && fail "ssh -i used without DEPLOY_KEY"
awk '/^--- .*server-setup\.sh/{f=1; next} /^--- /{f=0} f' "$work/stdin" | grep -qxF "$tok" \
  || fail "BOT_TOKEN not passed on server-setup's stdin"
ok "CI mode: token via stdin only, default ssh identity"

grep -E '^ssh ' "$work/argv" | grep -v -- '-o ServerAliveInterval=15 -o ServerAliveCountMax=8' \
  && fail "ssh call without keepalive"
grep -E '^rsync ' "$work/argv" | grep -v -- 'ServerAliveInterval=15 -o ServerAliveCountMax=8' \
  && fail "rsync ssh without keepalive"
ok "ssh keepalive on every call"

grep -E '^ssh ' "$work/argv" | grep -v -- '-o ControlMaster=auto -o ControlPath=' && fail "ssh call without ControlMaster"
grep -E '^rsync ' "$work/argv" | grep -v -- 'ControlMaster=auto -o ControlPath=' && fail "rsync ssh without ControlMaster"
grep -E '^ssh ' "$work/argv" | grep -v -- '-o ConnectTimeout=20' && fail "ssh call without ConnectTimeout"
head -1 "$work/argv" | grep -q '^pnpm' || fail "web must build before the first connection"
grep -E '^(ssh|rsync) ' "$work/argv" | head -1 | grep -qE ' true$' || fail "no connection check before the repo rsync"
grep -E '^ssh .* -O exit ' "$work/argv" | grep -q . || fail "shared connection not closed at exit"
ok "one shared ssh connection, opened before the first rsync"

grep -qxF 'pnpm --filter @__APP_SLUG__/web build' "$work/argv" || fail "web not built with pnpm --filter @__APP_SLUG__/web build"
grep -E '^pnpm' "$work/argv" | grep -q 'shared' && fail "a shared package is built: the template has none"
ok "local web build"

grep -E '^rsync .*/opt/__APP_SLUG__/' "$work/argv" | grep -q -- '--exclude node_modules' || fail "repo rsync excludes"
grep -E '^rsync .*/opt/__APP_SLUG__/' "$work/argv" | grep -q -- '\.pgdata' || fail ".pgdata not excluded"
grep -E '^rsync .*/opt/__APP_SLUG__/' "$work/argv" | grep -q -- '--include /.env.example' || fail ".env.example not kept"
grep -E '^rsync .*/var/www/__APP_SLUG__/' "$work/argv" | grep -q -- '/.well-known' || fail ".well-known not protected"
ok "rsync excludes"

order="$(grep -oE 'server-setup\.sh|compose -f deploy/docker-compose\.yml --env-file /etc/__APP_SLUG__/\.env (build|up -d --wait postgres|up -d api|up -d|run --rm api node dist/database/migrate\.js latest|exec -T api node dist/database/migrate\.js latest)|pre-deploy-|api/health|/var/www/__APP_SLUG__/|npx tma-bot setup|set-webhook\.sh|image prune|builder prune' "$work/argv" | sed 's/^compose .*\.env //' | uniq | tr '\n' ' ')"
[[ "$order" == "server-setup.sh build up -d --wait postgres pre-deploy- run --rm api node dist/database/migrate.js latest up -d api api/health /var/www/__APP_SLUG__/ npx tma-bot setup image prune builder prune " ]] \
  || fail "deploy steps out of order: $order"
grep -q 'docker compose -f deploy/docker-compose.yml --env-file /etc/__APP_SLUG__/.env' "$work/argv" \
  || fail "compose invocation"
grep -q -- 'up -d --build' "$work/argv" && fail "up -d --build: images must be built before the backup"
ok "deploy step order (migrate before the api starts, web published after it is healthy)"

call_with 'pre-deploy-' | grep -q 'umask 077' || fail "pre-deploy dump without umask 077"
call_with 'pre-deploy-' | grep -q '/var/backups/__APP_SLUG__/pre-deploy-' || fail "pre-deploy dump path"
call_with 'pre-deploy-' | grep -q 'pg_dump -U __APP_DB__ __APP_DB__' || fail "pre-deploy dump not pg_dump"
call_with 'pre-deploy-' | grep -q 'pipefail' || fail "pre-deploy dump must fail when pg_dump fails"
ok "pre-migration backup"

call_with 'migrate.js' | grep -qF 'cd /opt/__APP_SLUG__' || fail "migrate not run from /opt/__APP_SLUG__"
ok "migrations run in a one-off api container"

call_with 'api/health' | grep -qF '127.0.0.1:${API_HOST_PORT:-__API_PORT__}/api/health' \
  || fail "health URL must use \${API_HOST_PORT:-__API_PORT__}"
ok "health URL honours API_HOST_PORT"

call_with 'tma-bot setup' | grep -qF 'cd /opt/__APP_SLUG__' || fail "bot setup not run from /opt/__APP_SLUG__"
call_with 'tma-bot setup' | grep -qF 'docker compose -f deploy/docker-compose.yml --env-file /etc/__APP_SLUG__/.env exec -T' \
  || fail "bot setup not run with compose exec -T"
call_with 'tma-bot setup' | grep -qF 'BOT_PROFILE=/app/apps/api/bot/profile.json' \
  || fail "bot setup without BOT_PROFILE=/app/apps/api/bot/profile.json"
grep -q 'set-webhook' "$work/argv" && fail "set-webhook.sh still called"
ok "bot setup through tma-bot inside the api container"

call_with 'image prune' | grep -qF 'docker image prune -f --filter label=com.docker.compose.project=__APP_SLUG__' \
  || fail "image prune not scoped to the __APP_SLUG__ project"
call_with 'builder prune' | grep -qF 'docker builder prune -f --filter until=168h' \
  || fail "builder prune not limited to until=168h"
grep -qE 'system prune|volume prune|prune[^"]*--volumes' "$work/argv" && fail "prune must never touch the system or volumes"
ok "scoped prune after a successful deploy"

call_with ' build >' | grep -q 'setsid nohup' || fail "image build not detached from the ssh session"
call_with ' build >' | grep -qF '/var/log/__APP_SLUG__/build.log' || fail "image build not logged on the server"
grep -qx 'build-log' "$work/out" || fail "build log not streamed to the deploy output"
ok "image build detached, log streamed"

env -u DEPLOY_KEY DEPLOY_HOST=h DEPLOY_USER=u FAIL_SSH_ONCE_ON='wc -c' \
  bash -c "$(declare -f run); work='$work' here='$here'; run" || { cat "$work/out"; fail "a dropped poll failed the deploy"; }
ok "a dropped connection while polling the build is retried"

env -u DEPLOY_KEY DEPLOY_HOST=h DEPLOY_USER=u BUILD_RC=1 \
  bash -c "$(declare -f run); work='$work' here='$here'; run" && fail "deploy succeeded although the build failed"
grep -q 'pre-deploy-' "$work/argv" && fail "backup ran although the build failed"
grep -q 'migrate\.js' "$work/argv" && fail "migrations ran although the build failed"
grep -q 'exit 1' "$work/out" || fail "build exit code not reported"
ok "failed image build stops the deploy"

env -u DEPLOY_KEY DEPLOY_HOST=h DEPLOY_USER=u FAIL_SSH_ONCE_ON=true \
  bash -c "$(declare -f run); work='$work' here='$here'; run" || { cat "$work/out"; fail "a refused first connection failed the deploy"; }
[[ "$(grep -cE '^ssh .* true$' "$work/argv")" == 2 ]] || fail "first connection not retried"
ok "a refused first connection is retried"

env -u DEPLOY_KEY DEPLOY_HOST=h DEPLOY_USER=u FAIL_SSH_ON=true \
  bash -c "$(declare -f run); work='$work' here='$here'; run" && fail "deploy went on without a connection"
grep -q '^rsync ' "$work/argv" && fail "rsync ran without a connection"
ok "no connection after retries stops the deploy"

env -u DEPLOY_KEY DEPLOY_HOST=h DEPLOY_USER=u FAIL_SSH_ON=pre-deploy- \
  bash -c "$(declare -f run); work='$work' here='$here'; run" && fail "deploy succeeded although the backup failed"
grep -q 'migrate\.js' "$work/argv" && fail "migrations ran although the backup failed"
ok "failed backup stops before migrations"

env -u DEPLOY_KEY DEPLOY_HOST=h DEPLOY_USER=u FAIL_SSH_ON=migrate.js \
  bash -c "$(declare -f run); work='$work' here='$here'; run" && fail "deploy succeeded although migrations failed"
grep -q 'up -d api' "$work/argv" && fail "new api started although migrations failed"
ok "failed migrations keep the old api running"

for step in pre-deploy- migrate.js api/health; do
  env -u DEPLOY_KEY DEPLOY_HOST=h DEPLOY_USER=u FAIL_SSH_ON="$step" \
    bash -c "$(declare -f run); work='$work' here='$here'; run" && fail "deploy succeeded although '$step' failed"
  grep -q '/var/www/__APP_SLUG__/' "$work/argv" && fail "web published although '$step' failed"
  grep -q 'tma-bot setup' "$work/argv" && fail "bot setup ran although '$step' failed"
  grep -q 'prune' "$work/argv" && fail "pruned although '$step' failed"
done
ok "failure before the web rsync keeps the old web and skips bot setup"

env -u DEPLOY_KEY DEPLOY_HOST=h DEPLOY_USER=u FAIL_SSH_ON='tma-bot setup' \
  bash -c "$(declare -f run); work='$work' here='$here'; run" && fail "deploy succeeded although bot setup failed"
grep -q 'prune' "$work/argv" && fail "pruned although bot setup failed"
ok "failed bot setup fails the deploy"


key="$work/key"; touch "$key"
env -u BOT_TOKEN DEPLOY_KEY="$key" DEPLOY_HOST=h DEPLOY_USER=u \
  bash -c "$(declare -f run); work='$work' here='$here'; run" || { cat "$work/out"; fail "local deploy failed"; }
grep -E '^ssh ' "$work/argv" | grep -q -- "-i $key" || fail "ssh -i not used"
grep -E '^rsync ' "$work/argv" | grep -q -- "IdentitiesOnly" || fail "rsync not using the key"
ok "local mode with DEPLOY_KEY"

env -u DEPLOY_HOST DEPLOY_USER=u bash -c "$(declare -f run); work='$work' here='$here'; run" \
  && fail "missing DEPLOY_HOST accepted"
grep -q DEPLOY_HOST "$work/out" || fail "missing var not named"
ok "missing DEPLOY_HOST rejected"

[[ -e "$here/set-webhook.sh" ]] && fail "deploy/set-webhook.sh still present"
grep -q 'set-webhook' "$here/deploy.sh" && fail "deploy.sh references set-webhook.sh"
for f in "$here/nginx/__APP_SLUG__.conf" "$here/nginx/__APP_SLUG__-bootstrap.conf"; do
  [[ -f "$f" ]] || fail "missing $f"
  grep -q 'media' "$f" && fail "$f still has /media"
done
[[ -f "$here/backup.sh" ]] || fail "missing backup.sh"
grep -q 'rsync' "$here/backup.sh" && fail "backup.sh still rsyncs photos"
grep -q 'photos' "$here/backup.sh" && fail "backup.sh still mentions photos"
grep -qF 'pg_dump -U __APP_DB__ __APP_DB__' "$here/backup.sh" || fail "backup.sh does not dump __APP_DB__"
grep -q 'MALLOC_ARENA_MAX' "$here/docker-compose.yml" "$here/../apps/api/Dockerfile" && fail "MALLOC_ARENA_MAX still set"
grep -qF '127.0.0.1:${API_HOST_PORT:-__API_PORT__}:' "$here/docker-compose.yml" || fail "compose does not publish the api on loopback __API_PORT__"
grep -rqi --exclude='*.test.sh' 'plivka' "$here" "$here/../apps/api/Dockerfile" && fail "plivka left in deploy files"
ok "plivka-only parts removed"

echo "deploy tests: $pass passed"
