# tma-starter: пакети `@dmytro-rudenko/tma-*` і плагін-шаблон Telegram Mini App — design

**Date:** 2026-11-06
**Status:** agreed
**Prototype:** — (без прототипу за рішенням користувача: нові екрани частини B будуються на перевірених патернах адмінки plivka й описані функціонально)

Spec має дві частини. **Частина A** (3.1–3.7) — npm-пакети. **Частина B** (3.8–3.12) — шаблон застосунку, `scaffold.sh` і skill плагіна `tma-starter`. Частину B будують після A, бо вона залежить від A.

## 1. Problem

Ми вже двічі зібрали Telegram Mini App з нуля: `plivka` і `retro-game-bot`. Інфраструктурний код в обох застосунках майже той самий, але скопійований вручну і з часом розійшовся:

- перевірка initData існує тричі: `plivka/apps/api/src/auth/init-data.ts:19-48`, `retro-game-bot/apps/server/src/auth/telegram-init-data.ts:10-43`, плюс тестові копії `signInitData` у plivka (`apps/api/test/utils/init-data.ts`, `e2e/telegram-stub.ts`) і в retro-game-bot (`apps/server/test/helpers/init-data.ts`);
- адмін-права є лише в plivka: env + грант у БД, блокування (`admin-rights/*`, `admin-users.service.ts`); у retro-game-bot адмін задається тільки через env (`auth/admin.guard.ts`);
- оплата Telegram Stars (pre_checkout, ідемпотентний запис, refund-retry) є лише в plivka і зав'язана на домен (`payments/payable.ts`, `settleFilm`, `settleGift`); підписок немає ніде;
- аудит дій є лише в retro-game-bot, і він fire-and-forget (`audit/audit.service.ts:36-60`);
- розсилка в plivka тримає стан у пам'яті (`notifications.service.ts:150-157`), тож рестарт губить залишок.

Через це кожен новий Mini App знову починається з копіювання файлів, а виправлення в одному застосунку не доходять до інших.

## 2. Constraint that shapes the solution

Код, у якому живуть безпека й гроші (initData, адмін-права, платежі), має оновлюватися в уже створених проєктах, а не лише копіюватися при їх створенні. Тому одного шаблону-копії недостатньо, і ядро виноситься в **опубліковані npm-пакети**. Шаблон (частина B) стає тонким застосунком поверх них. Виправлення в пакеті доходить до проєкту через `pnpm update`.

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
| GET | `/api/health` | public | `{ ok: true }`; 503 `{ ok: false }`, якщо `select 1` до БД не проходить |
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
5. **Прострочення.** `EntitlementsService.has(userId, productId)` повертає `expires_at is null or expires_at > now()`. Крону немає. `@UseGuards(EntitlementGuard('<productId>'))` дає 403 `NO_ENTITLEMENT`, коли `has` повертає false.
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
| GET | `/api/products` | auth | `[{ id, kind, repeatable, priceStars, title, description }]` мовою користувача (для `priceStars` з `targetId` клієнт передає `?targetId=`) |
| POST | `/api/payments/invoice` | auth | `{ invoiceLink } \| { settled: true }` |
| GET | `/api/entitlements` | auth | `[{ productId, source, expiresAt, canceled }]` (лише активні) |
| POST | `/api/subscriptions/:productId/cancel` / `resume` | auth | entitlement |
| GET | `/api/admin/payments?userId=&status=&cursor=` | admin | `{ items, nextCursor }` |
| POST | `/api/admin/payments/:id/refund` | admin | payment; аудит `payment.refund` |
| POST | `/api/admin/users/:id/entitlements` | admin | `{ productId, expiresAt? }` → entitlement `source='grant'`; аудит `entitlement.grant` |
| DELETE | `/api/admin/users/:id/entitlements/:productId` | admin | 204; аудит `entitlement.revoke` |
| POST | `/api/admin/payments/reconcile` | admin | `getStarTransactions` (до 100 за запит) → транзакції `invoice_payment`, яких немає в `payments`; лише звіт |

Коди помилок пакета: `NO_ENTITLEMENT`, `PRODUCT_NOT_FOUND`, `PRODUCT_UNAVAILABLE`, `ALREADY_SUBSCRIBED`, `ALREADY_OWNED`, `ENTITLEMENT_HELD_BY_SUBSCRIPTION`, `NO_SUBSCRIPTION`, `PAYMENT_NOT_FOUND`, `ALREADY_REFUNDED`, `PAYMENT_PROVIDER_UNAVAILABLE`.

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
- `TMA_ERROR_CODES` — масив усіх кодів помилок core, bot і payments, плюс тип `TmaApiErrorCode`. Тест у корені репо звіряє цей масив з enum'ами nest-пакетів, тож розбіжність ламає CI (рішення білдера: `apps/web` не може імпортувати nest-пакети). `errorText.ts` шаблону має тип `Record<TmaApiErrorCode | AppErrorCode, string>`.
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
- `devUrl({ baseUrl, user, botToken, startParam? }) → string` (корінь пакета, Node): URL виду `<baseUrl>/#tgWebAppData=<signed>&tgWebAppVersion=8.0&tgWebAppPlatform=tdesktop`. Справжній `telegram-web-app.js` сам читає ці hash-параметри, тож застосунок відкривається у звичайному браузері з валідним initData.
- Playwright-заглушки немає: e2e-тестів шаблон не має (рішення користувача).
- `./dom`: `installFakeWebApp(window, overrides)` для vitest + jsdom.

**bin `tma-test-pg start|stop|status`** — перенесений `plivka scripts/test-pg.sh`: PG 16 без Docker на `127.0.0.1:54329`, `fsync=off`. Шукає `pg_ctl` також у Homebrew-шляхах `postgresql@16`. На macOS використовує локаль `en_US.UTF-8` замість `C.UTF-8`.

### 3.8 Плагін `tma-starter`: структура і версія

```
.claude-plugin/plugin.json          # name: tma-starter, version = версія пакетів (fixed)
.claude-plugin/marketplace.json     # marketplace "tma-starter" з одним плагіном
skills/new/SKILL.md                 # /tma-starter:new
skills/new/scaffold.sh
skills/new/scaffold.test.sh
template/                           # 3.9
```

- **Один реліз на весь spec (рішення білдера).** Частини A і B будуються на одній гілці й виходять одним релізом `0.1.0`. Публікація — останній крок плану, після зеленого `template-smoke`. Поки реліз не відбувся, частина B може правити пакети A. `changeset-check` не перевіряє гілки `changeset-release/*`.
- `version` у `plugin.json` дорівнює версії пакетів. Скрипт `scripts/sync-plugin-version.mjs` переписує її на кроці `changeset version` у `release.yml`. CI-крок `changeset-check` вимагає changeset у кожному PR, який змінює `skills/`, `template/` або `packages/`. Так виконується правило «кожна зміна skill бампить версію»: changeset бампить пакети, а за ними й плагін.
- `scaffold.sh` визначає версію пакетів, на яку підставити `__TMA_VERSION__`, з `version` у `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`. Тому встановлена версія плагіна завжди генерує проєкт з пакетами тієї самої версії.

### 3.9 Шаблон `template/`

pnpm-монорепо поверх пакетів A. Структура взята з plivka, але без `packages/shared`: спільні типи дають пакети.

```
template/
  package.json  pnpm-workspace.yaml  tsconfig.base.json  .nvmrc  .prettierrc  .editorconfig  .gitignore
  .env.example  CLAUDE.md  README.md
  .claude/rules/{architecture,code-organization,code-style,server,web,deploy}.md
  apps/api/   apps/web/
  deploy/     .github/workflows/deploy.yml
  scripts/dev.mjs
```

**Плейсхолдери.** Їх підставляє `scaffold.sh` у вмісті текстових файлів та в іменах файлів:

| Плейсхолдер | Значення | Приклад |
|---|---|---|
| `__APP_SLUG__` | `^[a-z][a-z0-9-]{1,30}$`: npm-scope застосунку, шляхи `/opt/<slug>` тощо, compose project, імена файлів nginx | `coffee-club` |
| `__APP_DB__` | slug із `-` → `_`: ім'я БД і користувача Postgres | `coffee_club` |
| `__APP_TITLE__` | назва для людей: `<title>`, профіль бота, README | `Coffee Club` |
| `__BOT_USERNAME__` | без `@` | `coffee_club_bot` |
| `__DOMAIN__` | домен без схеми | `coffee.example.com` |
| `__DEFAULT_LANG__` | `uk` або `en` | `uk` |
| `__ACCENT__` | `#rrggbb` | `#2f80ed` |
| `__TMA_VERSION__` | точна версія пакетів | `0.1.0` |
| `__API_PORT__` | порт API на хості (compose, nginx `proxy_pass`, `check.sh`), за замовчуванням `3200` | `3201` |

**Маркери варіанту.**
- Код магазину лежить у теках `apps/api/src/shop/` і `apps/web/src/features/shop/`.
- У спільних файлах код магазину обгорнуто рядками-маркерами `// tma:shop:start` і `// tma:shop:end`, у CSS — `/* tma:shop:start */` і `/* tma:shop:end */`. Спільні файли з такими блоками: `app.module.ts`, `products.ts`, `features/registry.tsx`, `state/tabs.ts`, `i18n/uk.json` та `en.json` (ключі `shop.*` лежать в окремих `shop.uk.json` і `shop.en.json`, які підключаються маркерним блоком у `i18n/index.ts`).
- `scaffold.sh` обробляє варіанти так:
  - **`empty`:** видаляє теки магазину й вміст маркерних блоків разом із маркерами;
  - **`shop`:** видаляє лише рядки-маркери.

**`apps/api`** (NestJS 10, CJS)
- `main.ts` перенесено з plivka як є: `trust proxy`, `ValidationPipe`, `enableShutdownHooks`, `IoAdapter`.
- `config/env.ts`: class-validator, за патерном `plivka config/env.ts`.
  - **Обов'язкові змінні:** `BOT_TOKEN`, `BOT_USERNAME`, `WEBAPP_URL`, `WEBHOOK_SECRET`, `WEBHOOK_PATH_TOKEN`, `DATABASE_URL`.
  - **Опційні змінні:** `PORT=3100`, `BOT_API_ROOT`, `RUN_WORKER=true`, `API_RATE_LIMIT=120`, `ADMIN_USER_IDS`, `INIT_DATA_MAX_AGE_SEC=86400`.
- `app.module.ts` підключає модулі в такому порядку: `ConfigModule`, `DatabaseModule` (провайдер knex), `TmaCoreModule.forRoot`, `TmaBotModule.forRoot`, `TmaPaymentsModule.forRoot({ products })`, `ExampleModule`, а у варіанті shop ще `ShopModule`.
- `products.ts`:
  - `empty`: `export const products: Product[] = []`;
  - `shop`: продукти, які skill отримав в опитуванні (див. 3.11).
- `features/example/`: приклад доменного модуля, `GET /api/example/hello` → `{ greeting }` мовою користувача, з власним acceptance-тестом. Цей модуль — зразок того, куди і як додавати свій код.
- `shop/`:
  - `ShopModule` реєструє `StartParamRoute` `^shop$`: `/start shop` відкриває застосунок одразу на вкладці Shop;
  - `GET /api/premium/content` під guard'ом `EntitlementGuard('premium')` повертає 403 `NO_ENTITLEMENT`, якщо entitlement немає.
- `database/migrate.ts` викликає `composeMigrations(core, bot, payments, appMigrations)`. Власні міграції застосунку лежать у `database/migrations/` (спершу порожня тека з `.gitkeep`).
- `bot/profile.json`: `menuButtonText`, uk/en `short_description` і `description` з `__APP_TITLE__`, команди `start` і `help`.

**`apps/web`** (React 18, Vite 5, TanStack Query 5, i18next)
- `main.tsx`/`App.tsx`: `TmaProvider` → `useMe`.
  - При `blocked` показується `BlockedScreen`.
  - Інакше `MainScreen` (вкладки + `TabBar`), шари стека й `ToastHost`.
  - `routeStartParam` — порожній роутер-приклад. У shop він знає параметр `shop`.
- **Навігація:** механіка `state/stack.ts` і `state/tabs.ts` з plivka.
  - `Tab = 'home' | 'settings'`, у shop ще `'shop'`.
  - `EntryKind = 'adminUsers' | 'adminUser' | 'adminSettings' | 'adminBroadcasts' | 'adminBroadcast' | 'adminBroadcastNew' | 'adminAudit' | 'adminPayments'`, у shop ще `'paywall'`.
  - `features/registry.tsx` мапить `kind` на компонент.
- **Компоненти з plivka без змін:** `components/sheet/*` (`Sheet`, `FullscreenLayer`), `Toast`, `Avatar`, `AdminConfirm`, `BlockedScreen`, `useDebounced`.
- **Тема:** `theme/tokens.css` з нейтральною палітрою (світла й темна) і `--accent: __ACCENT__`, без доменних токенів plivka; `global.css` з plivka.
- **i18n:** `createI18n` з `tma-web`, словники `i18n/uk.json` і `en.json`, `api/errorText.ts` мапить коди помилок усіх пакетів на тексти.
- `__DEFAULT_LANG__` впливає лише на web: `<html lang>` і `fallback` у `createI18n` (рішення білдера). Мова бота за замовчуванням лишається `en` за правилом `langOf`.
- `index.html`: `lang="__DEFAULT_LANG__"`, `<title>__APP_TITLE__</title>`, `telegram-web-app.js`, без зовнішніх шрифтів.
- `vite.config.ts`: proxy `/api` і `/api/socket.io` (ws) на `127.0.0.1:3100`, а також `/bot` для локального fake-бота; vitest із jsdom.
- Realtime: `useRealtimeEvent('payment.settled')` показує toast «Оплату зараховано».

**Екрани (обидва варіанти).** Візуальні патерни взято з адмінки plivka (`features/admin/*`).
- **Home:** заголовок `__APP_TITLE__`, привітання на ім'я, підказка «тут ваш контент» з посиланням на `features/example`.
- **Settings:**
  - тема `system/light/dark` і мова `uk/en` через `useUpdateMe`;
  - секція «Адмін», видима лише при `isAdmin`, з пунктами «Користувачі», «Налаштування», «Розсилки», «Платежі» й «Аудит».
- **Користувачі** (`AdminUsersSheet` з plivka): пошук із debounce 300 мс, infinite-список по 50, у рядку `Avatar`, ім'я, `@username`, чипи `admin` (env або granted) та `blocked`, дата останнього візиту (`updated_at`).
- **Картка користувача** (`AdminUserSheet` без доменних блоків):
  - шапка, block/unblock і grant/revoke через `AdminConfirm`; помилки показуються toast'ом через `errorText`;
  - блок «Бот»: `botBlockedAt`;
  - блок «Платежі» (`cards.payments`): останні 20 платежів зі статусом і кнопкою «Повернути» (`AdminConfirm`, `POST …/refund`);
  - блок «Доступи»: активні entitlements (продукт, джерело, `expires_at`, позначка «скасовано») з кнопкою «Відкликати»;
  - форма «Видати доступ»: select продукту з `useProducts`, опційна дата закінчення.
  - Блоки «Платежі» й «Доступи» показуються і в `empty`: модуль payments підключений завжди.
- **Налаштування:** список з `GET /api/admin/settings`, редактор обирається за типом `default`:
  - `boolean` → перемикач;
  - `number` → числове поле;
  - `string` → текст;
  - `number[]` → поле «id через кому» (так редагується `payments.test_users`);
  - решта → textarea з JSON.
  - Збереження через `PATCH`, помилка `VALIDATION` показується під полем.
- **Розсилки:**
  - список з прогресом `sent/total`, `failed` і статусом;
  - створення: textarea з HTML-текстом, опційна кнопка (текст + `startParam`), аудиторія (чекбокси мов + фільтри з `GET …/audience-filters`; для `entitlement` — select продукту), live-лічильник отримувачів через `estimate` з debounce 500 мс, кнопки «Надіслати собі» (`preview`) і «Надіслати» (`AdminConfirm` з числом отримувачів);
  - деталі розсилки: прогрес оновлюється polling'ом кожні 3 с, поки статус `queued` або `running`; кнопка «Скасувати».
- **Платежі:** список з `GET /api/admin/payments` з фільтром за статусом, тап відкриває картку користувача-платника; кнопка «Звірити з Telegram» (`reconcile`) показує звіт про розбіжності.
- **Аудит:** infinite-список (час, актор, дія, ціль, `meta` розгортається), фільтри за актором і ціллю. Тап на актора або на ціль-користувача відкриває його картку.

**Екрани варіанту `shop`.**
- **Shop:**
  - `useProducts()` → картки продуктів (назва, опис, ціна в ⭐);
  - кнопка «Купити» або «Оформити» викликає `usePurchase`, стан `paying` блокує кнопку;
  - для куплених (не `repeatable`) і активної підписки замість кнопки чип «Активно до …».
- **Premium на Home:** блок «Преміум-контент».
  - Без entitlement `premium` — замок і кнопка, що відкриває `paywall`.
  - З entitlement — дані з `GET /api/premium/content`.
- **Paywall:** sheet з описом підписки та кнопкою оформлення.
- **Settings → «Підписка»** (якщо є entitlement підписки): дата наступного списання, кнопка «Скасувати» або «Відновити».

**`scripts/dev.mjs`** (`pnpm dev`): локальний запуск без Telegram і без справжнього бота.
- Запускає `startFakeBotApi({ port: 3199 })`, API з `BOT_API_ROOT=http://127.0.0.1:3199`, потім `vite` на 5173.
- Друкує `devUrl` для першого id з `ADMIN_USER_IDS` з `BOT_TOKEN` із `.env`.
- Якщо ключа `payments.test_users` в `app_settings` ще немає, записує туди `ADMIN_USER_IDS`. Тоді покупка в браузері поза Telegram одразу проходить у test mode.
- Потрібна запущена БД. Скрипт перевіряє `DATABASE_URL` і, якщо БД недоступна, підказує `pnpm db:start` (`tma-test-pg start`) та `pnpm db:migrate`.
- Скрипти кореневого `package.json`:
  - `db:start` / `db:stop` → `tma-test-pg start|stop`;
  - `db:create` → `scripts/db-create.mjs` (створює БД з імені в `DATABASE_URL`, якщо її ще немає; адмін-підключення — та сама адреса з БД `postgres`);
  - `db:migrate` → `pnpm --filter @__APP_SLUG__/api migrate`;
  - `dev` → `node scripts/dev.mjs`.

**Тести шаблону** (лише unit і модульні, без e2e):
- **api, jest:**
  - `createTestApp` з `AppModule`-фабрикою: `/api/health`, `/api/me`, `/api/example/hello`, adminGuard на `/api/admin/users`;
  - у shop: оплата `premium` через `updates.successfulPayment` → `GET /api/premium/content` 200; без entitlement → 403;
  - `env.ts` валідує обов'язкові змінні.
- **web, vitest + jsdom + `installFakeWebApp`:**
  - паритет ключів `uk.json` і `en.json`;
  - `errorText` покриває всі коди помилок з пакетів;
  - редактор налаштувань рендерить потрібний контрол для кожного типу;
  - `AdminUserSheet` показує блоки з `cards`;
  - у shop: кнопка покупки проходить стани `usePurchase` з mock-клієнтом, а Premium-блок перемикається за `useEntitlement`.
- **deploy:** `deploy/deploy.test.sh` і `server-setup.test.sh` з plivka, адаптовані до нового порядку.

**Деплой** (`template/deploy/`, з plivka, `plivka` → `__APP_SLUG__`/`__APP_DB__`, домен → `__DOMAIN__`)
- Без змін, крім плейсхолдерів:
  - `docker-compose.yml`: api і postgres, порт лише на loopback, ліміти пам'яті;
  - `nginx/__APP_SLUG__.conf` і `__APP_SLUG__-bootstrap.conf`: locations `/api/socket.io` (ws), `/api`, `/bot/`, статика; `/media` прибрано;
  - `server-setup.sh`: генерує `/etc/__APP_SLUG__/.env` з випадковими секретами, certbot webroot, cron backup;
  - `backup.sh` (без rsync фото) і `check.sh` (звіряє `env.ts` з `.env.example`);
  - `apps/api/Dockerfile`: `@plivka/*` → `@__APP_SLUG__/*`, без `MALLOC_ARENA_MAX`, HEALTHCHECK на `/api/health`.
- `deploy.sh` (rsync + ssh) з **новим порядком**:
  1. `up -d --wait postgres`;
  2. `compose run --rm api node dist/database/migrate.js latest`;
  3. `up -d api`;
  4. health-check `/api/health`;
  5. `compose exec -T api npx tma-bot setup`.
  - `set-webhook.sh` видалено.
- `.github/workflows/deploy.yml` з plivka:
  - job `test` з `postgres:16`;
  - `check.sh`;
  - деплой по SSH на push у `main`, з секретами `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_HOST`, `DEPLOY_USER` і `BOT_TOKEN`.
- `template/README.md`, розділ «Deploy», дає чекліст:
  1. BotFather: `/newbot`, увімкнути Mini App і payments (Stars);
  2. DNS для `__DOMAIN__`;
  3. `server-setup.sh` на сервері;
  4. `BOT_TOKEN` у `/etc/__APP_SLUG__/.env`;
  5. секрети GitHub;
  6. push у `main`.

**Версії пакетів у проєкті (рішення білдера).** Усі п'ять `@dmytro-rudenko/tma-*` запінені точною версією `__TMA_VERSION__`. Оновлення однією командою, вона описана в `README.md` і `CLAUDE.md`: `pnpm up -r '@dmytro-rudenko/tma-*@latest'`, потім `pnpm db:migrate`.

**Мова документації (рішення білдера):** `CLAUDE.md`, rules, README і діалог skill-а — українською, як у plivka. Ідентифікатори, коміти й коментарі в коді — англійською.

**`CLAUDE.md` і `.claude/rules/`**
- `CLAUDE.md` з plivka узагальнено: опис `__APP_TITLE__`, стек, команди, умови тестів (`pnpm db:start`), локальний запуск (`pnpm dev`, порти 3100/3199/5173), попередження «push у main деплоїть у production».
- Правило для агентів: інфраструктура (auth, адмінка, платежі, бот) живе в пакетах `@dmytro-rudenko/tma-*`; її не копіюють у застосунок, а розширюють через `forRoot`, реєстри та `copy`.
- `.claude/rules/*` з plivka:
  - `server.md`: migrate-before-start, без `MEDIA_SIGNING_SECRET`;
  - `web.md`: `tg`, теми й префи — з `tma-web`;
  - `deploy.md`: `tma-bot setup` замість `set-webhook.sh`.

### 3.10 `scaffold.sh`

Bash, працює на Linux і macOS. Заміни в тексті робить `perl -pi`, а не `sed -i`, бо `sed -i` поводиться по-різному в GNU і BSD.

```
scaffold.sh --dir <path> --slug <slug> --title <title> --bot-username <name> --domain <domain>
            --variant empty|shop [--default-lang uk|en] [--accent '#rrggbb']
            [--admin-ids 1,2] [--api-port 3200] [--products <json-file>] [--tma-source <dir-with-tarballs>]
```

Кроки:
1. **Валідація аргументів.** Помилка дає exit 2 з повідомленням: slug — regex з 3.9, `--dir` не існує або порожня, accent — `#rrggbb`, bot-username — `^[A-Za-z0-9_]{5,32}$`, domain без схеми, title — 2–32 символи з літер (зокрема кирилиці), цифр, пробілу й `. , - ! ? : ’` (рішення білдера: так title безпечно підставляється в JSON, HTML, TS і Markdown без екранування), api-port — 1024–65535, `--products` — валідний JSON за схемою з 3.11.
2. **Копіювання.** `template/` копіюється в `--dir` без `node_modules`, `dist` і `.env`.
3. **Варіант:** обробка маркерів і тек магазину (3.9). Для `shop` вміст `--products` генерується в `products.ts`, і кожен рядок проходить JSON-енкодер (`JSON.stringify` через `node -e`). Якщо файл не передано, лишаються продукти за замовчуванням із шаблону.
4. **Плейсхолдери.** Заміна у вмісті всіх текстових файлів (за `file --mime-encoding`, крім binary) і перейменування файлів та тек з плейсхолдерами в імені.
5. **`--tma-source`** (CI плагіна): залежності `@dmytro-rudenko/tma-*` переписуються на `file:<tarball>`.
6. **`.env`** з `.env.example`:
   - `WEBHOOK_SECRET` і `WEBHOOK_PATH_TOKEN` — `openssl rand -hex 32`;
   - `BOT_TOKEN=000000:dev-local-token`, `BOT_API_ROOT=http://127.0.0.1:3199`;
   - `DATABASE_URL=postgres://postgres@127.0.0.1:54329/__APP_DB__`;
   - `ADMIN_USER_IDS` з `--admin-ids`. Якщо їх не передано, у локальний `.env` пишеться `1`, щоб `devUrl` відкривав застосунок як адмін (рішення білдера). `.env.example` для production лишається порожнім, а skill позначає це в чеклісті.
   - `.env` стоїть у `.gitignore`.
7. **Самоперевірка.** Exit 3, якщо в `--dir` лишився рядок `__[A-Z_]+__` або `tma:shop:`; повідомлення перелічує файли.

Скрипт не запускає `pnpm`, git і мережу: це робить skill. `scaffold.test.sh`:
- перевіряє title кирилицею з `’` і продукти з лапками в описі;
- генерує обидва варіанти у тимчасову теку;
- перевіряє відсутність плейсхолдерів і маркерів, наявність або відсутність тек магазину, перейменування nginx-конфігів, коди виходу для невалідних аргументів і для непорожньої `--dir`.

### 3.11 Skill `/tma-starter:new`

`skills/new/SKILL.md`, frontmatter `name: new`, `description` (тригери: «створи telegram mini app», «новий TMA-проєкт», «scaffold mini app»), `version` дорівнює версії плагіна.

**Опитування.** Кожне питання — окреме `AskUserQuestion`. Значення, які користувач уже назвав у запиті, skill не перепитує.
1. **Варіант:** «Порожній каркас» (Home + Settings + адмінка) або «Демо-магазин» (+ Shop, Premium, paywall, керування підпискою).
2. **Назва застосунку** (`title`). `slug` виводиться з неї (транслітерація, kebab-case) і показується для підтвердження чи правки.
3. **Username бота** (можна «ще немає» — тоді `<slug>_bot` з позначкою в чеклісті) і **домен** (можна «ще немає» — тоді `<slug>.example.com`).
4. **Мова за замовчуванням** (`uk`/`en`) і **акцентний колір** (3 пресети + Other).
5. **Telegram id адмінів** (можна пропустити). Підказка: id показує `@userinfobot`.
6. **Лише для shop — продукти.**
   - «Прийняти стандартні» (`premium`: subscription, 250 ⭐; `coffee`: one_time, `repeatable`, 50 ⭐) або «Задати свої».
   - «Задати свої»: для кожного продукту `id`, `kind`, ціна, назва й опис uk/en. Один продукт мусить мати id `premium` і `kind: subscription`, бо від нього залежать Premium-блок і paywall. Якщо користувач відмовляється, skill повертає стандартні.
7. **Директорія:** за замовчуванням `./<slug>` від поточної.

Схема `--products` JSON: `[{ id, kind: 'one_time'|'subscription', priceStars: 1..10000, repeatable?: boolean, title: { uk, en }, description: { uk, en } }]`.

**Preflight перед опитуванням (рішення білдера).**
- Перевіряє Node ≥ 26.13, pnpm 10, `perl`, `openssl` і `pg_ctl` (у PATH, `/usr/lib/postgresql/16/bin`, `/opt/homebrew/opt/postgresql@16/bin`, `/usr/local/opt/postgresql@16/bin`).
- Без Postgres 16 skill пропонує або команду встановлення для ОС, або вказати наявний `DATABASE_ADMIN_URL`. У другому випадку `db:start` пропускається.

**Виконання.**
1. Підсумок параметрів одним повідомленням, далі `scaffold.sh` (шлях `${CLAUDE_PLUGIN_ROOT}/skills/new/scaffold.sh`).
2. У згенерованому проєкті:
   - `pnpm install`;
   - `pnpm db:start` (`tma-test-pg start`) і `pnpm db:create` (створює `__APP_DB__`);
   - `pnpm db:migrate`;
   - `pnpm -r typecheck`, `pnpm -r test`, `pnpm -r build`.
3. Якщо крок падає, skill показує вивід і зупиняється. Сам він нічого в шаблоні не латає, а пропонує повідомити про баг плагіна.
4. `git init -b main`, `git add -A`, `git commit -m "chore: scaffold from tma-starter <version>"`.
5. Фінальне повідомлення:
   - команда `pnpm dev` і що вона друкує `devUrl`;
   - чекліст деплою з `README.md`;
   - позначки, де лишились значення за замовчуванням (бот, домен, адміни).
   - Деплой, GitHub-репо й секрети skill не чіпає.

### 3.12 CI плагіна для частини B

`ci.yml` отримує job `template-smoke` після job пакетів:
1. `pnpm -r build && pnpm -r pack --pack-destination /tmp/tma-tarballs`.
2. `scaffold.test.sh`.
3. Для кожного варіанту (`empty`, `shop`): `scaffold.sh … --tma-source /tmp/tma-tarballs`, далі `pnpm install`, `pnpm db:create`, `pnpm db:migrate`, `pnpm -r typecheck`, `pnpm -r test`, `pnpm -r build`.

Сервіс `postgres:16` використовується спільно, `DATABASE_ADMIN_URL` вказує на нього.

Job `scaffold-macos` (`macos-latest`) запускає лише `scaffold.test.sh` — це перевірка портабельності bash і perl.

## 4. Out of scope

- E2E-тести (Playwright) — і в пакетах, і в шаблоні. У шаблоні лише unit- і модульні тести.
- Браузерний прототип нових екранів.
- Розгортання skill-ом на сервер, створення GitHub-репо згенерованого проєкту, секрети CI: skill закінчує на локально зеленому проєкті й чеклісті деплою.
- Інші варіанти шаблону, крім `empty` і `shop`; фронтенд крім React; БД крім PostgreSQL.
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
- **Fixed-версії.** Зміна в одному пакеті бампить і публікує всі п'ять. Зате шаблон і плагін завжди посилаються на один узгоджений набір.
- **Таблиці без префікса.** Застосунок не може мати власну таблицю `users` чи `payments`. Ці імена стають частиною контракту пакетів.
- **Бінарні адмін-права.** Модератора з обмеженим доступом не зробити без розширення пакета.
- **Підписка без крону.** Якщо користувач скасував підписку в самому Telegram, бот про це не дізнається, і доступ триває до `expires_at`. Це очікувана поведінка Stars-підписок.
- **`tma-bot setup` окремим кроком.** Його легко забути після зміни профілю. Пом'якшення: `deploy.sh` у шаблоні викликає його завжди.
- **Окрема БД на кожен тест.** На CI тести повільніші, ніж із truncate, зате стабільні з фоновими worker-ами.
- **Без e2e.** Зв'язку «браузер → Telegram SDK → API» автоматично ніхто не перевіряє. Вона покрита лише unit-тестами `tma-web` і ручною перевіркою через `pnpm dev`. Рішення користувача: менше залежностей і швидший CI.
- **Без прототипу.** Нові екрани (розсилки, аудит, налаштування, платежі, магазин) можуть потребувати візуальних правок після реалізації. Пом'якшення: їх зібрано з уже перевірених компонентів plivka.
- **Маркери варіанту у спільних файлах.** У шаблоні вони виглядають як шум, а помилка в маркері дає зламаний `empty`. Пом'якшення: самоперевірка `scaffold.sh` і `template-smoke` в CI для обох варіантів.
- **Модуль payments завжди підключений**, навіть у `empty` з порожнім `products`. Адмінка платежів і таблиці існують без продуктів, зате додати перший продукт можна без зміни структури застосунку.

## 6. Verification

- `pnpm -r build && pnpm -r typecheck && pnpm -r test` на чистому клоні з `tma-test-pg start` проходить зелено. Те саме в `ci.yml`.
- Acceptance-тести на реальному Postgres і `FakeBotApi` покривають:
  - **core:** 401 без заголовка або з невалідним hash чи простроченим `auth_date`; upsert користувача; 403 `USER_BLOCKED` (env-адміна блокування не зачіпає); `NOT_ADMIN`; матриця grant/revoke/block разом із записами в `audit_events`; кеш і `parse` у `app_settings`; realtime connect з валідним і невалідним initData; `emitToUser`;
  - **bot:** неправильний path-token або secret → 401; падіння critical-handler'а → 500, некритичного → 200; заблокований користувач — `/start` ігнорується, а `successful_payment` доходить; вхідне повідомлення скидає `bot_blocked_at`; `StartParamRouter`; `tma-bot setup` (виклики й exit codes); `NotificationsService` (403 → `bot_blocked_at`, 429 → повтор); broadcast (snapshot отримувачів, audience мовою й фільтром із реєстру, 403/429/5xx, cancel, повторний старт без дублів, два worker'и паралельно — кожен отримувач рівно одне повідомлення);
  - **payments:** разова оплата end-to-end (`settle` рівно один раз); refund разової оплати викликає `onRefund` і відкликає entitlement; `ALREADY_OWNED` / `ALREADY_SUBSCRIBED` на invoice і в `pre_checkout`; grant поверх активної підписки → 409; admin-DELETE підписки скасовує її в Telegram; неправильна сума → відмова; дубль charge → no-op; повторна оплата того самого invoice → refund; перша оплата підписки → entitlement; продовження з тим самим payload → новий рядок і зсув `expires_at`; дубль продовження → no-op; cancel і resume викликають `editUserStarSubscription`; `has()` після `expires_at` → false; refund підписки відкликає доступ; падіння `refundStarPayment` → `refund_pending` → retry; test mode; admin refund і grant з аудитом; reconcile;
  - **web** (vitest + jsdom): `tg` без WebApp; Android inset; `openInvoice`, коли SDK кидає виняток; api-клієнт (заголовок і `ApiError`); `langFromCode`; `usePurchase` на всіх гілках статусів; `useMe` застосовує префи; `useRealtimeEvent` інвалідує після reconnect;
  - **testing:** правила `FakeBotApi.respond`/`times`; клонування шаблонної БД.
- Крок `pack-check` у CI: tarball-и з `pnpm pack` ставляться в чистий fixture-проєкт, і кожен шлях з `exports` імпортується та компілюється.
- **Частина B:**
  - `scaffold.test.sh` зелений;
  - `template-smoke` у CI зелений для `empty` і `shop`;
  - `/tma-starter:new` у Claude Code після встановлення плагіна з marketplace `dmytro-rudenko/tma-starter`, вручну, для обох варіантів:
    - опитування проходить;
    - проєкт генерується, тести й build зелені, є перший коміт;
    - `pnpm dev` друкує `devUrl`, який відкриває застосунок у браузері;
    - адмін із `ADMIN_USER_IDS` бачить секцію «Адмін»;
    - у shop покупка через `payments.test_users` відкриває Premium-блок.
- Після релізу `npm view @dmytro-rudenko/tma-nest-core@0.1.0` (і для решти чотирьох пакетів) показує версію, ліцензію MIT і provenance. У чистій теці `pnpm add @dmytro-rudenko/tma-nest-core@0.1.0` разом із peer-залежностями встановлюється без помилок.
