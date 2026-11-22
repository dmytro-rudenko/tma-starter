# tma-starter

Плагін для Claude Code і npm-пакет `@pctea/tma` для Telegram Mini Apps. Плагін за кілька питань генерує готовий застосунок (NestJS API + React web) з користувачами, правами адміна, ботом і оплатою Telegram Stars. Уся спільна логіка живе в пакеті, тож шаблон лишається тонким, а оновлення приходять звичайним оновленням залежностей.

## Встановлення плагіна

```
/plugin marketplace add dmytro-rudenko/tma-starter
/plugin install tma-starter@tma-starter
```

Створення проєкту:

```
/tma-starter:new
```

Skill опитує про варіант (`empty` або `shop`), назву, username бота, домен, мову й акцентний колір, генерує проєкт із шаблону, ставить залежності, доводить тести до зелених і робить перший коміт. Деплой, GitHub-репозиторій і секрети skill не чіпає.

## Пакет

`@pctea/tma` — один пакет з однією версією. Серверні підшляхи зібрані в CommonJS, web-підшляхи — в ESM; кожен має `.d.ts`. Усі peer-залежності опційні: серверному застосунку не потрібні React чи i18next, а web-застосунку — Nest чи knex.

| Підшлях | Призначення |
| --- | --- |
| `@pctea/tma/nest-core` | Авторизація через Telegram initData, користувачі, права адміна, `app_settings`, аудит, realtime, міграції |
| `@pctea/tma/nest-bot` | Webhook бота на grammy, сповіщення, розсилки, CLI `tma-bot` |
| `@pctea/tma/nest-payments` | Telegram Stars: разові покупки, підписки, refund, entitlements, reconcile |
| `@pctea/tma/web` | Клієнтська частина: `tg`, api-клієнт, i18n; React-хуки в `@pctea/tma/web/react` |
| `@pctea/tma/testing` | Тестові утиліти: підпис initData, `FakeBotApi`, `createTestApp`, шаблонна БД, CLI `tma-test-pg`; `installFakeWebApp` у `@pctea/tma/testing/dom` |

Код лежить у `packages/tma/src/<підшлях>`, тести — поруч у `src` і в `packages/tma/test/<підшлях>`. `pnpm test` у пакеті запускає jest для серверних підшляхів і vitest для `web`.

## Розробка

Потрібні Node `26.13.0` (`.nvmrc`), pnpm `10.28.0` і PostgreSQL 16 (`pg_ctl` у `PATH`) для тестової бази.

```
pnpm install
pnpm -r build
pnpm db:start
pnpm -r typecheck && pnpm -r test
```

`pnpm db:start` піднімає `tma-test-pg` на `127.0.0.1:54329`; `pnpm db:stop` зупиняє. Інша база задається через `DATABASE_ADMIN_URL`.

Додаткові перевірки:

```
node --test scripts/*.test.mjs
bash scripts/pack-check/run.sh
bash scripts/smoke-template.sh empty
bash scripts/smoke-template.sh shop
```

`pack-check` пакує `@pctea/tma`, ставить tarball у чистий проєкт, компілює імпорт кожного шляху з `exports` і імпортує кожен із них у Node. `smoke-template` генерує проєкт із шаблону на локальному tarball-і і проганяє його тести та build.

Кожен PR, що змінює `packages/`, `skills/` або `template/`, містить changeset (`pnpm changeset`); без нього падає `changeset-check`.

## Release

Одноразове налаштування власником:

1. Зареєструвати npm scope `@pctea`.
2. Створити npm-токен з правом публікації і додати його в репозиторій як секрет `NPM_TOKEN` (Settings, Secrets and variables, Actions).

Далі реліз іде через `.github/workflows/release.yml`:

1. Після merge у `main` `changesets/action` запускає `pnpm run version-packages` і відкриває PR «Version Packages»: піднімає версію `@pctea/tma`, а `scripts/sync-plugin-version.mjs` переписує `version` у `.claude-plugin/plugin.json` і `skills/new/SKILL.md`.
2. Merge цього PR запускає `pnpm run release` (`pnpm -r build` і `changeset publish`) з `NPM_TOKEN` і `NPM_CONFIG_PROVENANCE=true`, тож пакет публікується з provenance.
3. Перевірка: `npm view @pctea/tma@<версія>` показує версію, ліцензію MIT і provenance.

Перша версія `@pctea/tma` — `0.1.0`: вона вже стоїть у `packages/tma/package.json`, а changesets цього релізу порожні, тож `version-packages` її не піднімає, і `changeset publish` публікує саме `0.1.0`.

## Ліцензія

MIT
