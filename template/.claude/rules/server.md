---
paths:
  - "apps/api/**"
---
# apps/api

## General

- The DB is PostgreSQL through Knex. `createKnexConnection` from `database/knex.ts` creates the single knex instance and passes it to `TmaCoreModule.forRoot`; do not create a second connection.
- Change the schema only with a new migration in `database/migrations/`; do not edit an applied migration — it has already run in production. Migration order is set by `composeMigrations(core, bot, payments, appMigrations)` in `database/migrate.ts`: packages first, then the app. The packages assume the schema is already migrated.
- **Migrations run before the new API starts.** `deploy.sh` runs `node dist/database/migrate.js latest` in a one-off container, then `up -d api`. While the migration runs, and until the restart, the old code version works on the new schema: write migrations to be backward compatible (add columns; do not rename or drop in the same deploy).
- `validateEnv` from `config/env.ts` validates `process.env`: only `main.ts` and `appImports` in `app.module.ts` call it. The rest of the code does not read `process.env` and gets values as `forRoot(...)` options that `appImports` builds from the validated `Env`. A new variable is a field in the `Env` class and passing the value to the needed module through `appImports`. Log through the Nest `Logger`, not `console.*`. The exception to both rules is the `database/migrate.ts` CLI.
- Do not write `BOT_TOKEN`, `WEBHOOK_SECRET`, `WEBHOOK_PATH_TOKEN`, `initData` or the `Authorization` header to logs.
- New endpoints that accept large bodies or send messages get their own `@Throttle` and a size limit.
- Do not make Telegram calls inside a transaction: only after the commit, and notifications are fire-and-forget (`NotificationsService.send` does not throw).
- Build deep links only through `BotService.startAppUrl(param)`: `t.me/<bot>?startapp=<param>` without a short name, otherwise the Main Mini App loses `start_param`.
- Bot settings (webhook, profile) are not changed when the API starts: `tma-bot setup` does that on deploy. If you changed `bot/profile.json`, deploy.

## Authorization

- `TmaCoreModule` registers `TelegramAuthGuard` and `UserThrottlerGuard` as `APP_GUARD`; do not add them again in `AppModule`.
- The guard checks only `/api/*` (header `Authorization: tma <initData>`, `@Public()` turns it off). `/bot` has its own protection.
- A blocked user (`users.blocked_at`) gets 403 `USER_BLOCKED`; the bot ignores them, except for `successful_payment`.
- The bot webhook has two separate secrets: `WEBHOOK_PATH_TOKEN` in the path and `WEBHOOK_SECRET` in the header, because URLs end up in logs.

## Payments

- `tma-starter/nest-payments` handles payments, refunds and entitlements; the app only describes products. The package guarantees idempotency by `telegram_payment_charge_id`.
- Check access by purchase through `EntitlementGuard('<productId>')` or `EntitlementsService.has`, not with your own table queries.

## Tests

- `createTestApp` from `tma-starter/testing` brings up `AppModule` on a fresh database with a fake Bot API. Replace only external things (`overrides`), not services or the DB.
