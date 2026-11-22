# __APP_TITLE__

Telegram Mini App on `tma-starter`: Telegram login, admin panel, bot with broadcasts, Telegram Stars payments and realtime are already wired in. Your own code lives in `apps/api/src/features/` and `apps/web/src/features/`. The `example` module is a sample.

- `apps/api` — NestJS 10, Knex, PostgreSQL 16, grammY.
- `apps/web` — React 18, Vite 5, TanStack Query 5, i18next.
- `deploy/` — Docker Compose, nginx, deploy scripts. Details, secret rotation and rollback are in `deploy/README.md`.
- `.claude/rules/` and `CLAUDE.md` — rules for Claude Code.

## Running locally

```bash
pnpm install
cp .env.example .env     # fill in BOT_TOKEN, WEBHOOK_SECRET, WEBHOOK_PATH_TOKEN, DATABASE_URL, ADMIN_USER_IDS
pnpm db:start            # Postgres 16 on 127.0.0.1:54329
pnpm db:create           # creates the DB from DATABASE_URL if it does not exist yet
pnpm build
pnpm db:migrate
pnpm dev                 # fake Bot API :3199, API :3100, Vite :5173; prints the Mini App URL
```

## Tests

`pnpm test` runs the unit and module tests of api (jest) and web (vitest, jsdom). It needs a running Postgres: `pnpm db:start`.

## Deploy

1. BotFather: `/newbot`, enable Mini App and payments (Stars).
2. DNS: point `__DOMAIN__` at the server.
3. `server-setup.sh` on the server. It needs Docker with compose, nginx, certbot, rsync, curl and openssl. Copy the repository to `/opt/__APP_SLUG__` (`rsync -az --exclude node_modules --exclude .git ./ root@<host>:/opt/__APP_SLUG__/`), then on the server:
   ```bash
   read -rs BOT_TOKEN && export BOT_TOKEN
   bash /opt/__APP_SLUG__/deploy/server-setup.sh
   ```
   The script creates the directories, `/etc/__APP_SLUG__/.env` with random secrets, the nginx site, a Let's Encrypt certificate and a cron job for backups.
4. `BOT_TOKEN` in `/etc/__APP_SLUG__/.env`: the previous step wrote it. After that, every deploy refreshes the token from the GitHub secret `BOT_TOKEN`.
5. GitHub secrets (`production` environment): `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_HOST`, `DEPLOY_USER`, `BOT_TOKEN`. What each one holds is described in `deploy/README.md`.
6. Push to `main`: the workflow runs the tests, `deploy/check.sh` and `deploy/deploy.sh`, which finishes by running `tma-bot setup` (webhook and bot profile from `apps/api/bot/profile.json`).

## Updating tma-starter

`tma-starter` is pinned to one exact version in the root `package.json` and in the app dependencies. Update it like this:

```bash
pnpm up -r tma-starter@latest
pnpm db:migrate
```

The first command installs the latest `tma-starter` in every workspace `package.json`. `pnpm up -r tma-starter@1.4.0` pins a specific version. The second command applies the migrations the new package version may have added.
