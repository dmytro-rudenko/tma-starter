# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

__APP_TITLE__ — Telegram Mini App (бот `@__BOT_USERNAME__`), створений зі `tma-starter`. Монорепо на pnpm: `apps/api` (NestJS 10, Knex, PostgreSQL 16, grammY) і `apps/web` (React 18, Vite 5, TanStack Query 5, i18next). Авторизація, користувачі, адмінка, бот, розсилки, платежі й realtime живуть у пакетах `@dmytro-rudenko/tma-*`, які стоять у залежностях. Версії Node і pnpm закріплені в `.nvmrc` і `packageManager`.

Архітектура, стиль і правила за пакетами — у `.claude/rules/`.

**Push у `main` одразу деплоїть у production.** CI запускає лише `pnpm test`, тож усе, що він не покриває, перевіряй локально до злиття.

## Правило для агентів

Інфраструктура (auth, користувачі й права адмінів, адмінка, налаштування, аудит, бот, розсилки, платежі, entitlements, realtime) живе в пакетах `@dmytro-rudenko/tma-*`. Не копіюй її код у застосунок і не переписуй: розширюй через `forRoot`, реєстри й `copy`. Якщо потрібної точки розширення немає, це питання до пакетів, а не привід форкнути їхній код у `apps/`.

## Команди

```bash
pnpm install --frozen-lockfile

pnpm dev                             # локальний запуск без Telegram, див. нижче
pnpm build                           # api і web
pnpm typecheck
pnpm test                            # api + web

pnpm db:start                        # Postgres 16 для розробки й тестів
pnpm db:stop
pnpm db:create                       # створює БД з DATABASE_URL, якщо її ще немає
pnpm db:migrate                      # міграції пакетів і застосунку
```

Один тест:

```bash
pnpm --filter @__APP_SLUG__/api exec jest test/env.spec.ts -t 'назва тесту'
pnpm --filter @__APP_SLUG__/web exec vitest run <файл>
```

Міграції запускаються лише зі скомпільованого коду й потребують `DATABASE_URL`:

```bash
pnpm --filter @__APP_SLUG__/api build && pnpm db:migrate
```

## Оновлення пакетів

Усі п'ять `@dmytro-rudenko/tma-*` закріплені точною версією. Оновлення однією командою, а потім міграції, бо нова версія пакета може додати власні:

```bash
pnpm up -r '@dmytro-rudenko/tma-*@latest'
pnpm db:migrate
```

## Умови для тестів

- **Postgres потрібен і для `pnpm test`:** `createTestApp` піднімає весь `AppModule` на новій базі. За замовчуванням тести підключаються до `postgres://postgres@127.0.0.1:54329/postgres`, адресу змінює `DATABASE_ADMIN_URL`.
- Підняти БД: `pnpm db:start`, зупинити: `pnpm db:stop`.
- Web-тести працюють у jsdom без браузера й без Telegram (`installFakeWebApp` з `@dmytro-rudenko/tma-testing`).
- Тестів e2e і Playwright немає.

## Локальний запуск

- Без Telegram `initData` порожній, тому всі захищені `/api/*` відповідають 401. `pnpm dev` обходить це: він піднімає фейковий Bot API на порту 3199, API на 3100 (`BOT_API_ROOT=http://127.0.0.1:3199`) і Vite на 5173, а в консоль друкує URL Mini App з підписаним `initData` для першого id з `ADMIN_USER_IDS`.
- Потрібні `.env` з `BOT_TOKEN` і `DATABASE_URL`, а також запущена БД. Якщо вона недоступна, скрипт підкаже `pnpm db:start` і `pnpm db:migrate`.
- Якщо ключа `payments.test_users` в `app_settings` ще немає, `pnpm dev` записує туди `ADMIN_USER_IDS`: покупка в браузері поза Telegram одразу проходить у test mode.
- Vite проксіює `/api` (разом із websocket `/api/socket.io`) на `127.0.0.1:3100`; `/bot` проксіюється для локального фейкового бота.
- API не стартує без `BOT_TOKEN`, `BOT_USERNAME`, `WEBAPP_URL`, `WEBHOOK_SECRET`, `WEBHOOK_PATH_TOKEN`, `DATABASE_URL` (`apps/api/src/config/env.ts`).
