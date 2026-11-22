# tma-starter

Плагін для Claude Code і npm-пакет `tma-starter` для Telegram Mini Apps. Плагін за кілька питань генерує готовий застосунок (NestJS API + React web) з користувачами, правами адміна, ботом і оплатою Telegram Stars. Уся спільна логіка живе в пакеті, тож шаблон лишається тонким, а оновлення приходять звичайним оновленням залежностей.

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

`tma-starter` — один пакет з однією версією. Серверні підшляхи зібрані в CommonJS, web-підшляхи — в ESM; кожен має `.d.ts`. Усі peer-залежності опційні: серверному застосунку не потрібні React чи i18next, а web-застосунку — Nest чи knex.

| Підшлях | Призначення |
| --- | --- |
| `tma-starter/nest-core` | Авторизація через Telegram initData, користувачі, права адміна, `app_settings`, аудит, realtime, міграції |
| `tma-starter/nest-bot` | Webhook бота на grammy, сповіщення, розсилки, CLI `tma-bot` |
| `tma-starter/nest-payments` | Telegram Stars: разові покупки, підписки, refund, entitlements, reconcile |
| `tma-starter/web` | Клієнтська частина: `tg`, api-клієнт, i18n; React-хуки в `tma-starter/web/react` |
| `tma-starter/testing` | Тестові утиліти: підпис initData, `FakeBotApi`, `createTestApp`, шаблонна БД, CLI `tma-test-pg`; `installFakeWebApp` у `tma-starter/testing/dom` |

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

`pack-check` пакує `tma-starter`, ставить tarball у чистий проєкт, компілює імпорт кожного шляху з `exports` і імпортує кожен із них у Node. `smoke-template` генерує проєкт із шаблону на локальному tarball-і і проганяє його тести та build.

Кожен PR, що змінює `packages/`, `skills/` або `template/`, містить changeset (`pnpm changeset`); без нього падає `changeset-check`.

## Release

Публікація в npm ручна: власник пакета `tma-starter` запускає її локально з одноразовим кодом npm (OTP).

1. Кожна зміна в `packages/`, `skills/` чи `template/` приходить із changeset (`pnpm changeset`).
2. Після merge у `main` `.github/workflows/release.yml` запускає `pnpm run version-packages` і відкриває PR «Version Packages»: піднімає версію `tma-starter`, а `scripts/sync-plugin-version.mjs` переписує `version` у `.claude-plugin/plugin.json` і `skills/new/SKILL.md`.
3. Після merge цього PR з оновленого `main`: `pnpm install && pnpm -r build && pnpm --filter tma-starter publish --access public --otp=<код>`.
4. Перевірка: `npm view tma-starter@<версія> version license` показує нову версію і MIT.

## Ліцензія

MIT
