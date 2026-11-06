# Пакети `@dmytro-rudenko/tma-*` (частина A tma-starter) — design

**Date:** 2026-11-06
**Status:** agreed
**Prototype:** — (частина A не має UI; екрани й прототип — частина B)

## 1. Problem

Ми вже двічі зібрали Telegram Mini App з нуля: `plivka` і `retro-game-bot`. Інфраструктурний код в обох застосунках майже той самий, але скопійований вручну і з часом розійшовся:

- перевірка initData існує тричі: `plivka/apps/api/src/auth/init-data.ts:19-48`, `retro-game-bot/apps/server/src/auth/telegram-init-data.ts:10-43`, плюс тестові копії `signInitData` у plivka (`apps/api/test/utils/init-data.ts`, `e2e/telegram-stub.ts`) і в retro-game-bot (`apps/server/test/helpers/init-data.ts`);
- адмін-права є лише в plivka: env + грант у БД, блокування (`admin-rights/*`, `admin-users.service.ts`); у retro-game-bot адмін задається тільки через env (`auth/admin.guard.ts`);
- оплата Telegram Stars (pre_checkout, ідемпотентний запис, refund-retry) є лише в plivka і зав'язана на домен (`payments/payable.ts`, `settleFilm`, `settleGift`); підписок немає ніде;
- аудит дій є лише в retro-game-bot, і він fire-and-forget (`audit/audit.service.ts:36-60`);
- розсилка в plivka тримає стан у пам'яті (`notifications.service.ts:150-157`), тож рестарт губить залишок.

Через це кожен новий Mini App знову починається з копіювання файлів, а виправлення в одному застосунку не доходять до інших.

## 2. Constraint that shapes the solution

Код, у якому живуть безпека й гроші (initData, адмін-права, платежі), має оновлюватися в уже створених проєктах, а не лише копіюватися при їх створенні. Тому одного шаблону-копії недостатньо, і ядро виноситься в **опубліковані npm-пакети**. Шаблон (частина B, окремий spec) стає тонким застосунком поверх них. Виправлення в пакеті доходить до проєкту через `pnpm update`.

Друге обмеження: стек береться з plivka як найактуальніший. Це NestJS 10, Knex 3, PostgreSQL 16, grammY, React 18 і TanStack Query 5. Пакети підключають ці бібліотеки як `peerDependencies`. Якби вони були звичайними залежностями, у застосунку з'явилися б дві копії Nest/Knex, і DI-токени та `instanceof` перестали б збігатися.

## 3. Solution

### 3.1 Репозиторій, збірка, реліз

Репо `/home/pc/projects/tma-starter`, GitHub `dmytro-rudenko/tma-starter`.

```
.claude-plugin/plugin.json        # name: tma-starter (skills наповнює частина B)
.claude-plugin/marketplace.json
skills/                           # частина B
template/                         # частина B; НЕ в pnpm workspace
packages/
  nest-core/  nest-bot/  nest-payments/  web/  testing/
.changeset/config.json
.github/workflows/ci.yml  release.yml
package.json  pnpm-workspace.yaml  tsconfig.base.json  .nvmrc  .prettierrc  .editorconfig
```

- Імена npm-пакетів: `@dmytro-rudenko/tma-nest-core`, `-tma-nest-bot`, `-tma-nest-payments`, `-tma-web`, `-tma-testing`. Усі мають `publishConfig.access: public`.
- `pnpm-workspace.yaml` містить лише `packages/*`. Залежності між пакетами оголошені як `workspace:*`.
- Тулчейн:
  - Node `26.13.0`: `.nvmrc`, `engines: >=26.13.0`;
  - `packageManager: pnpm@10.28.0`;
  - TypeScript `~5.6.3`;
  - `tsconfig.base.json` скопійований з plivka;
  - Prettier `^3.3.3`.
- Збірка:
  - `nest-core`, `nest-bot`, `nest-payments` і `testing` збираються в CJS через `tsc -p tsconfig.build.json` у `dist/` разом із `.d.ts`;
  - `web` збирається в ESM через `tsc` (entry `src/index.ts` і `src/react/index.ts`, `sideEffects: false`);
  - кожен пакет має `files: ["dist"]` і `exports` з `types`/`default`.
- peerDependencies:
  - `@nestjs/common` і `@nestjs/core` `^10.4`, `@nestjs/platform-socket.io` `^10.4`, `@nestjs/websockets` `^10.4`, `@nestjs/throttler` (версія з plivka);
  - `knex` `^3.1`, `pg` `^8`, `grammy` `^1.30`, `socket.io` `^4.8`;
  - web: `react` `^18.3`, `@tanstack/react-query` `^5`, `socket.io-client` `^4.8`, `i18next` `^23`, `react-i18next` `^15`, усі позначені `optional` у `peerDependenciesMeta`, крім `i18next`.
- Порядок збірки: `pnpm -r build` іде за топологією core → bot → payments; web і testing незалежні.
- **Схема до трафіку (рішення білдера).** Код пакетів вважає, що всі міграції вже застосовані, і перевірок `hasColumn` не робить. Деплой частини B спершу запускає міграції і лише потім стартує API. Порядок у plivka інший: API стартує до `migrate` (`plivka deploy/deploy.test.sh:75`), і шаблон цей порядок не переймає.
- `ci.yml` запускається на PR і push у main:
  - сервіс `postgres:16` (як у `plivka/.github/workflows/deploy.yml:24-41`), `DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres`;
  - кроки `pnpm install --frozen-lockfile`, далі `pnpm -r build`, `pnpm -r test`, `pnpm -r typecheck`;
  - крок `pack-check`: `pnpm -r pack` у тимчасову теку, далі fixture-проєкт `scripts/pack-check/` ставить tarball-и і компілює імпорт кожного `exports`-шляху.
- `release.yml`:
  - `changesets/action` відкриває PR «Version packages»;
  - після merge виконуються `pnpm -r build` і `changeset publish` з `NPM_TOKEN`, `--provenance` і `permissions: id-token: write`;
  - режим `fixed` для всіх п'яти пакетів: будь-яка зміна бампить і публікує всі п'ять з однією версією. Перша версія `0.1.0`. Внутрішні залежності оголошені як `workspace:*`, тож у npm вони публікуються з точною версією, і пакети з різних релізів не змішуються. Шаблон пінить одну версію для всіх (рішення білдера: `linked` бампить лише змінені пакети, а `^0.x` в semver покриває тільки один minor).
- Ліцензія MIT: файл `LICENSE` у корені та в кожному пакеті, `"license": "MIT"`. `repository` має вигляд `{ type: "git", url: "git+https://github.com/dmytro-rudenko/tma-starter.git", directory: "packages/<name>" }` — без цього `--provenance` не спрацює.
- Перший реліз входить у частину A:
  - публічний GitHub-репо `dmytro-rudenko/tma-starter` створюється через `gh`;
  - npm scope `@dmytro-rudenko` і секрет `NPM_TOKEN` у репо налаштовує власник;
  - реліз — `0.1.0`, опублікований через `release.yml`.
  - Кроки для власника описані в `README.md`, розділ «Release».
- `version` у `plugin.json` бампиться в кожному PR, що змінює `skills/` або `template/`. Версіями npm-пакетів керують changesets.

### 3.2 Міграції: спільний контракт

- Кожен nest-пакет експортує `migrations: Knex.MigrationSource<Migration>`. Модулі міграцій імпортуються статично, а не через `directory`, тож шлях `dist` після встановлення ролі не грає.
- Імена мають вигляд `tma_<pkg>_<NNN>_<what>`, наприклад `tma_core_001_init`.
- `@dmytro-rudenko/tma-nest-core` експортує `composeMigrations(...sources)`. Він повертає одне `MigrationSource`, у якому порядок міграцій такий: core → bot → payments → міграції застосунку. Порядок задається порядком аргументів, а не сортуванням імен.
- Таблиці мають імена без префікса: `users`, `audit_events`, `app_settings`, `broadcasts`, `broadcast_deliveries`, `payments`, `entitlements`.

### 3.3 `@dmytro-rudenko/tma-nest-core`

Залежності між пакетами: немає. Інші nest-пакети залежать від core.

**Підключення.**
```ts
TmaCoreModule.forRoot({
  knex: Knex,
  botToken: string,
  adminUserIds: number[],
  initDataMaxAgeSec?: number,      // default 86400
  auditRetentionDays?: number,     // default 90
  runWorker: boolean,              // prune аудиту
  throttle?: { ttlMs: number; limit: number }, // default 60_000 / 120
})
```
- Модуль глобальний. Він реєструє `APP_GUARD` у порядку `TelegramAuthGuard`, потім `UserThrottlerGuard`.
- Env модуль не читає.
- Порожній `botToken` або відсутній `knex` дає виняток у `forRoot`, і застосунок не стартує.
- Експорти: `TMA_KNEX`, `TMA_CORE_OPTIONS`, `migrations`, `composeMigrations` і всі сервіси, перелічені нижче.

**auth**
- `validateInitData(raw, botToken, maxAgeSec): TgUser | null`, перенесено з `plivka auth/init-data.ts:19-48`. Перевірка через `HMAC_SHA256("WebAppData", botToken)`, відсортований data-check-string і `timingSafeEqual`.
- `TelegramAuthGuard`, перенесено з `plivka auth/telegram-auth.guard.ts:19-62`:
  - діє на шляхи, що починаються з `/api/` (порівняння без регістру);
  - читає `Authorization: tma <raw>`;
  - для невалідного або відсутнього initData повертає 401 `UNAUTHORIZED`;
  - для валідного викликає `UsersService.upsert(from)`;
  - якщо `blocked_at` не null і користувач не env-адмін, повертає 403 `USER_BLOCKED`.
- `@Public()` знімає guard. `@CurrentUser(): AuthUser` повертає `{ id, firstName, username, languageCode }`.

**users.** `UsersService`:
- `upsert(from: TgUser, trx?)`: insert … on conflict(id) merge `first_name`, `username`, `photo_url`, `language_code`, `updated_at`;
- `get(id)`;
- `isBlocked(id)`;
- `list({ q?, cursor?, limit = 50 })`: курсор `<created_at ISO>_<id>`, порядок `created_at desc, id desc`. Числовий `q` шукає за `id`, інакше `ilike` за `first_name`/`username`;
- `block(actorId, id)` / `unblock(actorId, id)`;
- `updatePrefs(id, { language?, theme? })`.

**admin-rights**
- `AdminRightsService`: `isAdmin(id)`, `source(id): 'env' | 'granted' | null` (env має пріоритет), `grant(actorId, id)`, `revoke(actorId, id)`.
- `AdminGuard` повертає 403 `NOT_ADMIN`.
- Правила:
  - env-адміна не можна заблокувати (409 `CANNOT_BLOCK_ADMIN`) і не можна позбавити прав (409 `CANNOT_REVOKE_ENV_ADMIN`);
  - заблокованому не можна видати права (409 `CANNOT_GRANT_BLOCKED`);
  - адміна з грантом не можна заблокувати, поки грант не знято (409 `CANNOT_BLOCK_ADMIN`);
  - адмін не може заблокувати себе або зняти права з себе (409 `CANNOT_TARGET_SELF`);
  - grant, revoke, block і unblock ідемпотентні: повторний виклик повертає поточну картку і не пише рядок у `audit_events`.
  - Порядок перевірок (рішення білдера): спершу `USER_NOT_FOUND`, далі `CANNOT_TARGET_SELF`, потім env (`CANNOT_BLOCK_ADMIN` / `CANNOT_REVOKE_ENV_ADMIN`), потім grant/blocked (`CANNOT_BLOCK_ADMIN` / `CANNOT_GRANT_BLOCKED`), і лише тоді перевірка на no-op.
- Ролі бінарні: admin або не admin.

**audit**
- Сигнатура: `AuditService.record(db: Knex | Knex.Transaction, { actorId, action, targetType?, targetId?, meta? })`.
- Запис іде в тій самій транзакції, що й дія адміна: якщо аудит падає, дія відкочується.
- `meta` у вигляді JSON обрізається до 4096 байт.
- Prune видаляє записи `at < now() - auditRetentionDays` раз на 24 год, коли `runWorker` увімкнено. Помилка prune лише логується.
- Дії core: `user.block`, `user.unblock`, `admin.grant`, `admin.revoke`, `settings.update`.
- Аудит пише лише дії адмінів. HTTP-помилки не пишуться.

**app-settings**
- `defineSetting<T>({ key, default, parse(v: unknown): T })`. Кожен пакет і застосунок реєструє свої ключі через `AppSettingsRegistry.register(def)` в `onModuleInit`.
- `AppSettingsService.get<T>(key)` кешує всю таблицю на 30 с. Годинник інжектиться через `APP_SETTINGS_CLOCK`.
- `set(actorId, key, value)` виконує `parse`, потім upsert і аудит `settings.update { from, to }` в одній транзакції, після чого скидає кеш.
- Помилки: невідомий ключ дає 400 `UNKNOWN_SETTING`, помилка `parse` дає 400 `VALIDATION`.

**realtime**
- `TmaRealtimeGateway`: path `/api/socket.io`, `maxHttpBufferSize: 10_000`.
- Автентифікація через `handshake.auth.initData`:
  - невалідний initData або заблокований користувач → `disconnect(true)`;
  - інакше join кімнати `user:<id>`.
- `RealtimeService.emitToUser(userId, event, payload)` нічого не робить, поки сервер не ініціалізований, і логує помилку замість того, щоб кидати її.

**common**
- `apiError(status, code, message?)`, shape `{ statusCode, message, error, code }`.
- `TmaErrorCode`: `UNAUTHORIZED`, `USER_BLOCKED`, `NOT_ADMIN`, `USER_NOT_FOUND`, `CANNOT_BLOCK_ADMIN`, `CANNOT_GRANT_BLOCKED`, `CANNOT_REVOKE_ENV_ADMIN`, `CANNOT_TARGET_SELF`, `UNKNOWN_SETTING`, `VALIDATION`, `RATE_LIMITED`.
- `UserThrottlerGuard` рахує ліміт за трекером `u:<id>` або `ip:<ip>`.
- `AdminUserCardRegistry.register(key, (userId) => Promise<unknown>)` дає іншим пакетам додавати блоки до картки користувача. Core нічого не знає про payments.

**Таблиці (`tma_core_001_init`)**
- `users`:
  - `id bigint PK`;
  - `first_name text not null`, `username text null`, `photo_url text null`;
  - `language_code text null` (від Telegram), `language text null check in ('uk','en')` (вибір користувача), `theme text not null default 'system' check in ('system','light','dark')`;
  - `blocked_at timestamptz null`;
  - `admin_granted_at timestamptz null`, `admin_granted_by bigint null`;
  - `created_at`, `updated_at timestamptz not null default now()`;
  - індекси: `(created_at desc, id desc)` і `lower(username)`.
- `audit_events`:
  - `id bigserial PK`, `at timestamptz not null default now()`;
  - `actor_id bigint null`, `action text not null`, `target_type text null`, `target_id text null`, `meta jsonb null`;
  - індекси: `(at desc)`, `(target_type, target_id, at desc)`, `(actor_id, at desc)`.
- `app_settings`: `key text PK`, `value jsonb not null`, `updated_at timestamptz not null default now()`.

**HTTP API**

| Метод | Шлях | Guard | Відповідь |
|---|---|---|---|
| GET | `/api/me` | auth | `{ id, firstName, username, language, theme, isAdmin, adminSource }` |
| PATCH | `/api/me` | auth | `{ language?, theme? }` → як GET |
| GET | `/api/admin/users?q=&cursor=` | admin | `{ items: AdminUser[], nextCursor }` |
| GET | `/api/admin/users/:id` | admin | `AdminUserDetail` (+`adminSource`, `blockedAt`, `botBlockedAt`, `cards: Record<key, unknown>`) |
| POST / DELETE | `/api/admin/users/:id/block` | admin | `AdminUserDetail` |
| POST / DELETE | `/api/admin/users/:id/admin` | admin | `AdminUserDetail` |
| GET | `/api/admin/settings` | admin | `{ key, value, default }[]` |
| PATCH | `/api/admin/settings` | admin | `{ key, value }` → оновлений список |
| GET | `/api/admin/audit?actorId=&targetType=&targetId=&cursor=` | admin | `{ items, nextCursor }`, по 50 |

Заблокований користувач отримує 403 `USER_BLOCKED` на всі `/api/*`, зокрема на `/api/me`. Клієнт показує `BlockedScreen` (частина B), коли бачить цей код.

### 3.4 `@dmytro-rudenko/tma-nest-bot`

Залежить від core.

**Підключення.**
```ts
TmaBotModule.forRoot({
  botToken, botUsername, webappUrl,
  webhookPathToken, webhookSecret,
  apiRoot?: string,                 // тести → FakeBotApi
  copy?: Partial<Record<'uk'|'en', Partial<BotCopy>>>,
  startParams?: StartParamRoute[],
  runWorker: boolean,               // broadcast worker
})
```
Модуль створює один grammY `Bot` з `botInfo`, зібраним із токена та `botUsername`. `getMe` на старті не викликається.

**Webhook**
- Маршрут: `POST /bot/:pathToken`, з `@Public()` і `@SkipThrottle()`.
- Перевірки: path-token і заголовок `X-Telegram-Bot-Api-Secret-Token` порівнюються через `timingSafeEqual`. Будь-яка розбіжність дає 401.
- `BotService.on(filter, handler, { critical?: boolean })` і `BotService.command(name, handler)`. Фільтри з `critical: true` складаються в множину.
- Обробка помилок:
  - якщо апдейт підпадає під critical-фільтр (`matchFilter`) і handler кинув виняток, контролер повертає 500, і Telegram доставить апдейт повторно;
  - помилки некритичних апдейтів логуються, відповідь 200.

**Middleware**, у такому порядку:
1. `touch` викликає `UsersService.upsert(ctx.from)` і скидає `bot_blocked_at = null`.
2. `blocked`: якщо `isBlocked` повертає true і користувач не env-адмін, некритичний апдейт тихо відкидається. Critical-апдейти проходять: payments сам відхиляє `pre_checkout` від заблокованого.

**Команди**
- `/start [param]` проходить через `StartParamRouter`: масив `{ pattern: RegExp, handle(ctx, match) }`, спрацьовує перший збіг.
- Якщо збігу немає, виконується `greet`: HTML-привітання і кнопка `web_app: { url: webappUrl }`.
- `/help` надсилає `copy.help` з тією ж кнопкою.
- `BotService.startAppUrl(param)` повертає `https://t.me/<botUsername>?startapp=<param>`.

**i18n**
- Мова визначається так: `langOf(user.language ?? language_code)` дає `uk` лише для `uk`, інакше `en`.
- `escapeHtml` з `plivka bot/i18n.ts:10-13`.
- `BotCopy`: `greeting(name?)`, `openButton`, `help`, `payRejected`, `paymentReceived(title)`, `subscriptionRenewed(title, until)`, `subscriptionCanceled(title, until)`, `paymentRefunded(title, stars)`.
- Застосунок перекриває окремі ключі через `copy`. Якщо значення ключа `null`, повідомлення не надсилається.

**`tma-bot setup`** (bin)
- Читає env: `BOT_TOKEN`, `WEBAPP_URL`, `WEBHOOK_PATH_TOKEN`, `WEBHOOK_SECRET`, `BOT_PROFILE` (шлях до JSON).
- Викликає `setWebhook(url=<WEBAPP_URL>/bot/<pathToken>, secret_token, allowed_updates=["message","callback_query","pre_checkout_query"])`.
- Потім `syncBotProfile`: `setChatMenuButton`, а також `setMyDescription`, `setMyShortDescription` і `setMyCommands` для кожної мови з профілю; без коду мови — значення `en`.
- Webhook ставиться окремо, до профілю. Виклики профілю йдуть через `Promise.allSettled`.
- Exit code: 1, якщо впав `setWebhook`; 2, якщо впав хоча б один виклик профілю (webhook при цьому вже встановлено).
- Формат профілю: `{ menuButtonText: string, en: {short_description, description, commands[]}, uk: {...} }`.
- Під час старту API жодних викликів Bot API для налаштування немає.

**`NotificationsService`**
- `send(userId, text: (lang) => string, opts?: { markup?: (lang) => InlineKeyboardMarkup }): Promise<'sent'|'skipped'|'bot_blocked'|'failed'>`. Метод ніколи не кидає винятків.
- Пропускає отримувачів з `blocked_at` або `bot_blocked_at`.
- Відповідь 403 (`bot was blocked by the user` / `user is deactivated`) ставить `users.bot_blocked_at = now()`.
- На 429 чекає `retry_after` і пробує ще раз, але лише один раз.
- `guard(what, fn)` експортується окремо.

**Broadcast**
- Таблиці (`tma_bot_002_broadcasts`):
  - `broadcasts`: `id uuid PK`, `created_by bigint FK users`, `text text` (HTML), `button jsonb null` (`{ text, startParam? }`), `audience jsonb not null default '{}'`, `status text check in ('queued','running','done','canceled')`, `total int`, `sent int`, `failed int`, `created_at`, `started_at`, `finished_at`;
  - `broadcast_deliveries`: PK `(broadcast_id, user_id)`, `status text check in ('pending','sent','failed','skipped')`, `attempts smallint default 0`, `error text null`, `sent_at`, індекс `(broadcast_id, status)`.
- `audience = { languages?: ('uk'|'en')[], filters?: Record<string, unknown> }`:
  - `languages` bot фільтрує сам за `coalesce(language, language_code→uk|en)`;
  - `filters` задає `BroadcastAudienceRegistry.register({ key, label, apply(qb, value) })`, де `apply` додає умову до запиту по `users`;
  - невідомий ключ фільтра дає 400 `VALIDATION`.
- `create(adminId, { text, button?, audience })`:
  - одна транзакція: insert у `broadcasts`, потім `INSERT … SELECT` отримувачів з `users` (умови `blocked_at IS NULL`, `bot_blocked_at IS NULL`, плюс audience), потім аудит `broadcast.create { total, audience }`;
  - список отримувачів фіксується в момент створення.
- Worker (лише при `runWorker`):
  - бере найстарішу розсилку зі статусом `queued`/`running`, ставить `running` і клеймить пачку з 25 `pending` через `FOR UPDATE SKIP LOCKED`;
  - між відправками пауза 40 мс;
  - обробка відповідей: 429 — пауза на `retry_after`, рядок лишається `pending`; 403 — `failed` плюс `bot_blocked_at`; інший 4xx — `failed`; 5xx або мережева помилка — `attempts++`, після 3 спроб `failed`;
  - після кожної пачки оновлюються лічильники; коли `pending` не лишилось, статус стає `done`;
  - після рестарту worker продовжує з `pending`.
- API під `AdminGuard`:
  - `POST /api/admin/broadcasts` → 201 `{ id, total }`;
  - `POST /api/admin/broadcasts/preview` надсилає лише самому адміну;
  - `POST /api/admin/broadcasts/estimate` `{ audience }` → `{ total }`;
  - `GET /api/admin/broadcasts/audience-filters` → `[{ key, label }]`;
  - `GET /api/admin/broadcasts` (з курсором) і `GET /api/admin/broadcasts/:id`;
  - `POST /api/admin/broadcasts/:id/cancel`: статус `canceled`, решта `pending` стає `skipped`, аудит `broadcast.cancel`.

**Міграція `tma_bot_001_users_bot_blocked_at`** додає `users.bot_blocked_at timestamptz null`. У `AdminUserDetail` (core) це поле приходить через `AdminUserCardRegistry` під ключем `bot`.

**`PreparedMessagesService.save(userId, result: InlineQueryResultArticle): Promise<string>`** викликає `savePreparedInlineMessage` (прапорці як у `retro-game-bot bot/prepared-messages.ts:24-31`).

### 3.5 `@dmytro-rudenko/tma-nest-payments`

Залежить від core і bot. Валюта лише `XTR` (Telegram Stars).

**Підключення.** `TmaPaymentsModule.forRoot({ products: Product[], runWorker: boolean, refundRetryIntervalMs?: number /* 300_000 */ })`.

```ts
interface Product {
  id: string;                                   // /^[a-z0-9_]{1,24}$/
  kind: 'one_time' | 'subscription';
  priceStars(ctx: { userId: number; targetId?: string; trx: Knex }): number | Promise<number>;
  title(lang: 'uk'|'en'): string;               // 1–32 символи
  description(lang: 'uk'|'en'): string;         // 1–255 символів
  validate?(ctx: { userId: number; targetId?: string; trx: Knex }): boolean | Promise<boolean>;
  lock?(trx: Knex.Transaction, targetId: string): Promise<unknown | null>;
  settle?(trx: Knex.Transaction, payment: PaymentRow): Promise<void>;
  onRefund?(trx: Knex.Transaction, payment: PaymentRow): Promise<void>;
  repeatable?: boolean;                         // one_time без targetId: можна купувати повторно (consumable)
}
```
- `ProductRegistry` перевіряє унікальність `id` і формат на старті. Помилка формату зупиняє старт.
- Для `subscription` період завжди `2592000` с: інших значень Bot API не приймає. `settle` для підписки не викликається, entitlement пише сам пакет.
- Для `one_time` без `targetId`:
  - якщо `repeatable` не задано, пакет пише entitlement `source='one_time'`, `expires_at = null`, а потім викликає `settle`, якщо він є;
  - якщо `repeatable: true`, entitlement не пишеться, викликається лише `settle`.
- Для `one_time` з `targetId` викликається лише `settle`, бо право на ціль — доменна логіка застосунку. Якщо в продукту є `lock`, реєстр вимагає й `settle`.

**Правила entitlements (рішення білдера):**
- Будь-який refund викликає `onRefund`, якщо він є, у тій самій транзакції, що й зміна статусу на `refunded`.
- Refund також відкликає entitlement, якщо той походить саме з цього платежу: entitlement `one_time` видаляється, а в entitlement підписки ставиться `expires_at = now()`.
- Повторна покупка заборонена. Продукт `one_time` (не `repeatable`, без `targetId`) з активним entitlement дає 409 `ALREADY_OWNED`, підписка з активним і не скасованим entitlement — 409 `ALREADY_SUBSCRIBED`. Обидві умови перевіряються і на invoice, і в `pre_checkout`: два відкриті посилання не дадуть оформити дві підписки.
- Admin-grant не перезаписує рядок `source='subscription'` з активним `expires_at`: відповідь 409 `ENTITLEMENT_HELD_BY_SUBSCRIPTION`.
- Admin-DELETE entitlement підписки спершу викликає `editUserStarSubscription(is_canceled: true)`, потім видаляє рядок. Якщо Telegram повернув помилку, рядок не видаляється, відповідь 502.

**Payload:** `<productId>:<targetId|->:<nonce11>`, не довше 128 байт. `makePayload` і `parsePayload` перенесено з `plivka payments/invoice-payload.ts`, regex будується з реєстру.

**Таблиці**
- `payments` (`tma_payments_001_payments`):
  - `id uuid PK`, `payer_id bigint FK users`, `product_id text`, `target_id text null`;
  - `amount_stars int not null`, `invoice_payload text not null`, `telegram_payment_charge_id text not null UNIQUE`;
  - `is_recurring boolean not null default false`, `subscription_expires_at timestamptz null`;
  - `status text check in ('paid','refund_pending','refunded')`, `refunded_at timestamptz null`, `created_at timestamptz default now()`.
  - Індекси:
    - partial UNIQUE `(invoice_payload) where is_recurring = false`: продовження підписки приходять з тим самим payload, а для разового invoice подвійна оплата так і лишається забороненою;
    - partial `(created_at) where status = 'refund_pending'`;
    - `(payer_id, created_at desc)`.
- `entitlements` (`tma_payments_002_entitlements`):
  - `user_id bigint FK users`, `product_id text`;
  - `source text check in ('subscription','one_time','grant')`;
  - `expires_at timestamptz null` (null означає безстроково), `subscription_charge_id text null`, `canceled_at timestamptz null`, `updated_at`;
  - PK `(user_id, product_id)`.

**Потоки**
1. **Invoice.** `POST /api/payments/invoice { productId, targetId? }`:
   - заблокований користувач отримує 403 від guard;
   - невідомий продукт — 404 `PRODUCT_NOT_FOUND`;
   - `validate` повернув false — 409 `PRODUCT_UNAVAILABLE`;
   - для підписки, якщо вже є активний і не скасований entitlement, — 409 `ALREADY_SUBSCRIBED`;
   - якщо користувач у `payments.test_users` і є адміном, виконується синтетичний settle (крок 3 з charge `test:<uuid>` і `amount_stars = 0`, для підписки `expires_at = now() + 30 днів` і `subscription_charge_id = null`, тож cancel поверне 409 `NO_SUBSCRIPTION`; аудит `payment.test_settle`) і відповідь `{ settled: true }`;
   - інакше `createInvoiceLink(title, description, payload, '', 'XTR', [{label: title, amount}], subscription ? { subscription_period: 2592000 } : {})` мовою користувача і відповідь `{ invoiceLink }`;
   - збій Bot API дає 502 `PAYMENT_PROVIDER_UNAVAILABLE`.
2. **`pre_checkout_query`** (critical):
   - перевіряє `currency === 'XTR'`, payload, що платник не заблокований, `validate` і точну суму;
   - відмова надсилається з `error_message = copy.payRejected`;
   - `validate` не має звертатися до зовнішніх сервісів: Telegram чекає відповідь 10 с.
3. **`message:successful_payment`** (critical), одна транзакція:
   - `lock(target)`, якщо він є, потім `UsersService.upsert(from, trx)`;
   - `record()` через `onConflict('telegram_payment_charge_id').ignore()`. Якщо конфлікт, це дубль: нічого не робиться;
   - **разова оплата:** якщо payload не розпізнано або ціль більше не приймає оплату (`lock` → null чи `validate` → false), рядок отримує статус `refund_pending`, а refund іде після commit. Конфлікт на partial UNIQUE payload (повторна оплата того самого invoice) теж дає `refund_pending`. Інакше виконується `settle` або пишеться entitlement;
   - **підписка, `is_first_recurring`:** upsert entitlement `source='subscription'`, `expires_at = subscription_expiration_date`, `subscription_charge_id = charge`, `canceled_at = null`;
   - **продовження** (`is_recurring` без `is_first_recurring`): новий рядок `payments`, у entitlement оновлюється `expires_at`;
   - після commit: `emitToUser(payer, 'payment.settled', { productId, paymentId })` і повідомлення `paymentReceived` або `subscriptionRenewed`.
4. **Скасування.**
   - `POST /api/subscriptions/:productId/cancel` викликає `editUserStarSubscription(user, subscription_charge_id, is_canceled: true)` і ставить `canceled_at`. Доступ лишається до `expires_at`. Користувач отримує повідомлення `subscriptionCanceled`.
   - `.../resume` робить те саме з `is_canceled: false` і `canceled_at = null`.
   - Якщо підписку скасовано в самому Telegram, бот update не отримає, і доступ закінчиться на `expires_at`.
5. **Прострочення.** `EntitlementsService.has(userId, productId)` повертає `expires_at is null or expires_at > now()`. Крону немає.
6. **Refund.**
   - `refund()`, `refundStars()` з обробкою `alreadyRefunded` і `retryPendingRefunds()` перенесено з `plivka payments.service.ts:217-260`.
   - Retry запускається кожні `refundRetryIntervalMs`, коли `runWorker` увімкнено.
   - Помилка refund у webhook пробрасується далі (critical → 500).
   - Для нерозпізнаного payload refund робиться одразу, без запису в БД.
   - Refund платежу підписки додатково ставить entitlement `expires_at = now()` і викликає `editUserStarSubscription(is_canceled: true)`.
   - Користувач отримує повідомлення `paymentRefunded`.

**Налаштування:** `payments.test_users: number[]` (default `[]`), реєструється в `AppSettingsRegistry`.

**Фільтр розсилки:** `BroadcastAudienceRegistry.register({ key: 'entitlement', label: 'Active product', apply(qb, productId) })` відбирає користувачів з активним entitlement на `productId`.

**Картка користувача:** `AdminUserCardRegistry.register('payments', userId => ({ payments: last 20, entitlements }))`.

**HTTP API**

| Метод | Шлях | Guard | Відповідь |
|---|---|---|---|
| GET | `/api/products` | auth | `[{ id, kind, priceStars, title, description }]` мовою користувача (для `priceStars` з `targetId` клієнт передає `?targetId=`) |
| POST | `/api/payments/invoice` | auth | `{ invoiceLink } \| { settled: true }` |
| GET | `/api/entitlements` | auth | `[{ productId, source, expiresAt, canceled }]` (лише активні) |
| POST | `/api/subscriptions/:productId/cancel` / `resume` | auth | entitlement |
| GET | `/api/admin/payments?userId=&status=&cursor=` | admin | `{ items, nextCursor }` |
| POST | `/api/admin/payments/:id/refund` | admin | payment; аудит `payment.refund` |
| POST | `/api/admin/users/:id/entitlements` | admin | `{ productId, expiresAt? }` → entitlement `source='grant'`; аудит `entitlement.grant` |
| DELETE | `/api/admin/users/:id/entitlements/:productId` | admin | 204; аудит `entitlement.revoke` |
| POST | `/api/admin/payments/reconcile` | admin | `getStarTransactions` (до 100 за запит) → транзакції `invoice_payment`, яких немає в `payments`; лише звіт |

Коди помилок пакета: `PRODUCT_NOT_FOUND`, `PRODUCT_UNAVAILABLE`, `ALREADY_SUBSCRIBED`, `ALREADY_OWNED`, `ENTITLEMENT_HELD_BY_SUBSCRIPTION`, `NO_SUBSCRIPTION`, `PAYMENT_NOT_FOUND`, `ALREADY_REFUNDED`, `PAYMENT_PROVIDER_UNAVAILABLE`.

### 3.6 `@dmytro-rudenko/tma-web`

ESM. Пакет не містить жодного UI-компонента. Екрани, адмінка, навігація (`stack`/`tabs`), `tokens.css` і словники живуть у шаблоні (частина B).

**`.` (без React)**
- `tg` — фасад над `window.Telegram.WebApp`, перенесено з `plivka telegram/tg.ts`. Кожен виклик загорнутий у `safe()`, тому методи ніколи не кидають винятків.
  - Ініціалізація: `init({ chrome?: { light, dark } })` викликає ready, expand, disableVerticalSwipes і applyChrome.
  - Дані запуску: `initDataRaw()` (поза Telegram повертає `''`), `startParam()` з fallback на `tgWebAppStartParam`, `languageCode()`, `userId()` (лише для UI), `platform()`, `isVersionAtLeast(v)`.
  - Тема: `colorScheme()` і `onThemeChanged(cb) → unsubscribe`.
  - Safe area: `syncSafeArea() → unsubscribe` пише `--tg-safe-area-inset-*` і `--tg-content-safe-area-inset-*`. На Android мінімальний нижній inset 24px (`retro-game-bot telegram.ts:56-66`).
  - Платежі: `openInvoice(url) → Promise<'paid'|'cancelled'|'failed'|'pending'>`, поза Telegram повертає `'failed'`.
  - Посилання й шеринг: `openTelegramLink(url)`, `shareMessage(id) → 'sent'|'cancelled'|'unsupported'`, `canShareMessage()`, `downloadFile(url, name)`.
  - Інтерфейс: `enterFullscreen()`, `haptic.impact/notify`, `closingConfirmation(on)`, `backButton.show(onClick) → hide`.
- `theme`:
  - `applyTheme('system'|'light'|'dark')` ставить `data-theme` на `<html>` і `tg.applyChrome`;
  - `watchSystemTheme() → unsubscribe`;
  - `applyThemeParams()` (opt-in) мапить `themeParams` у `--tg-theme-*`;
  - `createPrefsCache(key)` повертає `{ read, write, restore }`. Недоступний localStorage мовчки ігнорується.
- `createI18n({ resources, supported, fallback })` повертає `{ i18n, setLanguage, applyLanguagePref, langFromCode }`. `langFromCode` працює за тим самим правилом, що й бот.
- `createApiClient({ baseUrl = '' })` повертає `{ request<T>(path, { method, json, body, headers }) }`:
  - додає заголовок `Authorization: tma <initData>`;
  - помилка → `ApiError { status, code: string, message }`.
- `tmaApi(client)` — типізовані виклики всіх ендпоінтів з 3.3–3.5.
- `connectRealtime({ path = '/api/socket.io' }) → Socket | null`, повертає `null` без initData.

**`./react`**
- `createQueryClient()`: 4xx не повторюються.
- `<TmaProvider client i18n chrome?>` на mount викликає `tg.init`, `syncSafeArea` і `watchSystemTheme`.
- Ключі кешу: `tmaKeys = { me, entitlements, products }`.
- `useMe()` після завантаження застосовує `theme` і `language` і кешує їх. Помилку `USER_BLOCKED` повертає як `{ blocked: true }`.
- `useUpdateMe()`.
- `useProducts()`.
- `useEntitlement(productId) → { active, expiresAt, canceled }`.
- `usePurchase()` → `{ purchase({ productId, targetId? }), status: 'idle'|'paying'|'paid'|'cancelled'|'failed' }`:
  - відповідь `{ settled: true }` одразу дає `paid`;
  - інакше викликає `openInvoice`;
  - при `'paid'` інвалідує `me`, `entitlements` і `products`;
  - при `'pending'` чекає `payment.settled`, з fallback-інвалідацією через 5 с;
  - на кожен результат викликає haptic notify.
- `useRealtimeEvent(event, handler)` тримає одне з'єднання на провайдер і після reconnect інвалідує `me` та `entitlements`.

### 3.7 `@dmytro-rudenko/tma-testing`

Хелпери не імпортують jest.

**`.` (Node)**
- `signInitData(user, botToken, { authDate?, startParam?, extra? })` і `tmaAuth(user, botToken)`.
- `updates.message`, `updates.command(cmd, payload?)`, `updates.preCheckoutQuery({ payload, totalAmount, from, currency? })`, `updates.successfulPayment({ payload, chargeId, totalAmount, from, subscriptionExpirationDate?, isRecurring?, isFirstRecurring? })`.
- `postWebhook(http, update, { pathToken, secret })`.
- `startFakeBotApi({ port? }) → FakeBotApi`:
  - `calls`, `callsOf(method)`, `reset()`;
  - `respond(method, reply, { times? })`;
  - сценарії `blockedByUser(method)` (403), `tooManyRequests(method, retryAfter)` (429), `badRequest(method, description)` (400);
  - відповіді за замовчуванням для `sendMessage`, `createInvoiceLink`, `answerPreCheckoutQuery`, `refundStarPayment`, `editUserStarSubscription`, `getStarTransactions`, `setWebhook`, `setChatMenuButton`, `setMyCommands`, `setMyDescription`, `setMyShortDescription`, `savePreparedInlineMessage`.
- `createTestDatabase({ migrations }) → { url, knex, drop() }`:
  - перший виклик у процесі мігрує шаблонну базу `tma_tpl_<sha1 імен міграцій>` під advisory lock;
  - кожна наступна база створюється як `CREATE DATABASE tma_t_<random> TEMPLATE tma_tpl_<hash>`;
  - `drop()` виконує `DROP DATABASE … WITH (FORCE)`;
  - адмін-URL береться з `DATABASE_ADMIN_URL`, за замовчуванням `postgres://postgres@127.0.0.1:54329/postgres`.
- `createTestApp({ imports: (ctx: { knex, botToken, apiRoot, databaseUrl }) => ModuleImports[], migrations, overrides?, botToken? }) → { app, http, knex, fakeBot, tokenFor(user), close() }`. `imports` — фабрика (рішення білдера): `knex` і URL `FakeBotApi` з'являються всередині `createTestApp`, а env і `jest.isolateModules` хелпер не використовує.
- `waitFor(fn, timeoutMs)`.

**Підшляхи**
- `./playwright` (peer `@playwright/test`): `telegramStub(page, opts)`, `appUrl(user, { startParam?, botToken? })`, `tgCalls(page)`. Перенесено з `plivka e2e/telegram-stub.ts`.
- `./dom`: `installFakeWebApp(window, overrides)` для vitest + jsdom.

**bin `tma-test-pg start|stop|status`** — перенесений `plivka scripts/test-pg.sh`: PG 16 без Docker на `127.0.0.1:54329`, `fsync=off`.

## 4. Out of scope

- Шаблон застосунку, екрани й адмін-UI, `scaffold.sh`, skill, Playwright e2e, деплой (`deploy/*`, nginx). Усе це частина B, окремий spec.
- Ролі `owner/admin/moderator` і дозволи.
- Фіатні платежі (`provider_token`), валюти крім XTR.
- Фото й медіа в розсилках, довільний `reply_markup`.
- Аудит HTTP-помилок і підозрілих запитів.
- Крон прострочення підписок і подія `entitlement.expired`.
- Автовиправлення в reconcile.
- Мови крім uk/en у текстах пакетів (застосунок може передати свої через `copy`/`resources`).
- Міграція plivka або retro-game-bot на пакети.

## 5. Trade-offs accepted

- **Пакети замість копії.** Тепер треба підтримувати пакети: semver, changesets, peerDependencies. Breaking change у пакеті змушує мігрувати кожен проєкт. Ціна прийнятна, бо виправлення безпеки й платежів інакше не доходять до проєктів.
- **Linked-версії.** Зміна в одному пакеті бампить версію всім. Зате шаблон завжди посилається на один узгоджений набір.
- **Таблиці без префікса.** Застосунок не може мати власну таблицю `users` чи `payments`. Ці імена стають частиною контракту пакетів.
- **Бінарні адмін-права.** Модератора з обмеженим доступом не зробити без розширення пакета.
- **Підписка без крону.** Якщо користувач скасував підписку в самому Telegram, бот про це не дізнається, і доступ триває до `expires_at`. Це очікувана поведінка Stars-підписок.
- **`tma-bot setup` окремим кроком.** Його легко забути після зміни профілю. Пом'якшення: `deploy.sh` у шаблоні викликає його завжди.
- **Окрема БД на кожен тест.** На CI тести повільніші, ніж із truncate, зате стабільні з фоновими worker-ами.

## 6. Verification

- `pnpm -r build && pnpm -r typecheck && pnpm -r test` на чистому клоні з `tma-test-pg start` проходить зелено. Те саме в `ci.yml`.
- Acceptance-тести на реальному Postgres і `FakeBotApi` покривають:
  - **core:** 401 без заголовка або з невалідним hash чи простроченим `auth_date`; upsert користувача; 403 `USER_BLOCKED` (env-адміна блокування не зачіпає); `NOT_ADMIN`; матриця grant/revoke/block разом із записами в `audit_events`; кеш і `parse` у `app_settings`; realtime connect з валідним і невалідним initData; `emitToUser`;
  - **bot:** неправильний path-token або secret → 401; падіння critical-handler'а → 500, некритичного → 200; заблокований користувач — `/start` ігнорується, а `successful_payment` доходить; вхідне повідомлення скидає `bot_blocked_at`; `StartParamRouter`; `tma-bot setup` (виклики й exit codes); `NotificationsService` (403 → `bot_blocked_at`, 429 → повтор); broadcast (snapshot отримувачів, audience мовою й фільтром із реєстру, 403/429/5xx, cancel, повторний старт без дублів, два worker'и паралельно — кожен отримувач рівно одне повідомлення);
  - **payments:** разова оплата end-to-end (`settle` рівно один раз); refund разової оплати викликає `onRefund` і відкликає entitlement; `ALREADY_OWNED` / `ALREADY_SUBSCRIBED` на invoice і в `pre_checkout`; grant поверх активної підписки → 409; admin-DELETE підписки скасовує її в Telegram; неправильна сума → відмова; дубль charge → no-op; повторна оплата того самого invoice → refund; перша оплата підписки → entitlement; продовження з тим самим payload → новий рядок і зсув `expires_at`; дубль продовження → no-op; cancel і resume викликають `editUserStarSubscription`; `has()` після `expires_at` → false; refund підписки відкликає доступ; падіння `refundStarPayment` → `refund_pending` → retry; test mode; admin refund і grant з аудитом; reconcile;
  - **web** (vitest + jsdom): `tg` без WebApp; Android inset; `openInvoice`, коли SDK кидає виняток; api-клієнт (заголовок і `ApiError`); `langFromCode`; `usePurchase` на всіх гілках статусів; `useMe` застосовує префи; `useRealtimeEvent` інвалідує після reconnect;
  - **testing:** правила `FakeBotApi.respond`/`times`; клонування шаблонної БД.
- Крок `pack-check` у CI: tarball-и з `pnpm pack` ставляться в чистий fixture-проєкт, і кожен шлях з `exports` імпортується та компілюється.
- Після релізу `npm view @dmytro-rudenko/tma-nest-core@0.1.0` (і для решти чотирьох пакетів) показує версію, ліцензію MIT і provenance. У чистій теці `pnpm add @dmytro-rudenko/tma-nest-core@0.1.0` разом із peer-залежностями встановлюється без помилок.
