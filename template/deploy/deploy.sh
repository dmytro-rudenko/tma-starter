#!/usr/bin/env bash
# DEPLOY_HOST=… DEPLOY_USER=root [DEPLOY_KEY=~/.ssh/__APP_SLUG__] [BOT_TOKEN=…] bash deploy/deploy.sh
# BOT_TOKEN travels only on ssh's stdin, never in argv, and is never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

missing=()
for v in DEPLOY_HOST DEPLOY_USER; do
  [[ -n "${!v:-}" ]] || missing+=("$v")
done
if ((${#missing[@]})); then
  echo "deploy.sh: set ${missing[*]} (optional: DEPLOY_KEY = path to the SSH private key)" >&2
  exit 1
fi

target="$DEPLOY_USER@$DEPLOY_HOST"
keepalive=(-o ServerAliveInterval=15 -o ServerAliveCountMax=8)
# sshd sometimes accepts TCP and resets before the banner (kex_exchange_identification):
# one retried connection, reused by every later ssh and rsync, keeps that out of the middle.
mux_dir="$(mktemp -d)"
mux=(-o ControlMaster=auto -o "ControlPath=$mux_dir/%C" -o ControlPersist=600 -o ConnectTimeout=20)
ssh_cmd=(ssh -o BatchMode=yes "${keepalive[@]}" "${mux[@]}")
rsync_ssh="ssh -o BatchMode=yes ${keepalive[*]} -o ControlMaster=auto -o ControlPath=$(printf '%q' "$mux_dir/%C") -o ControlPersist=600 -o ConnectTimeout=20"
if [[ -n "${DEPLOY_KEY:-}" ]]; then
  [[ -r "$DEPLOY_KEY" ]] || { echo "deploy.sh: DEPLOY_KEY is not a readable file" >&2; exit 1; }
  ssh_cmd+=(-i "$DEPLOY_KEY" -o IdentitiesOnly=yes)
  rsync_ssh+=" -i $(printf '%q' "$DEPLOY_KEY") -o IdentitiesOnly=yes"
fi
remote() { "${ssh_cmd[@]}" "$target" "$1" < /dev/null; }
trap '"${ssh_cmd[@]}" -O exit "$target" < /dev/null > /dev/null 2>&1 || true; rm -rf "$mux_dir"' EXIT
connect() {
  local attempt
  for attempt in 1 2 3 4 5 6; do
    remote true && return 0
    echo "ssh: connection attempt $attempt failed, retrying" >&2
    sleep $((attempt * 10))
  done
  echo "ssh: no connection to $DEPLOY_HOST after 6 attempts" >&2
  exit 1
}

compose='docker compose -f deploy/docker-compose.yml --env-file /etc/__APP_SLUG__/.env'

echo "==> 1/10 build web (locally)"
pnpm --filter @__APP_SLUG__/web build

connect
echo "==> 2/10 sync repository to /opt/__APP_SLUG__"
rsync -az --delete -e "$rsync_ssh" \
  --include /.env.example \
  --exclude node_modules --exclude .git --exclude dist --exclude '.env' --exclude '.env.*' \
  --exclude .pgdata \
  ./ "$target:/opt/__APP_SLUG__/"

echo "==> 3/10 server setup (dirs, .env, nginx, certificate, cron)"
printf '%s\n' "${BOT_TOKEN:-}" | "${ssh_cmd[@]}" "$target" 'bash /opt/__APP_SLUG__/deploy/server-setup.sh'

echo "==> 4/10 build images"
# Detached: a dropped ssh session must neither kill the build nor fail the deploy.
# Each poll is a short ssh call, retried on a drop.
build_log=/var/log/__APP_SLUG__/build.log
remote "mkdir -p /var/log/__APP_SLUG__ && rm -f $build_log.rc && : > $build_log && cd /opt/__APP_SLUG__ &&
setsid nohup bash -c '$compose build > $build_log 2>&1; echo \$? > $build_log.rc' < /dev/null > /dev/null 2>&1 &"
shown=0 drops=0 waited=0
while :; do
  sleep 10
  waited=$((waited + 10))
  if ((waited > 1200)); then
    echo "image build still running after 20 min; see $build_log on the server" >&2
    exit 1
  fi
  if ! out="$(remote "n=\$(wc -c < $build_log); echo \"\$n \$(cat $build_log.rc 2>/dev/null)\"
tail -c +$((shown + 1)) $build_log | head -c \$((n - $shown)); echo .")"; then
    drops=$((drops + 1))
    ((drops <= 12)) || { echo "lost the server while polling the image build" >&2; exit 1; }
    continue
  fi
  drops=0
  header="${out%%$'\n'*}"
  chunk="${out#*$'\n'}"
  printf '%s' "${chunk%.}"
  shown="${header%% *}"
  rc="${header#* }"
  [[ -z "$rc" ]] && continue
  ((rc == 0)) || { echo "image build failed: exit $rc" >&2; exit 1; }
  break
done

# The web build is published only after postgres is backed up, migrated, and the new api is
# healthy; a failure at any earlier step leaves the old web and the old api live.
echo "==> 5/10 pre-migration backup"
remote "set -o pipefail; umask 077; cd /opt/__APP_SLUG__ && mkdir -p -m 700 /var/backups/__APP_SLUG__ &&
$compose up -d --wait postgres &&
out=/var/backups/__APP_SLUG__/pre-deploy-\$(date +%Y%m%d-%H%M%S).sql.gz &&
{ $compose exec -T postgres pg_dump -U __APP_DB__ __APP_DB__ | gzip > \"\$out.tmp\" || { rm -f \"\$out.tmp\"; exit 1; }; } &&
mv \"\$out.tmp\" \"\$out\" && echo \"backup: \$out\" &&
find /var/backups/__APP_SLUG__ -maxdepth 1 -name 'pre-deploy-*.sql.gz' -mtime +14 -delete"

echo "==> 6/10 migrate"
remote "cd /opt/__APP_SLUG__ && $compose run --rm api node dist/database/migrate.js latest"

echo "==> 7/10 start api"
remote "cd /opt/__APP_SLUG__ && $compose up -d api"

echo "==> 8/10 wait for health"
remote "cd /opt/__APP_SLUG__ && API_HOST_PORT=\$(sed -n 's/^API_HOST_PORT=//p' /etc/__APP_SLUG__/.env | tail -n 1)
for i in \$(seq 1 30); do
  curl -fsS -o /dev/null http://127.0.0.1:\${API_HOST_PORT:-__API_PORT__}/api/health && echo 'api healthy' && exit 0
  sleep 2
done
echo 'api not healthy after 60s' >&2; $compose logs --tail 80 api >&2; exit 1"

echo "==> 9/10 sync web build to /var/www/__APP_SLUG__"
rsync -az --delete -e "$rsync_ssh" --exclude /.well-known apps/web/dist/ "$target:/var/www/__APP_SLUG__/"

echo "==> 10/10 webhook and bot profile"
remote "cd /opt/__APP_SLUG__ && $compose exec -T -e BOT_PROFILE=/app/apps/api/bot/profile.json api npx tma-bot setup"

# Shared host: free only this project's dangling images and build cache older than a week.
echo "==> cleanup"
remote 'docker image prune -f --filter label=com.docker.compose.project=__APP_SLUG__'
remote 'docker builder prune -f --filter until=168h'

echo "deploy done"
