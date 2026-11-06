# tma-starter — implementation plan

**Goal:** the `dmytro-rudenko/tma-starter` repository contains five npm packages, `@dmytro-rudenko/tma-{nest-core,nest-bot,nest-payments,web,testing}`, and the `tma-starter` plugin. The plugin ships the skill `/tma-starter:new`, `scaffold.sh` and `template/` (variants `empty` and `shop`). Everything is green in CI, and release `0.1.0` is published to npm with provenance.
**Spec:** docs/sdd/specs/2026-11-06-tma-starter.md
**Prototype:** — (no prototype, by the user's decision)
**Verification:** from the repository root, with `pnpm db:start` running:
`pnpm -r build && pnpm -r typecheck && pnpm -r test && bash skills/new/scaffold.test.sh && bash scripts/smoke-template.sh empty && bash scripts/smoke-template.sh shop`
The last line must be `smoke OK: shop`.

Worktree: `/home/pc/projects/tma-starter-wt/spec-tma-starter`. Branch: `spec/tma-starter`. PR: #1. Codex mode: `explore`, so every task is `**Executor:** claude`.

## Waves
| Wave | Tasks | Why together |
|---|---|---|
| 0 | 0 | alone: acceptance tests, red until the last wave |
| 1 | 1 | alone: the monorepo skeleton everyone writes into |
| 2 | 2, 10, 11 | disjoint: `packages/testing/**` vs `skills/new/scaffold.sh` + `scripts/smoke-template.sh` vs `skills/new/SKILL.md` |
| 3 | 3, 9, 12 | disjoint: `packages/nest-core/**` vs `packages/web/**` vs `template/deploy/**` + docs |
| 4 | 4 | alone: same package and `core.module.ts` as Task 3 |
| 5 | 5 | alone: consumes `AdminUserCardRegistry` and `AuditService` from Task 4 |
| 6 | 6, 7 | disjoint: `packages/nest-bot/src/broadcast/**` + `bin` vs `packages/nest-payments/**`; Task 7 consumes only Task 5 |
| 7 | 8 | alone: same package as Task 7, consumes `BroadcastAudienceRegistry` from Task 6 |
| 8 | 13, 14, 16 | disjoint: `template/` root + `template/apps/api/**` vs `template/apps/web/**` vs repository root CI/manifest |
| 9 | 15 | alone: fills the shop folders behind the markers from Tasks 13 and 14 |
| 10 | 17 | alone: the release, after PR #1 is merged |

Forced serialization:
- Tasks 3→4, 5→6 and 7→8 each write the same package and the same `*.module.ts` file.
- Task 15 builds on the marker blocks that Tasks 13 and 14 leave in `app.module.ts`, `products.ts`, `registry.tsx`, `tabs.ts` and `i18n/index.ts`.

## Global constraints
- Toolchain: Node `26.13.0` (`.nvmrc`, `engines: ">=26.13.0"`), `packageManager: "pnpm@10.28.0"`, TypeScript `~5.6.3`, Prettier `^3.3.3`. Copy `tsconfig.base.json` from `/home/pc/projects/plivka/tsconfig.base.json`.
- npm names: `@dmytro-rudenko/tma-nest-core`, `@dmytro-rudenko/tma-nest-bot`, `@dmytro-rudenko/tma-nest-payments`, `@dmytro-rudenko/tma-web`, `@dmytro-rudenko/tma-testing`. Each has:
  - `"version": "0.0.0"`, `"license": "MIT"`, `publishConfig.access: "public"`, `files: ["dist"]`;
  - `repository: { type: "git", url: "git+https://github.com/dmytro-rudenko/tma-starter.git", directory: "packages/<dir>" }`.
  Internal dependencies use `workspace:*`.
- Module format: nest-* and testing are CJS (`tsc -p tsconfig.build.json` → `dist/`, `.d.ts`). web is ESM (`tsc`, entry points `.` and `./react`, `sideEffects: false`).
- peerDependencies, with versions copied from `plivka/apps/api/package.json`:
  - `@nestjs/common` / `@nestjs/core` / `@nestjs/websockets` / `@nestjs/platform-socket.io` `^10.4.0`, `@nestjs/throttler` `^6.2.0`;
  - `knex` `^3.1.0`, `pg` `^8.13.0`, `grammy` `^1.30.0`, `socket.io` `4.8.1`, `class-validator` `^0.14.1`, `class-transformer` `^0.5.1`, `reflect-metadata` `^0.2.2`, `rxjs` `^7.8.1`.
  - web: `react` `^18.3.1`, `@tanstack/react-query` `^5.59.0`, `socket.io-client` `^4.8.0`, `i18next` `^23.16.0`, `react-i18next` `^15.1.0`. All are `optional` in `peerDependenciesMeta` except `i18next`.
- Tests:
  - nest packages use jest `^29.7.0` + ts-jest `^29.2.0`. `testMatch`: `src/**/*.spec.ts` (unit) and `test/**/*.acceptance.spec.ts`. `maxWorkers: 4`, `workerIdleMemoryLimit: '1GB'`. Copy the config from `plivka/apps/api/jest.config.js`.
  - web uses vitest `^2.1.4` + jsdom `^25.0.1` + `@testing-library/react` `^16.0.1`.
  - Tests need a real Postgres 16: `pnpm db:start` (`tma-test-pg`, `127.0.0.1:54329`). `DATABASE_ADMIN_URL` defaults to `postgres://postgres@127.0.0.1:54329/postgres`.
  - No e2e and no Playwright anywhere.
- Tables have no prefix: `users`, `audit_events`, `app_settings`, `broadcasts`, `broadcast_deliveries`, `payments`, `entitlements`. Migration names: `tma_<pkg>_<NNN>_<what>`. Order: core → bot → payments → application, set by the order of `composeMigrations(...)` arguments. Package code assumes the schema is already migrated: no `hasColumn` checks.
- Error shape: `{ statusCode, message, error, code }` via `apiError(status, code, message?)`.
- Language rule: `langOf(x)` returns `'uk'` only for `'uk'`, otherwise `'en'`. It is shared by the bot and web.
- Code has no comments, except for a constraint the code cannot express (`~/.claude/CLAUDE.md`). Commits have no `Co-Authored-By` and no "Generated with Claude Code".
- Docs (READMEs, `CLAUDE.md`, rules, skill dialogue) are in Ukrainian. Identifiers, commits and code comments are in English.
- Source files to port from plivka (repo `/home/pc/projects/plivka`):
  - `apps/api/src/auth/{init-data,telegram-auth.guard,public.decorator,current-user.decorator}.ts`
  - `apps/api/src/admin-rights/*`, `apps/api/src/admin/{admin.guard,admin-users.controller,admin-users.service}.ts`
  - `apps/api/src/app-settings/*`, `apps/api/src/common/{api-error,user-throttler.guard,validation}.ts`
  - `apps/api/src/realtime/*`, `apps/api/src/health/health.controller.ts`
  - `apps/api/src/database/{knex.provider,migrate,migration-runner}.ts`
  - `apps/api/src/payments/{invoice-payload,payment-recorder,payments.service,payments.controller}.ts`
  - `apps/api/src/bot/{bot.controller,bot.service,i18n,notifications.service}.ts`
  - `apps/api/test/utils/{test-app,init-data,fake-bot-api,http-error}.ts`, `scripts/test-pg.sh`
  - `apps/web/src/telegram/tg.ts`, `apps/web/src/theme/*`, `apps/web/src/i18n/index.ts`, `apps/web/src/api/client.ts`, `apps/web/src/state/*`, `apps/web/src/components/**`, `apps/web/src/features/admin/*`
  - `deploy/*`, `.github/workflows/deploy.yml`, `CLAUDE.md`, `.claude/rules/*`
- Source files to port from retro-game-bot (repo `/home/pc/projects/retro-game-bot`): `apps/server/src/audit/audit.service.ts`, `apps/server/src/bot/{bot-profile,prepared-messages}.ts`, the safe-area hack in `apps/miniapp/src/telegram.ts:56-66`.

## Review Focus
1. Two parallel deliveries of the same `successful_payment` (same `telegram_payment_charge_id`) produce one `payments` row and exactly one `settle` call. This is a race, not a sequential duplicate. Test owner: Task 7.
2. A subscription renewal arrives for a user whom the admin has already blocked. The payment is still recorded and `expires_at` moves forward, because Telegram has already charged the money. Test owner: Task 7.
3. A user blocks the bot in the middle of a broadcast. Their delivery becomes `failed`, `bot_blocked_at` is set, and the rest of the batch keeps sending. Test owner: Task 6.
4. On socket reconnect after `initData` has expired (`auth_date` older than `initDataMaxAgeSec`), the connection is disconnected and does not join the room. Test owner: Task 4.
5. `scaffold.sh --dir "/tmp/my app"`, a path with spaces, generates the project correctly. Test owner: Task 10.

---

### Task 0: acceptance tests

**Writes:** `packages/nest-core/test/core.acceptance.spec.ts`, `packages/nest-bot/test/bot.acceptance.spec.ts`, `packages/nest-payments/test/payments.acceptance.spec.ts`, `packages/web/test/web.acceptance.test.tsx`, `packages/testing/test/testing.acceptance.spec.ts`, `skills/new/scaffold.test.sh`
**Executor:** claude
**Covers** (spec §6 Verification):
- "Acceptance-тести на реальному Postgres і FakeBotApi покривають core / bot / payments / web / testing";
- "`scaffold.test.sh` зелений";
- "`template-smoke` у CI зелений для `empty` і `shop`" (via `scaffold.test.sh` plus Task 10's smoke).

Each nest spec builds the application with `createTestApp({ imports: ctx => [...], migrations })` from `@dmytro-rudenko/tma-testing` and signs users with `tokenFor({ id, first_name })`. Test cases (one `it` each; the names are mandatory, the body is the assertion from the list):

- [x] **Step 1: write `core.acceptance.spec.ts`**
  - `rejects missing / bad-hash / expired initData with 401 UNAUTHORIZED`
  - `upserts the user on first request`: `GET /api/me` → 200, row present in `users`
  - `GET /api/health is public`: 200 `{ ok: true }`
  - `blocked user gets 403 USER_BLOCKED, env admin is never blocked`
  - `non-admin gets 403 NOT_ADMIN on /api/admin/users`
  - `admin rules matrix`:
    - `CANNOT_TARGET_SELF`, `CANNOT_BLOCK_ADMIN` (env), `CANNOT_REVOKE_ENV_ADMIN`, `CANNOT_GRANT_BLOCKED`;
    - a granted admin cannot be blocked until the grant is revoked;
    - repeating grant/block writes no new `audit_events` row.
  - `block/unblock/grant/revoke write audit_events in the same transaction`
  - `users list paginates with cursor and searches by q (numeric id, ilike name)`
  - `PATCH /api/admin/settings validates via parse, writes audit settings.update, cache invalidated`
  - `PATCH /api/me stores language and theme`
  - `realtime: valid initData joins user:<id>, invalid or expired initData disconnects; emitToUser delivers`
  - `GET /api/admin/users/:id includes cards from AdminUserCardRegistry`
- [x] **Step 2: write `bot.acceptance.spec.ts`**
  - `webhook rejects wrong path token or secret with 401`
  - `critical handler failure → 500, non-critical failure → 200`
  - `blocked user: /start ignored, successful_payment still reaches handler`
  - `incoming message clears users.bot_blocked_at`
  - `/start with matching StartParamRoute calls its handler, otherwise greet with web_app button`
  - `NotificationsService: 403 sets bot_blocked_at and returns bot_blocked; 429 retried once`
  - `broadcast snapshots recipients by audience languages and registered filter`
  - `broadcast worker: 25 per batch, 429 pauses, 403 marks failed + bot_blocked_at, 5xx retried 3 times`
  - `broadcast cancel marks rest skipped`
  - `broadcast resumes after restart without duplicates`
  - `two workers in parallel deliver exactly one message per recipient`
  - `tma-bot setup: calls setWebhook then profile methods; exit 1 when setWebhook fails, exit 2 when profile fails`
- [x] **Step 3: write `payments.acceptance.spec.ts`**
  - `one_time end-to-end: invoice → pre_checkout ok → successful_payment → settle once`
  - `pre_checkout rejects wrong amount, wrong currency, blocked payer`
  - `duplicate charge id is a no-op`
  - `second payment of same one_time invoice → refund_pending → refundStarPayment`
  - `ALREADY_OWNED and ALREADY_SUBSCRIBED on invoice and on pre_checkout`
  - `subscription first payment creates entitlement with expires_at`
  - `renewal with same payload adds row and moves expires_at; duplicate renewal no-op`
  - `cancel/resume call editUserStarSubscription and set canceled_at`
  - `has() false after expires_at; EntitlementGuard → 403 NO_ENTITLEMENT`
  - `refund of one_time calls onRefund and revokes entitlement; refund of subscription expires access and cancels`
  - `refundStarPayment failure leaves refund_pending; retryPendingRefunds completes it`
  - `test mode: admin in payments.test_users gets { settled: true }, amount 0, audit payment.test_settle`
  - `admin grant over active subscription → 409 ENTITLEMENT_HELD_BY_SUBSCRIPTION; admin DELETE subscription cancels in Telegram first`
  - `admin refund writes audit payment.refund`
  - `reconcile reports invoice_payment transactions missing from payments`
  - `payment.settled realtime event emitted after commit`
- [x] **Step 4: write `web.acceptance.test.tsx`** (vitest + jsdom + `installFakeWebApp` from `@dmytro-rudenko/tma-testing/dom`)
  - `tg works without WebApp: initDataRaw '' , openInvoice 'failed', no throw`
  - `Android adds 24px min bottom inset`
  - `openInvoice returns 'failed' when SDK throws`
  - `api client sends Authorization tma and maps ApiError`
  - `langFromCode`
  - `usePurchase: settled, paid, cancelled, failed, pending→payment.settled`
  - `useMe applies theme and language`
  - `useRealtimeEvent invalidates me/entitlements on reconnect`
- [x] **Step 5: write `testing.acceptance.spec.ts`**
  - `FakeBotApi.respond with times`
  - `blockedByUser / tooManyRequests replies`
  - `createTestDatabase clones template db and drop removes it`
  - `devUrl produces hash that validateInitData accepts`
- [x] **Step 6: write `skills/new/scaffold.test.sh`.** Bash, `set -euo pipefail`. On a temporary directory `$T` it checks:
  - (a) for each variant `empty` and `shop`: `scaffold.sh --dir "$T/my app <variant>" --slug demo-app --title "Кава’Клуб" --bot-username demo_app_bot --domain demo.example.com --variant <v>` → exit 0;
  - (b) `grep -rE '__[A-Z_]+__|tma:shop:'` in the result → nothing found;
  - (c) `empty` has no `apps/api/src/shop` and no `apps/web/src/features/shop`, `shop` has both;
  - (d) `deploy/nginx/demo-app.conf` exists;
  - (e) `.env` contains a 64-hex `WEBHOOK_SECRET` and `ADMIN_USER_IDS=1`;
  - (f) a products JSON with `"` in a description → `products.ts` passes `node --check` after transpilation (`npx tsc --noEmit` is not available here, so check with `node -e "require('typescript')..."`; if typescript is not available, look for the escaped `\"` via grep);
  - (g) an invalid slug, accent, title or non-empty `--dir` → exit 2;
  - (h) a leftover placeholder planted in a copy of the template → exit 3.

  It prints `All checks passed.` at the end.
- [x] **Step 7: run them, watch them fail.** `pnpm -r test` → modules `@dmytro-rudenko/tma-*` are not found. `bash skills/new/scaffold.test.sh` → `scaffold.sh: No such file`. The behaviour is missing.

### Task 1: monorepo skeleton
**Writes:** `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc`, `.prettierrc`, `.editorconfig`, `.gitignore`, `LICENSE`, `.changeset/config.json`, `packages/{nest-core,nest-bot,nest-payments,web,testing}/{package.json,tsconfig.json,tsconfig.build.json,LICENSE,src/index.ts}`, `packages/{nest-core,nest-bot,nest-payments,testing}/jest.config.js`, `packages/web/vitest.config.ts`
**Reads:** `/home/pc/projects/plivka/{package.json,tsconfig.base.json,.prettierrc,.editorconfig,apps/api/jest.config.js,apps/web/vite.config.ts}`
**Depends on:** Task 0
**Executor:** claude
**Complexity:** routine
**Interfaces:**
- Produces:
  - root scripts: `build` = `pnpm -r build`, `typecheck` = `pnpm -r typecheck`, `test` = `pnpm -r test`, `db:start` = `node packages/testing/dist/bin/tma-test-pg.js start` (after build), `db:stop`;
  - in each package: `build`, `typecheck` (`tsc --noEmit`) and `test`.
- `.changeset/config.json`: `{ "fixed": [["@dmytro-rudenko/tma-*"]], "access": "public", "baseBranch": "main", "updateInternalDependencies": "patch" }`.
- `pnpm-workspace.yaml`: `packages: ["packages/*"]`, `onlyBuiltDependencies: ["@nestjs/core", "esbuild"]`.
- Dependencies between packages:
  - `nest-bot` → `nest-core`;
  - `nest-payments` → `nest-core`, `nest-bot`;
  - every package → devDependency `testing`.
  - Peer dependencies are installed as devDependencies so packages build in the workspace.

- [x] Step 1: create the files with the values above. `src/index.ts` is `export {}`. `LICENSE` is MIT, `Copyright (c) 2026 Dmytro Rudenko`.
- [x] Step 2: `pnpm install && pnpm -r build && pnpm -r typecheck`. Expect exit 0.
- [x] Step 3: `pnpm -r test`. Expect the Task 0 acceptance specs to fail on imports (they are still red).

### Task 2: `@dmytro-rudenko/tma-testing`
**Writes:** `packages/testing/src/{index.ts,init-data.ts,updates.ts,webhook.ts,fake-bot-api.ts,database.ts,test-app.ts,wait-for.ts,dev-url.ts}`, `packages/testing/src/dom/index.ts`, `packages/testing/src/bin/tma-test-pg.ts`, `packages/testing/src/*.spec.ts`, `packages/testing/package.json`
**Reads:** `plivka/apps/api/test/utils/{test-app,init-data,fake-bot-api,http-error}.ts`, `plivka/scripts/test-pg.sh`, `plivka/e2e/telegram-stub.ts:36-125`
**Depends on:** Task 1
**Executor:** claude
**Complexity:** complex
**Satisfies:** `testing.acceptance.spec.ts`
**Interfaces:**
- Produces (exact signatures from spec §3.7):
  - `signInitData(user: TgUserInput, botToken: string, opts?: { authDate?: number; startParam?: string; extra?: Record<string,string> }): string`
  - `tmaAuth(user, botToken): string`, which returns `'tma ' + signInitData(...)`
  - `updates.message({ from, text })`, `updates.command(cmd, payload?, from?)`, `updates.preCheckoutQuery({ payload, totalAmount, from, currency = 'XTR' })`, `updates.successfulPayment({ payload, chargeId, totalAmount, from, subscriptionExpirationDate?, isRecurring?, isFirstRecurring? })`
  - `postWebhook(http: supertest.Agent, update, { pathToken, secret })`
  - `startFakeBotApi({ port? }): Promise<FakeBotApi>`:
    - members: `url`, `calls: {method, body}[]`, `callsOf(method)`, `reset()`, `respond(method, reply, { times? })`, `blockedByUser(method)`, `tooManyRequests(method, retryAfter)`, `badRequest(method, description)`, `close()`;
    - default replies for `sendMessage`, `createInvoiceLink` (returns `https://t.me/$fake/<n>`), `answerPreCheckoutQuery`, `refundStarPayment`, `editUserStarSubscription`, `getStarTransactions` (`{ transactions: [] }`), `setWebhook`, `setChatMenuButton`, `setMyCommands`, `setMyDescription`, `setMyShortDescription`, `savePreparedInlineMessage` (`{ id: 'prep-<n>' }`).
  - `createTestDatabase({ migrations: Knex.MigrationSource }): Promise<{ url, knex, drop() }>`:
    - template database `tma_tpl_<sha1(migration names).slice(0,12)>` under `pg_advisory_lock(727272)`;
    - per-test database `tma_t_<random10>` via `CREATE DATABASE … TEMPLATE …`;
    - `DROP DATABASE … WITH (FORCE)`.
  - `createTestApp({ imports: (ctx: { knex, botToken, apiRoot, databaseUrl }) => any[], migrations, overrides?: (b: TestingModuleBuilder) => TestingModuleBuilder, botToken? = '123456:test-token' })`:
    - returns `{ app, http, knex, fakeBot, botToken, tokenFor(user), close() }`;
    - `app.init()` without listen, `http = supertest(app.getHttpServer())`.
  - `waitFor(fn, timeoutMs = 2000)`
  - `devUrl({ baseUrl, user, botToken, startParam? })` → `${baseUrl}/#tgWebAppData=${encodeURIComponent(signed)}&tgWebAppVersion=8.0&tgWebAppPlatform=tdesktop`
  - `./dom`: `installFakeWebApp(win, overrides?)`. It installs `window.Telegram.WebApp` with `initData`, `version: '8.0'`, `platform`, `colorScheme`, `themeParams`, `safeAreaInset`, `contentSafeAreaInset`, `ready`, `expand`, `openInvoice(url, cb)`, `onEvent`/`offEvent`, `HapticFeedback`, `BackButton`, `isVersionAtLeast`. Calls are recorded in `win.__tgCalls`.
  - bin `tma-test-pg start|stop|status`: a port of `test-pg.sh`.
    - Search for `pg_ctl`: `PATH`, `/usr/lib/postgresql/16/bin`, `/opt/homebrew/opt/postgresql@16/bin`, `/usr/local/opt/postgresql@16/bin`.
    - Data directory `~/.cache/tma-test-pg/16`, port `54329`, `fsync=off`.
    - Locale `C.UTF-8` on Linux, `en_US.UTF-8` on darwin.
    - Under root, run `runuser -u postgres` as in plivka.
  - `package.json`: `bin: { "tma-test-pg": "dist/bin/tma-test-pg.js" }`, `exports: { ".": …, "./dom": … }`.

- [ ] Step 1: unit specs: `fake-bot-api.spec.ts` (respond/times, 403/429 bodies `{ ok:false, error_code, description, parameters:{retry_after} }`) and `init-data.spec.ts` (round-trip with an independent HMAC check).
- [ ] Step 2: `pnpm --filter @dmytro-rudenko/tma-testing test`. Expect failures: functions are missing.
- [ ] Step 3: implement by porting the plivka files listed in **Reads**. `jest` is not imported anywhere.
- [ ] Step 4: `pnpm --filter @dmytro-rudenko/tma-testing build && pnpm --filter @dmytro-rudenko/tma-testing test`. The unit specs and `testing.acceptance.spec.ts` must be green. The `createTestDatabase` case needs `pnpm db:start`.

### Task 3: tma-nest-core — module, auth, users, admin rights, common, health, migration
**Writes:** `packages/nest-core/src/{index.ts,core.module.ts,options.ts,tokens.ts}`, `src/auth/{init-data.ts,telegram-auth.guard.ts,public.decorator.ts,current-user.decorator.ts}`, `src/users/users.service.ts`, `src/admin-rights/{admin-rights.service.ts,admin.guard.ts}`, `src/common/{api-error.ts,error-codes.ts,user-throttler.guard.ts,validation.ts}`, `src/health/health.controller.ts`, `src/migrations/{index.ts,compose.ts,tma_core_001_init.ts}`, and the matching `*.spec.ts`
**Reads:** the plivka auth/admin-rights/admin/common/health/database files from Global constraints, spec §3.2–3.3
**Depends on:** Task 2
**Executor:** claude
**Complexity:** complex
**Satisfies:** `core.acceptance.spec.ts` (401, upsert, health, USER_BLOCKED, NOT_ADMIN, admin matrix minus audit, users list)
**Interfaces:**
- Produces:
  - `TmaCoreModule.forRoot(opts: TmaCoreOptions)`:
    - `TmaCoreOptions = { knex; botToken; adminUserIds: number[]; initDataMaxAgeSec?: 86400; auditRetentionDays?: 90; runWorker: boolean; throttle?: { ttlMs: 60000; limit: 120 } }`;
    - the module is `@Global`, it throws on an empty `botToken` or a missing `knex`, and registers `APP_GUARD` `TelegramAuthGuard`, then `UserThrottlerGuard`.
  - Tokens `TMA_KNEX`, `TMA_CORE_OPTIONS`.
  - `validateInitData(raw, botToken, maxAgeSec): TgUser | null`
  - `@Public()`, `@CurrentUser()` → `AuthUser { id, firstName, username, languageCode }`
  - `UsersService`:
    - `upsert(from: TgUser, trx?)`, `get(id)`, `isBlocked(id)`;
    - `list({ q?, cursor?, limit = 50 })`, cursor in the form `<created_at ISO>_<id>`;
    - `block(actorId, id)`, `unblock(actorId, id)`, `updatePrefs(id, { language?, theme? })`.
  - `AdminRightsService`: `isAdmin(id)`, `source(id): 'env'|'granted'|null`, `grant(actorId, id)`, `revoke(actorId, id)`.
  - `AdminGuard` → 403 `NOT_ADMIN`.
  - Order of checks: `USER_NOT_FOUND` → `CANNOT_TARGET_SELF` → env → grant/blocked → no-op. A no-op returns the card and writes no audit row.
  - `apiError(status, code, message?)`
  - `TMA_CORE_ERROR_CODES` (const array) and type `TmaCoreErrorCode`:
    `UNAUTHORIZED, USER_BLOCKED, NOT_ADMIN, USER_NOT_FOUND, CANNOT_BLOCK_ADMIN, CANNOT_GRANT_BLOCKED, CANNOT_REVOKE_ENV_ADMIN, CANNOT_TARGET_SELF, UNKNOWN_SETTING, VALIDATION, RATE_LIMITED`
  - `GET /api/health` → `{ ok: true }`, or 503 `{ ok: false }` when `select 1` fails.
  - `migrations` (MigrationSource with `tma_core_001_init`: `users`, `audit_events` and `app_settings` with the columns and indexes from spec §3.3), `composeMigrations(...sources)`.
- Consumes: `createTestApp` and `signInitData` (Task 2).
- In this task block/grant do not write audit yet. Task 4 adds audit inside the same transactions.

- [ ] Step 1: unit specs: `init-data.spec.ts` (port of plivka's 47 lines), `admin-rights.service.spec.ts` (the matrix), `compose.spec.ts` (order of names).
- [ ] Step 2: run → red.
- [ ] Step 3: implement by porting plivka. Remove the `hasGrantColumn`/`hasBlockedColumn` checks.
- [ ] Step 4: `pnpm --filter @dmytro-rudenko/tma-nest-core test`. Unit tests and the listed acceptance cases must be green. The audit, settings, realtime and cards cases stay red.

### Task 4: tma-nest-core — audit, app settings, realtime, admin/me API, card registry
**Writes:** `packages/nest-core/src/audit/audit.service.ts`, `src/app-settings/{app-settings.service.ts,registry.ts,define-setting.ts}`, `src/realtime/{realtime.gateway.ts,realtime.service.ts}`, `src/admin/{admin-users.controller.ts,admin-settings.controller.ts,admin-audit.controller.ts,admin-user-card.registry.ts}`, `src/me/me.controller.ts`, `src/core.module.ts`, `src/index.ts`, `src/users/users.service.ts`, `src/admin-rights/admin-rights.service.ts`, and the matching `*.spec.ts`
**Reads:** `retro-game-bot/apps/server/src/audit/audit.service.ts`, `plivka/apps/api/src/{app-settings,realtime,admin}/*`, spec §3.3
**Depends on:** Task 3
**Executor:** claude
**Complexity:** complex
**Satisfies:** the rest of `core.acceptance.spec.ts`
**Interfaces:**
- Produces:
  - `AuditService.record(db: Knex | Knex.Transaction, { actorId, action, targetType?, targetId?, meta? })`:
    - `meta` is cut to 4096 bytes of JSON;
    - prune runs every 24 h when `runWorker` is on and deletes rows with `at < now() - auditRetentionDays`.
  - Core actions: `user.block`, `user.unblock`, `admin.grant`, `admin.revoke`, `settings.update`. They are written inside the transaction of `UsersService.block` and `AdminRightsService.grant`.
  - Settings:
    - `defineSetting<T>({ key, default, parse })`;
    - `AppSettingsRegistry.register(def)` (packages call it in `onModuleInit`);
    - `AppSettingsService.get<T>(key)` (30 s cache, clock token `APP_SETTINGS_CLOCK`) and `set(actorId, key, value)`;
    - errors `UNKNOWN_SETTING` / `VALIDATION`.
  - Realtime:
    - `TmaRealtimeGateway` on path `/api/socket.io`, `maxHttpBufferSize: 10_000`; auth via `handshake.auth.initData`; checks `isBlocked` before joining `user:<id>`;
    - `RealtimeService.emitToUser(userId, event, payload)` does nothing before init and only logs errors.
  - `AdminUserCardRegistry.register(key, (userId) => Promise<unknown>)`.
  - HTTP:
    - `GET/PATCH /api/me` → `{ id, firstName, username, language, theme, isAdmin, adminSource }`;
    - `/api/admin/users`, `/users/:id` (with `cards`), `/users/:id/block` (POST/DELETE), `/users/:id/admin` (POST/DELETE);
    - `GET/PATCH /api/admin/settings` → `{ key, value, default }[]`;
    - `GET /api/admin/audit?actorId&targetType&targetId&cursor`, 50 per page.
- Consumes: `UsersService`, `AdminRightsService` and the module (Task 3).

- [ ] Step 1: unit specs: `app-settings.service.spec.ts` (cache with a fake clock, parse, unknown key; port of plivka's 121 lines), `audit.service.spec.ts` (truncate meta, prune), `realtime.gateway.spec.ts` (valid, invalid and expired initData — Review Focus 4).
- [ ] Step 2: red.
- [ ] Step 3: implement.
- [ ] Step 4: `pnpm --filter @dmytro-rudenko/tma-nest-core test`. The whole of `core.acceptance.spec.ts` must be green.

### Task 5: tma-nest-bot — module, webhook, middleware, commands, i18n, notifications, prepared messages
**Writes:** `packages/nest-bot/src/{index.ts,bot.module.ts,options.ts,bot.service.ts,bot.controller.ts,start-param.router.ts,copy.ts,lang.ts,notifications.service.ts,prepared-messages.service.ts}`, `src/migrations/{index.ts,tma_bot_001_users_bot_blocked_at.ts}`, and the matching `*.spec.ts`
**Reads:** `plivka/apps/api/src/bot/{bot.controller,bot.service,i18n,notifications.service}.ts`, `retro-game-bot/apps/server/src/bot/prepared-messages.ts`, spec §3.4
**Depends on:** Task 4
**Executor:** claude
**Complexity:** complex
**Satisfies:** `bot.acceptance.spec.ts` (webhook, critical, blocked, bot_blocked_at, StartParamRouter, NotificationsService)
**Interfaces:**
- Produces:
  - `TmaBotModule.forRoot({ botToken, botUsername, webappUrl, webhookPathToken, webhookSecret, apiRoot?, copy?, startParams?: StartParamRoute[], runWorker })`.
  - `BotService`:
    - `bot: Bot`, `on(filter, handler, { critical? })`, `command(name, handler)`, `startAppUrl(param)`;
    - `isCritical(update)` uses `matchFilter`.
  - `POST /bot/:pathToken` with `@Public()` + `@SkipThrottle()`: `timingSafeEqual` on the path token and on `X-Telegram-Bot-Api-Secret-Token`, otherwise 401. Errors: critical → 500, others → 200.
  - Middleware: `touch` (upsert + `bot_blocked_at = null`), then `blocked` (non-critical updates are dropped for a blocked non-env-admin).
  - `/start [param]` goes through the `StartParamRoute { pattern: RegExp; handle(ctx, match) }` routes, otherwise `greet` with a `web_app` button. `/help` sends `copy.help`.
  - `BotCopy` keys: `greeting(name?)`, `openButton`, `help`, `payRejected`, `paymentReceived(title)`, `subscriptionRenewed(title, until)`, `subscriptionCanceled(title, until)`, `paymentRefunded(title, stars)`. `null` means "do not send". Defaults are uk/en.
  - `langOf(code)`, `escapeHtml`.
  - `NotificationsService.send(userId, text: (lang) => string, opts?: { markup? })`:
    - returns `'sent'|'skipped'|'bot_blocked'|'failed'` and never throws;
    - skips `blocked_at`/`bot_blocked_at`;
    - 403 → `bot_blocked_at = now()`, 429 → wait `retry_after` and retry once;
    - `guard(what, fn)`.
  - `PreparedMessagesService.save(userId, result)`.
  - `migrations` with `tma_bot_001_users_bot_blocked_at`.
  - Registers the `bot` card in `AdminUserCardRegistry`: `{ botBlockedAt }`.
  - `TMA_BOT_ERROR_CODES` = `[]`. The bot has no HTTP errors of its own beyond core's; the array exists so Task 16 has a uniform aggregation.
- Consumes: `UsersService`, `AdminRightsService`, `AdminUserCardRegistry` (Tasks 3–4), `FakeBotApi` (Task 2).

- [ ] Step 1: unit specs: `lang.spec.ts`, `start-param.router.spec.ts`, `notifications.service.spec.ts` (403/429 through `FakeBotApi`).
- [ ] Step 2: red.
- [ ] Step 3: implement by porting plivka. Generalize `isPaymentUpdate` into the critical filters.
- [ ] Step 4: `pnpm --filter @dmytro-rudenko/tma-nest-bot test`. The listed acceptance cases must be green.

### Task 6: tma-nest-bot — broadcast and `tma-bot setup`
**Writes:** `packages/nest-bot/src/broadcast/{broadcast.service.ts,broadcast.worker.ts,broadcast-admin.controller.ts,audience.registry.ts}`, `src/migrations/tma_bot_002_broadcasts.ts`, `src/migrations/index.ts`, `src/bin/tma-bot.ts`, `src/setup/sync-bot-profile.ts`, `src/bot.module.ts`, `src/index.ts`, `packages/nest-bot/package.json`, and the matching `*.spec.ts`
**Reads:** `retro-game-bot/apps/server/src/bot/bot-profile.ts`, `plivka/deploy/{set-webhook.sh,bot-profile.json}`, spec §3.4 Broadcast
**Depends on:** Task 5
**Executor:** claude
**Complexity:** complex
**Satisfies:** `bot.acceptance.spec.ts` (broadcast cases, `tma-bot setup`)
**Interfaces:**
- Produces:
  - Tables `broadcasts` and `broadcast_deliveries`, exactly as in spec §3.4.
  - `BroadcastAudienceRegistry.register({ key, label, apply(qb, value) })`
  - `BroadcastService.create(adminId, { text, button?: { text, startParam? }, audience: { languages?, filters? } })`:
    - one transaction: insert, `INSERT … SELECT` of recipients, audit `broadcast.create { total, audience }`;
    - an unknown filter → 400 `VALIDATION`.
  - Worker (`runWorker`):
    - pick the oldest `queued`/`running` broadcast, claim 25 `pending` rows `FOR UPDATE SKIP LOCKED`, wait 40 ms between messages;
    - 429 → pause `retry_after`; 403 → `failed` + `bot_blocked_at`; other 4xx → `failed`; 5xx → `attempts++`, `failed` after 3 attempts;
    - counters update after every batch, `done` when nothing is left.
  - API `/api/admin/broadcasts`: `POST`, `POST preview`, `POST estimate` → `{ total }`, `GET audience-filters` → `[{ key, label }]`, `GET`, `GET :id`, `POST :id/cancel` (audit `broadcast.cancel`).
  - bin `tma-bot setup`:
    - env `BOT_TOKEN`, `WEBAPP_URL`, `WEBHOOK_PATH_TOKEN`, `WEBHOOK_SECRET`, `BOT_PROFILE`, optional `BOT_API_ROOT`;
    - `setWebhook({ url: WEBAPP_URL + '/bot/' + token, secret_token, allowed_updates: ['message','callback_query','pre_checkout_query'] })`, then `syncBotProfile` with `Promise.allSettled`;
    - exit 1 when the webhook fails, exit 2 when the profile fails;
    - `package.json` `bin: { "tma-bot": "dist/bin/tma-bot.js" }`.
- Consumes: `BotService`, `NotificationsService`, `AuditService`.

- [ ] Step 1: unit specs: `audience.registry.spec.ts`, `sync-bot-profile.spec.ts` (an en fallback without a language code).
- [ ] Step 2: red.
- [ ] Step 3: implement. The Review Focus 3 test goes into the acceptance cases through `FakeBotApi.blockedByUser` mid-batch.
- [ ] Step 4: `pnpm --filter @dmytro-rudenko/tma-nest-bot test`. The whole of `bot.acceptance.spec.ts` must be green.

### Task 7: tma-nest-payments — registry, payload, tables, invoice, pre_checkout, successful_payment, entitlements
**Writes:** `packages/nest-payments/src/{index.ts,payments.module.ts,options.ts,product.ts,product.registry.ts,invoice-payload.ts,payment-recorder.ts,payments.service.ts,entitlements.service.ts,entitlement.guard.ts,payments.controller.ts,error-codes.ts,settings.ts}`, `src/migrations/{index.ts,tma_payments_001_payments.ts,tma_payments_002_entitlements.ts}`, and the matching `*.spec.ts`
**Reads:** `plivka/apps/api/src/payments/{invoice-payload,payment-recorder,payments.service,payments.controller}.ts`, spec §3.5
**Depends on:** Task 5
**Executor:** claude
**Complexity:** complex
**Satisfies:** `payments.acceptance.spec.ts` (one_time end-to-end, pre_checkout, duplicate, double-pay refund_pending, ALREADY_*, subscription first/renewal, has/guard, test mode)
**Interfaces:**
- Produces:
  - `TmaPaymentsModule.forRoot({ products: Product[], runWorker, refundRetryIntervalMs = 300000 })`.
  - The `Product` interface, exactly as in spec §3.5, including `onRefund?` and `repeatable?`.
  - Registry validation:
    - id must match `/^[a-z0-9_]{1,24}$/` and be unique;
    - `lock` requires `settle`;
    - title is 1–32 characters, description 1–255.
  - `makePayload` and `parsePayload`: format `<productId>:<targetId|->:<nonce11>`, at most 128 bytes.
  - Tables `payments` and `entitlements`, exactly as in spec §3.5, including the partial UNIQUE `invoice_payload WHERE is_recurring = false`.
  - `PaymentsService.createInvoiceLink(userId, productId, targetId?)` → `{ invoiceLink } | { settled: true }`.
  - `EntitlementsService.has(userId, productId)`, `list(userId)`.
  - `EntitlementGuard(productId)` → 403 `NO_ENTITLEMENT`.
  - Setting `payments.test_users: number[]`, default `[]`.
  - Critical handlers `pre_checkout_query` and `message:successful_payment`, registered through `BotService.on(…, { critical: true })`.
  - After commit: `emitToUser(payer, 'payment.settled', { productId, paymentId })` and a notification `paymentReceived` / `subscriptionRenewed`.
  - HTTP:
    - `GET /api/products?targetId=` → `[{ id, kind, repeatable, priceStars, title, description }]`;
    - `POST /api/payments/invoice`;
    - `GET /api/entitlements` → `[{ productId, source, expiresAt, canceled }]`.
  - `TMA_PAYMENTS_ERROR_CODES`: `NO_ENTITLEMENT, PRODUCT_NOT_FOUND, PRODUCT_UNAVAILABLE, ALREADY_SUBSCRIBED, ALREADY_OWNED, ENTITLEMENT_HELD_BY_SUBSCRIPTION, NO_SUBSCRIPTION, PAYMENT_NOT_FOUND, ALREADY_REFUNDED, PAYMENT_PROVIDER_UNAVAILABLE`.
  - A renewal for a blocked user is still recorded (Review Focus 2).
  - Parallel duplicate deliveries are serialized by UNIQUE on the charge plus `onConflict().ignore()`: `settle` runs only when the insert returned a row (Review Focus 1).
- Consumes: `BotService.on`, `NotificationsService`, `RealtimeService`, `AppSettingsRegistry`, `UsersService.upsert(from, trx)`.

- [ ] Step 1: unit specs: `invoice-payload.spec.ts` (port of plivka's 48 lines) and `product.registry.spec.ts`.
- [ ] Step 2: red.
- [ ] Step 3: implement by porting `payment-recorder.ts`. Replace `payable.ts` with the registry.
- [ ] Step 4: `pnpm --filter @dmytro-rudenko/tma-nest-payments test`. The listed acceptance cases must be green, plus the Review Focus 1 and 2 tests.

### Task 8: tma-nest-payments — refund/retry, cancel/resume, admin API, reconcile, audience filter, card
**Writes:** `packages/nest-payments/src/{refunds.service.ts,subscriptions.controller.ts,admin-payments.controller.ts,admin-entitlements.controller.ts,reconcile.service.ts,payments.module.ts,index.ts}`, and the matching `*.spec.ts`
**Reads:** `plivka/apps/api/src/payments/payments.service.ts:190-260`, spec §3.5
**Depends on:** Task 6, Task 7
**Executor:** claude
**Complexity:** complex
**Satisfies:** the rest of `payments.acceptance.spec.ts`
**Interfaces:**
- Produces:
  - `refund()`, `retryPendingRefunds()` (interval `refundRetryIntervalMs` when `runWorker` is on), handling of `alreadyRefunded`.
  - Any refund calls `onRefund` in the transaction and revokes the entitlement that came from this payment. A subscription refund additionally sets `expires_at = now()` and calls `editUserStarSubscription(is_canceled: true)`.
  - Notification `paymentRefunded`.
  - `POST /api/subscriptions/:productId/cancel|resume`; cancel sends notification `subscriptionCanceled`.
  - Admin API:
    - `GET /api/admin/payments?userId&status&cursor`, `POST /api/admin/payments/:id/refund` (audit `payment.refund`);
    - `POST /api/admin/users/:id/entitlements` (`source='grant'`, 409 `ENTITLEMENT_HELD_BY_SUBSCRIPTION`, audit `entitlement.grant`);
    - `DELETE /api/admin/users/:id/entitlements/:productId` (subscription → cancel in Telegram first, 502 when that fails; audit `entitlement.revoke`);
    - `POST /api/admin/payments/reconcile` (`getStarTransactions`, limit 100).
  - `BroadcastAudienceRegistry.register({ key: 'entitlement', label: 'Active product', apply })`.
  - Card `payments`: `{ payments: last 20, entitlements }`.
- Consumes: `BroadcastAudienceRegistry` (Task 6), `AdminUserCardRegistry` (Task 4), `PaymentsService` (Task 7).

- [ ] Step 1: unit spec `refunds.service.spec.ts` (`alreadyRefunded`, retry).
- [ ] Step 2: red.
- [ ] Step 3: implement.
- [ ] Step 4: `pnpm --filter @dmytro-rudenko/tma-nest-payments test`. The whole of `payments.acceptance.spec.ts` must be green.

### Task 9: `@dmytro-rudenko/tma-web`
**Writes:** `packages/web/src/{index.ts,tg.ts,theme.ts,prefs.ts,i18n.ts,api.ts,tma-api.ts,error-codes.ts,realtime.ts}`, `packages/web/src/react/{index.ts,provider.tsx,query-client.ts,keys.ts,use-me.ts,use-update-me.ts,use-products.ts,use-entitlement.ts,use-purchase.ts,use-realtime-event.ts}`, `packages/web/src/**/*.test.ts(x)`, `packages/web/package.json`
**Reads:** `plivka/apps/web/src/{telegram/tg.ts,theme/applyTheme.ts,state/prefs.ts,i18n/index.ts,api/client.ts,api/hooks.ts,realtime/*}`, `retro-game-bot/apps/miniapp/src/telegram.ts:56-66`, spec §3.6
**Depends on:** Task 2
**Executor:** claude
**Complexity:** complex
**Satisfies:** `web.acceptance.test.tsx`
**Interfaces:**
- Produces:
  - Everything listed in spec §3.6, with exactly those names.
  - `TMA_ERROR_CODES` is the union of the code lists from Tasks 3, 5 and 7, written out literally: `UNAUTHORIZED, USER_BLOCKED, NOT_ADMIN, USER_NOT_FOUND, CANNOT_BLOCK_ADMIN, CANNOT_GRANT_BLOCKED, CANNOT_REVOKE_ENV_ADMIN, CANNOT_TARGET_SELF, UNKNOWN_SETTING, VALIDATION, RATE_LIMITED, NO_ENTITLEMENT, PRODUCT_NOT_FOUND, PRODUCT_UNAVAILABLE, ALREADY_SUBSCRIBED, ALREADY_OWNED, ENTITLEMENT_HELD_BY_SUBSCRIPTION, NO_SUBSCRIPTION, PAYMENT_NOT_FOUND, ALREADY_REFUNDED, PAYMENT_PROVIDER_UNAVAILABLE`, plus type `TmaApiErrorCode`.
  - `tmaApi(client)` exposes the methods `me`, `updateMe`, `products`, `createInvoice`, `entitlements`, `cancelSubscription`, `resumeSubscription`, `admin.users.{list,get,block,unblock,grant,revoke}`, `admin.settings.{list,set}`, `admin.audit.list`, `admin.broadcasts.{list,get,create,preview,estimate,audienceFilters,cancel}`, `admin.payments.{list,refund,reconcile}`, `admin.entitlements.{grant,revoke}`. Each takes paths and DTOs exactly as in the HTTP tables of spec §3.3–3.5.
- Consumes: `installFakeWebApp` (Task 2, `./dom`).

- [ ] Step 1: unit tests `tg.test.ts`, `api.test.ts`, `i18n.test.ts`, `react/use-purchase.test.tsx`.
- [ ] Step 2: red.
- [ ] Step 3: implement by porting plivka.
- [ ] Step 4: `pnpm --filter @dmytro-rudenko/tma-web test`. `web.acceptance.test.tsx` must be green.

### Task 10: `scaffold.sh` and smoke of the template
**Writes:** `skills/new/scaffold.sh`, `scripts/smoke-template.sh`
**Reads:** spec §3.9–3.10, §3.12
**Depends on:** Task 1
**Executor:** claude
**Complexity:** complex
**Satisfies:** `scaffold.test.sh`, fully green after Task 15
**Interfaces:**
- Produces `scaffold.sh` (bash, `set -euo pipefail`, Linux + macOS; text replacement through `perl -pi -e`; every path is quoted, Review Focus 5).
  - **Arguments.** `--dir --slug --title --bot-username --domain --variant empty|shop [--default-lang uk] [--accent '#2f80ed'] [--admin-ids ''] [--api-port 3200] [--products file.json] [--tma-source dir]`.
  - **Validation (exit 2):**
    - slug `^[a-z][a-z0-9-]{1,30}$`;
    - title 2–32 characters from `[\p{L}\p{N} .,\-!?:’]` (checked via `perl -CSA`);
    - bot-username `^[A-Za-z0-9_]{5,32}$`;
    - domain without a scheme and without `/`;
    - accent `^#[0-9a-fA-F]{6}$`;
    - api-port 1024–65535;
    - `--dir` missing or empty;
    - products JSON per the spec §3.11 schema (checked via `node -e`), and it contains `premium` with kind `subscription`.
  - **Copy** `${PLUGIN_ROOT}/template/` without `node_modules`, `dist` and `.env`. `PLUGIN_ROOT` is `$(cd "$(dirname "$0")/../.." && pwd)`.
  - **Variant:**
    - `empty` removes `apps/api/src/shop`, `apps/web/src/features/shop` and `apps/web/src/i18n/shop.*.json`, plus the contents of the `tma:shop:start..end` blocks together with the markers (both the `//` and the `/* */` form);
    - `shop` removes only the marker lines.
  - **Products.** For `shop` with `--products`, generate `apps/api/src/products.ts` through `node -e` + `JSON.stringify`.
  - **Placeholders.** Replace `__APP_SLUG__`, `__APP_DB__`, `__APP_TITLE__`, `__BOT_USERNAME__`, `__DOMAIN__`, `__DEFAULT_LANG__`, `__ACCENT__`, `__TMA_VERSION__` (from `${PLUGIN_ROOT}/.claude-plugin/plugin.json` `version`) and `__API_PORT__` in text files (`file --mime-encoding` ≠ binary), and rename files and directories that contain placeholders.
  - **`--tma-source`:** dependencies `"@dmytro-rudenko/tma-<x>": "<ver>"` become `"file:<dir>/dmytro-rudenko-tma-<x>-<ver>.tgz"`.
  - **`.env`** from `.env.example`:
    - `WEBHOOK_SECRET` and `WEBHOOK_PATH_TOKEN` via `openssl rand -hex 32`;
    - `BOT_TOKEN=000000:dev-local-token`, `BOT_API_ROOT=http://127.0.0.1:3199`, `DATABASE_URL=postgres://postgres@127.0.0.1:54329/<app_db>`;
    - `ADMIN_USER_IDS=<ids or 1>`.
  - **Self-check (exit 3):** `grep -rlE '__[A-Z_]+__|tma:shop:'`.
  - **Completion:** print `scaffolded <dir> (<variant>)`.
- Produces `scripts/smoke-template.sh <variant>`:
  1. `pnpm -r build`;
  2. `pnpm -r exec pnpm pack --pack-destination "$TMP/tarballs"`;
  3. `scaffold.sh --dir "$TMP/app" --slug smoke-app --title "Smoke App" --bot-username smoke_app_bot --domain smoke.example.com --variant $1 --tma-source "$TMP/tarballs"`;
  4. in the result: `pnpm install`, `pnpm db:create`, `pnpm db:migrate`, `pnpm -r typecheck`, `pnpm -r test`, `pnpm -r build`;
  5. on success print `smoke OK: $1`.
- [ ] Step 1: the test already exists (`scaffold.test.sh`, Task 0).
- [ ] Step 2: `bash skills/new/scaffold.test.sh`. The argument checks (g) should pass. Steps (a)–(f) fail because the template is missing.
- [ ] Step 3: implement both scripts.
- [ ] Step 4: on a temporary `template/` fixture of three files with placeholders and a shop block (created inside the test via `PLUGIN_ROOT` override `TMA_PLUGIN_ROOT`), cases (b), (e), (g) and (h) must be green. The full green run comes after Task 15.

### Task 11: `skills/new/SKILL.md`
**Writes:** `skills/new/SKILL.md`
**Reads:** spec §3.11
**Depends on:** Task 1
**Executor:** claude
**Complexity:** routine
**Interfaces:**
- Consumes: the `scaffold.sh` flags (Task 10, listed above).
- Frontmatter:
  ```
  name: new
  description: Use when the user asks to create a new Telegram Mini App, start a TMA project, or scaffold a mini app with users, admin rights and Telegram Stars payments. Interviews for the variant (empty or shop) and parameters, generates the project from the tma-starter template and brings it to locally green tests
  version: 0.0.0
  ```
- Body, in Ukrainian. The dialogue language is the user's language.
  - **Preflight:** Node ≥ 26.13, pnpm 10, `perl`, `openssl`, `pg_ctl` (the paths from Task 2). Without Postgres, offer the install command (`apt install postgresql-16` / `brew install postgresql@16`) or a `DATABASE_ADMIN_URL`.
  - **Interview:** the 7 questions from spec §3.11, each in its own `AskUserQuestion`. Options for question 1 are «Порожній каркас» / «Демо-магазин». Accent presets are `#2f80ed`, `#e5484d`, `#30a46c`. Product JSON schema and default products: `premium` subscription 250, `coffee` one_time repeatable 50, with titles and descriptions in uk/en.
  - **Summary,** then `bash "${CLAUDE_PLUGIN_ROOT}/skills/new/scaffold.sh" …`.
  - **In the project:**
    - `pnpm install`;
    - `pnpm db:start` (skip when `DATABASE_ADMIN_URL` is set);
    - `pnpm db:create`, `pnpm db:migrate`;
    - `pnpm -r typecheck`, `pnpm -r test`, `pnpm -r build`.
  - **Failure:** show the output and stop. Do not patch the template; suggest an issue at `https://github.com/dmytro-rudenko/tma-starter/issues`.
  - **Commit:** `git init -b main && git add -A && git commit -m "chore: scaffold from tma-starter <version>"`.
  - **Final message:** `pnpm dev` / `devUrl`, the deploy checklist from `README.md`, and flags for default values (bot, domain, admins `1`). The bot's fallback language is `en`.
- [ ] Step 1: write the file.
- [ ] Step 2: `head -5 skills/new/SKILL.md` shows valid frontmatter. `grep -c AskUserQuestion skills/new/SKILL.md` ≥ 7.

### Task 12: template — deploy, CI workflow, docs, rules
**Writes:** `template/deploy/{docker-compose.yml,deploy.sh,deploy.test.sh,server-setup.sh,server-setup.test.sh,backup.sh,check.sh,README.md}`, `template/deploy/nginx/{__APP_SLUG__.conf,__APP_SLUG__-bootstrap.conf}`, `template/apps/api/Dockerfile`, `template/.github/workflows/deploy.yml`, `template/CLAUDE.md`, `template/README.md`, `template/.claude/rules/{architecture,code-organization,code-style,server,web,deploy}.md`
**Reads:** `plivka/deploy/*`, `plivka/apps/api/Dockerfile`, `plivka/.github/workflows/deploy.yml`, `plivka/CLAUDE.md`, `plivka/.claude/rules/*`, spec §3.9 Деплой / CLAUDE.md
**Depends on:** Task 1
**Executor:** claude
**Complexity:** routine
**Interfaces:**
- Produces files with placeholders:
  - `plivka` → `__APP_SLUG__` (paths, compose project, nginx file names) or `__APP_DB__` (`pg_dump`, database user);
  - the domain → `__DOMAIN__`;
  - host port `3200` → `__API_PORT__` (compose, nginx `proxy_pass`, `check.sh`, `deploy.test.sh`).
- Remove `/media`, `MALLOC_ARENA_MAX`, the photo rsync in `backup.sh`, and `set-webhook.sh`.
- `deploy.sh` order:
  1. `up -d --wait postgres`;
  2. `docker compose run --rm api node dist/database/migrate.js latest`;
  3. `up -d api`;
  4. health `/api/health`;
  5. `docker compose exec -T api npx tma-bot setup`, with env `BOT_PROFILE=/app/apps/api/bot/profile.json`.
- `deploy.yml` from plivka, `--filter @plivka/shared` removed.
- The `README.md` "Deploy" checklist has the six steps from spec §3.9. The "Оновлення пакетів" section: `pnpm up -r '@dmytro-rudenko/tma-*@latest'` + `pnpm db:migrate`.
- `CLAUDE.md` and rules follow spec §3.9, including the rule "infrastructure lives in `@dmytro-rudenko/tma-*`; extend it through `forRoot`/registries/`copy`".
- [ ] Step 1: adapt `deploy.test.sh` (port of plivka) to the new order.
- [ ] Step 2: copy into a temporary directory with `sed` substitution of the placeholders, run `bash deploy/deploy.test.sh` → it must fail on the old order (before the edits).
- [ ] Step 3: edit the files.
- [ ] Step 4: same run → `deploy.test.sh` and `server-setup.test.sh` are green.

### Task 13: template — root and `apps/api`
**Writes:** `template/{package.json,pnpm-workspace.yaml,tsconfig.base.json,.nvmrc,.prettierrc,.editorconfig,.gitignore,.env.example}`, `template/scripts/{dev.mjs,db-create.mjs}`, `template/apps/api/{package.json,tsconfig.json,tsconfig.build.json,nest-cli.json,jest.config.js}`, `template/apps/api/src/{main.ts,app.module.ts,products.ts}`, `template/apps/api/src/config/{env.ts,config.module.ts}`, `template/apps/api/src/database/{database.module.ts,migrate.ts,migrations/.gitkeep}`, `template/apps/api/src/features/example/{example.module.ts,example.controller.ts}`, `template/apps/api/bot/profile.json`, `template/apps/api/test/{app.acceptance.spec.ts,env.spec.ts}`
**Reads:** `plivka/apps/api/src/{main.ts,app.module.ts,config/env.ts,database/*}`, `plivka/package.json`, spec §3.9 `apps/api`
**Depends on:** Task 8, Task 9
**Executor:** claude
**Complexity:** complex
**Satisfies:** `scaffold.test.sh` (a)–(f) for `empty` together with Task 14, `smoke-template.sh empty`
**Interfaces:**
- Produces:
  - **npm scope of the application:** `@__APP_SLUG__/api`, `@__APP_SLUG__/web`. The `@dmytro-rudenko/tma-*` dependencies are pinned to `__TMA_VERSION__`.
  - **Root scripts:** `dev`, `db:start`, `db:stop` (`tma-test-pg`), `db:create` (`node scripts/db-create.mjs`), `db:migrate`, `build`, `typecheck`, `test`.
  - **`.env.example`:** `BOT_TOKEN=`, `BOT_USERNAME=__BOT_USERNAME__`, `WEBAPP_URL=https://__DOMAIN__`, `WEBHOOK_SECRET=`, `WEBHOOK_PATH_TOKEN=`, `DATABASE_URL=`, `PORT=3100`, `BOT_API_ROOT=`, `RUN_WORKER=true`, `API_RATE_LIMIT=120`, `ADMIN_USER_IDS=`, `INIT_DATA_MAX_AGE_SEC=86400`.
  - **`app.module.ts`:**
    - order `ConfigModule`, `DatabaseModule`, `TmaCoreModule.forRoot`, `TmaBotModule.forRoot` (`copy` from `bot/copy.ts` is absent, so the defaults apply), `TmaPaymentsModule.forRoot({ products })`, `ExampleModule`;
    - the block `// tma:shop:start` `ShopModule` import + entry `// tma:shop:end`.
  - **`products.ts`:** `export const products: Product[] = [ // tma:shop:start ` the default premium and coffee products ` // tma:shop:end ]`.
  - **`AppModule` factory for tests:** `export function appImports(ctx)`, reused by `app.acceptance.spec.ts` and `main.ts`.
  - **`GET /api/example/hello`** → `{ greeting }`.
  - **`dev.mjs`:**
    - starts FakeBot on 3199, the API (`node --watch dist/main.js` after `nest build --watch`), and `vite` on 5173;
    - seeds `app_settings` `payments.test_users` with `ADMIN_USER_IDS` when the key is missing;
    - prints `devUrl({ baseUrl: 'http://localhost:5173', user: { id: firstAdmin, first_name: 'Dev' }, botToken })`.
  - **`db-create.mjs`:** creates the database from `DATABASE_URL` when it is missing.
  - **`bot/profile.json`:** `menuButtonText: "__APP_TITLE__"`, uk/en descriptions, commands `start` and `help`.
  - **Tests:** `app.acceptance.spec.ts` covers `/api/health`, `/api/me`, `/api/example/hello`, 403 on `/api/admin/users` for a non-admin, plus a marker block `tma:shop` with the case "premium paid → `GET /api/premium/content` 200, without it 403". `env.spec.ts` covers the required variables.
- Consumes: all the APIs of Tasks 3–9.
- [ ] Step 1: write the template tests (the files above).
- [ ] Step 2: `bash scripts/smoke-template.sh empty` → it fails at install or tests.
- [ ] Step 3: implement.
- [ ] Step 4: `bash scripts/smoke-template.sh empty` → the api part is green. The web part comes in Task 14, which runs in the same wave; the full `smoke OK: empty` happens after both are done.

### Task 14: template — `apps/web` (base screens and admin)
**Writes:** `template/apps/web/{package.json,tsconfig.json,vite.config.ts,index.html}`, `template/apps/web/src/{main.tsx,App.tsx}`, `template/apps/web/src/state/{stack.ts,tabs.ts}`, `template/apps/web/src/features/registry.tsx`, `template/apps/web/src/features/{home,settings,nav}/**`, `template/apps/web/src/features/admin/{AdminUsersSheet,AdminUserSheet,AdminSettingsSheet,AdminBroadcastsSheet,AdminBroadcastSheet,AdminBroadcastNewSheet,AdminPaymentsSheet,AdminAuditSheet,AdminConfirm}.tsx`, `template/apps/web/src/features/admin/Admin.module.css`, `template/apps/web/src/components/**`, `template/apps/web/src/theme/{tokens.css,global.css}`, `template/apps/web/src/i18n/{index.ts,uk.json,en.json}`, `template/apps/web/src/api/{client.ts,errorText.ts,adminHooks.ts}`, `template/apps/web/src/**/*.test.tsx`
**Reads:** `plivka/apps/web/src/{App.tsx,state/*,features/registry.tsx,features/nav/*,features/settings/*,features/admin/*,components/**,theme/global.css,api/errorText.ts}`, spec §3.9 `apps/web` and Екрани
**Depends on:** Task 9
**Executor:** claude
**Complexity:** routine
**Satisfies:** `smoke-template.sh empty` (web part)
**Interfaces:**
- Produces:
  - `Tab = 'home' | 'settings' /* tma:shop:start */ | 'shop' /* tma:shop:end */`.
  - `EntryKind` from spec §3.9, plus `'paywall'` inside a marker block.
  - Marker blocks in `registry.tsx` (`paywall` → `features/shop/PaywallSheet`) and in `i18n/index.ts` (import of `shop.uk.json`/`shop.en.json`).
  - `errorText.ts` is a `Record<TmaApiErrorCode, string>` per language.
  - Screens and behaviour follow spec §3.9 «Екрани»:
    - debounce 300 ms in Users, debounce 500 ms in `estimate`, polling every 3 s for a broadcast in progress;
    - the settings editor picks its control by the type of `default`.
- Tests (vitest + jsdom + `installFakeWebApp`): `i18n.test.ts` (key parity uk/en), `errorText.test.ts` (covers all of `TMA_ERROR_CODES`), `AdminSettingsSheet.test.tsx` (boolean/number/string/number[]/json), `AdminUserSheet.test.tsx` (renders `cards.bot`, `cards.payments`).
- Consumes: `@dmytro-rudenko/tma-web` and `./react` (Task 9).
- [ ] Step 1: write the tests.
- [ ] Step 2: inside `smoke-template.sh empty` (or a local scaffold into `/tmp`), `pnpm --filter @smoke-app/web test` → red.
- [ ] Step 3: implement. Port `Sheet`, `FullscreenLayer`, `Toast`, `Avatar`, `AdminConfirm`, `BlockedScreen` and `useDebounced` without changes.
- [ ] Step 4: `bash scripts/smoke-template.sh empty` → `smoke OK: empty`. This requires Task 13.

### Task 15: template — shop variant
**Writes:** `template/apps/api/src/shop/{shop.module.ts,premium.controller.ts}`, `template/apps/web/src/features/shop/{ShopTab.tsx,PaywallSheet.tsx,PremiumBlock.tsx,SubscriptionSection.tsx,ShopTab.test.tsx,PremiumBlock.test.tsx}`, `template/apps/web/src/i18n/{shop.uk.json,shop.en.json}`
**Reads:** spec §3.9 «Екрани варіанту shop», Tasks 13–14 (the markers)
**Depends on:** Task 13, Task 14
**Executor:** claude
**Complexity:** routine
**Satisfies:** `scaffold.test.sh` (all of it), `smoke-template.sh shop`
**Interfaces:**
- Produces:
  - `ShopModule` registers `StartParamRoute { pattern: /^shop$/ }` and `GET /api/premium/content` with `EntitlementGuard('premium')` → `{ items: string[] }`.
  - The web pieces `ShopTab`, `PaywallSheet`, `PremiumBlock` and `SubscriptionSection`, as described in the spec.
  - `routeStartParam('shop')` opens the `shop` tab.
- Consumes: `useProducts`, `usePurchase`, `useEntitlement`, `tmaApi.cancelSubscription/resumeSubscription` (Task 9), `EntitlementGuard` (Task 7).
- [ ] Step 1: write `ShopTab.test.tsx` (the `usePurchase` states with a mock client) and `PremiumBlock.test.tsx` (switches on `useEntitlement`).
- [ ] Step 2: `bash scripts/smoke-template.sh shop` → red.
- [ ] Step 3: implement.
- [ ] Step 4: `bash skills/new/scaffold.test.sh` → `All checks passed.`; `bash scripts/smoke-template.sh shop` → `smoke OK: shop`.

### Task 16: repository CI, release, plugin manifest, pack-check, error-code sync
**Writes:** `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.github/workflows/{ci.yml,release.yml}`, `scripts/sync-plugin-version.mjs`, `scripts/pack-check/{package.json,check.ts,run.sh}`, `scripts/error-codes.test.mjs`, `.changeset/initial-release.md`, `README.md`
**Reads:** `plivka/.github/workflows/deploy.yml:24-41`, `/home/pc/projects/live-coding/.claude-plugin/*`, spec §3.1, §3.8, §3.12
**Depends on:** Task 8, Task 9, Task 10
**Executor:** claude
**Complexity:** routine
**Satisfies:** spec §6 «Крок `pack-check`»; the CI part of the verification
**Interfaces:**
- Produces:
  - **`plugin.json`:** `{ "name": "tma-starter", "version": "0.0.0", "description": "Scaffold Telegram Mini Apps on @dmytro-rudenko/tma-* packages", "author": { "name": "Dmytro Rudenko" }, "license": "MIT", "repository": "https://github.com/dmytro-rudenko/tma-starter" }`.
  - **`marketplace.json`:** the format from live-coding, name `tma-starter`, one plugin with `source: "./"`.
  - **`sync-plugin-version.mjs`:** copies the `version` of `packages/nest-core/package.json` into `plugin.json` and into the `version:` of `skills/new/SKILL.md`.
  - **`error-codes.test.mjs`** (`node --test`): `TMA_ERROR_CODES` from `packages/web/dist` equals the union of `TMA_CORE_ERROR_CODES`, `TMA_BOT_ERROR_CODES` and `TMA_PAYMENTS_ERROR_CODES` from the nest-* `dist`.
  - **`pack-check/run.sh`:** `pnpm pack` of every package into a temporary directory → a fixture `package.json` with `file:` dependencies and the peer dependencies → `pnpm install` → `tsc --noEmit check.ts`. `check.ts` imports every `exports` path. It prints `pack-check OK`.
  - **`ci.yml`** (on PR and push to main):
    - job `packages` (ubuntu, `postgres:16` service as in plivka `deploy.yml:24-41`, `DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres`): install → build → typecheck → test → `node --test scripts/error-codes.test.mjs` → `bash scripts/pack-check/run.sh`;
    - job `changeset-check` (PR only, `if: !startsWith(github.head_ref, 'changeset-release/')`): `git diff --name-only origin/main...` touches `packages/|skills/|template/` → `.changeset/*.md` is required;
    - job `template-smoke` (needs `packages`, the same Postgres, matrix `variant: [empty, shop]`): `bash skills/new/scaffold.test.sh` and `bash scripts/smoke-template.sh ${{ matrix.variant }}`;
    - job `scaffold-macos` (`macos-latest`): `bash skills/new/scaffold.test.sh`.
  - **`release.yml`** (on push to main):
    - `changesets/action@v1` with `version: pnpm changeset version && node scripts/sync-plugin-version.mjs && pnpm install --lockfile-only`, `publish: pnpm -r build && pnpm changeset publish --provenance`;
    - `permissions: { contents: write, pull-requests: write, id-token: write }`, env `NPM_TOKEN`.
  - **`.changeset/initial-release.md`:** all five packages `minor` → `0.1.0`.
  - **`README.md`** (Ukrainian): what this is; installing the plugin (`/plugin marketplace add dmytro-rudenko/tma-starter`, `/plugin install tma-starter@tma-starter`); `/tma-starter:new`; the packages; development (`pnpm db:start`, the Verification command); the «Release» section (register the `@dmytro-rudenko` scope, the `NPM_TOKEN` secret, the Version Packages PR).
- [ ] Step 1: `node --test scripts/error-codes.test.mjs` → red (the file does not exist yet, then a code mismatch shows up if there is one).
- [ ] Step 2: implement all the files.
- [ ] Step 3: `node --test scripts/error-codes.test.mjs` → pass; `bash scripts/pack-check/run.sh` → `pack-check OK`; `npx --yes @action-validator/cli .github/workflows/ci.yml` (or `actionlint` when available) → no errors.

### Task 17: release 0.1.0
**Writes:** — (only the merges of PR #1 and the Version Packages PR; files are changed by `release.yml`)
**Depends on:** Task 15, Task 16
**Executor:** claude
**Complexity:** complex
**Satisfies:** spec §6 «Після релізу `npm view …`» and the manual check of `/tma-starter:new`
- [ ] Step 1: `gh secret list -R dmytro-rudenko/tma-starter` shows `NPM_TOKEN`. If it is missing, stop and ask the owner to register the `@dmytro-rudenko` scope and add the secret (README «Release»).
- [ ] Step 2: CI on PR #1 is green (`gh pr checks 1`). The PR becomes ready (journal close via `raj`), then merge with the owner's confirmation.
- [ ] Step 3: `release.yml` opens «Version packages». After its CI is green, merge it with the owner's confirmation.
- [ ] Step 4: `npm view @dmytro-rudenko/tma-<x>@0.1.0 version license` for all five packages → `0.1.0` and `MIT`; `npm view … dist.attestations` is not empty.
- [ ] Step 5: in a clean directory, `pnpm add @dmytro-rudenko/tma-nest-core@0.1.0 @nestjs/common@^10.4 @nestjs/core@^10.4 knex pg reflect-metadata rxjs` → exit 0.
- [ ] Step 6: `/plugin marketplace add dmytro-rudenko/tma-starter` → `/tma-starter:new` for both variants, following the spec §6 checklist (interview → green → commit → `pnpm dev` → `devUrl` → the «Адмін» section → in shop, test-mode purchase opens Premium).
