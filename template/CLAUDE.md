# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

__APP_TITLE__ — Telegram Mini App (bot `@__BOT_USERNAME__`), created from `tma-starter`. pnpm monorepo: `apps/api` (NestJS 10, Knex, PostgreSQL 16, grammY) and `apps/web` (React 18, Vite 5, TanStack Query 5, i18next). Auth, users, admin panel, bot, broadcasts, payments and realtime live in the `tma-starter` package (subpaths `nest-core`, `nest-bot`, `nest-payments`, `web`, `testing`), which is installed as a dependency. Node and pnpm versions are pinned in `.nvmrc` and `packageManager`.

Architecture, style and per-package rules are in `.claude/rules/`.

**A push to `main` deploys to production immediately.** CI runs only `pnpm test`, so check anything it does not cover locally before merging.

## Rule for agents

Infrastructure (auth, users and admin rights, admin panel, settings, audit, bot, broadcasts, payments, entitlements, realtime) lives in the `tma-starter` package. Do not copy its code into the app or rewrite it: extend it through `forRoot`, registries and `copy`. If the extension point you need does not exist, that is a question for the package, not a reason to fork its code into `apps/`.

## Commands

```bash
pnpm install --frozen-lockfile

pnpm dev                             # local run without Telegram, see below
pnpm build                           # api and web
pnpm typecheck
pnpm test                            # api + web

pnpm db:start                        # Postgres 16 for development and tests
pnpm db:stop
pnpm db:create                       # creates the DB from DATABASE_URL if it does not exist yet
pnpm db:migrate                      # migrations of tma-starter and the app
pnpm up -r tma-starter@latest         # updates tma-starter across the workspace
```

One test:

```bash
pnpm --filter @__APP_SLUG__/api exec jest test/env.spec.ts -t 'test name'
pnpm --filter @__APP_SLUG__/web exec vitest run <file>
```

Migrations run only from compiled code and need `DATABASE_URL`:

```bash
pnpm --filter @__APP_SLUG__/api build && pnpm db:migrate
```

## Updating tma-starter

`tma-starter` is pinned to one exact version in the root `package.json` and in both apps. Update it across the workspace with one command, then apply the migrations, because the new package version may add its own:

```bash
pnpm up -r tma-starter@latest
pnpm db:migrate
```

## Test conditions

- **Postgres is needed for `pnpm test` too:** `createTestApp` brings up the whole `AppModule` on a fresh database. By default tests connect to `postgres://postgres@127.0.0.1:54329/postgres`; `DATABASE_ADMIN_URL` changes the address.
- Start the DB with `pnpm db:start`, stop it with `pnpm db:stop`.
- Web tests run in jsdom without a browser and without Telegram (`installFakeWebApp` from `tma-starter/testing/dom`).
- There are no e2e or Playwright tests.

## Running locally

- Without Telegram `initData` is empty, so every protected `/api/*` route answers 401. `pnpm dev` works around this: it starts a fake Bot API on port 3199, the API on 3100 (`BOT_API_ROOT=http://127.0.0.1:3199`) and Vite on 5173, and prints the Mini App URL with signed `initData` for the first id in `ADMIN_USER_IDS` to the console.
- It needs `.env` with `BOT_TOKEN` and `DATABASE_URL`, and a running DB. If the DB is unreachable, the script suggests `pnpm db:start` and `pnpm db:migrate`.
- If the `payments.test_users` key is not in `app_settings` yet, `pnpm dev` writes `ADMIN_USER_IDS` there: a purchase in a browser outside Telegram goes through in test mode right away.
- Vite proxies `/api` (including the websocket `/api/socket.io`) to `127.0.0.1:3100`; `/bot` is proxied for the local fake bot.
- The API does not start without `BOT_TOKEN`, `BOT_USERNAME`, `WEBAPP_URL`, `WEBHOOK_SECRET`, `WEBHOOK_PATH_TOKEN`, `DATABASE_URL` (`apps/api/src/config/env.ts`).
