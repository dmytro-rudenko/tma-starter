# __APP_TITLE__

Telegram Mini App на `@dmytro-rudenko/tma-*`: вхід через Telegram, адмінка, бот із розсилками, платежі Telegram Stars і realtime вже підключені. Свій код живе в `apps/api/src/features/` і `apps/web/src/features/`, приклад — модуль `example`.

- `apps/api` — NestJS 10, Knex, PostgreSQL 16, grammY.
- `apps/web` — React 18, Vite 5, TanStack Query 5, i18next.
- `deploy/` — Docker Compose, nginx, скрипти деплою. Деталі, ротація секретів і відкат — у `deploy/README.md`.
- `.claude/rules/` і `CLAUDE.md` — правила для Claude Code.

## Локальний запуск

```bash
pnpm install
cp .env.example .env     # заповніть BOT_TOKEN, WEBHOOK_SECRET, WEBHOOK_PATH_TOKEN, DATABASE_URL, ADMIN_USER_IDS
pnpm db:start            # Postgres 16 на 127.0.0.1:54329
pnpm db:create           # створює БД з DATABASE_URL, якщо її ще немає
pnpm build
pnpm db:migrate
pnpm dev                 # фейковий Bot API :3199, API :3100, Vite :5173; друкує URL Mini App
```

## Тести

`pnpm test` проганяє unit- і модульні тести api (jest) і web (vitest, jsdom). Потрібен запущений Postgres: `pnpm db:start`.

## Deploy

1. BotFather: `/newbot`, увімкніть Mini App і payments (Stars).
2. DNS: направте `__DOMAIN__` на сервер.
3. `server-setup.sh` на сервері. Потрібні Docker з compose, nginx, certbot, rsync, curl і openssl. Скопіюйте репозиторій у `/opt/__APP_SLUG__` (`rsync -az --exclude node_modules --exclude .git ./ root@<хост>:/opt/__APP_SLUG__/`), потім на сервері:
   ```bash
   read -rs BOT_TOKEN && export BOT_TOKEN
   bash /opt/__APP_SLUG__/deploy/server-setup.sh
   ```
   Скрипт створить каталоги, `/etc/__APP_SLUG__/.env` із випадковими секретами, nginx-сайт, сертифікат Let's Encrypt і cron для резервних копій.
4. `BOT_TOKEN` у `/etc/__APP_SLUG__/.env`: його записав попередній крок. Далі токен оновлює кожен деплой із секрету GitHub `BOT_TOKEN`.
5. Секрети GitHub (середовище `production`): `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_HOST`, `DEPLOY_USER`, `BOT_TOKEN`. Що в кожному, описано в `deploy/README.md`.
6. Push у `main`: workflow проганяє тести, `deploy/check.sh` і `deploy/deploy.sh`, який наприкінці запускає `tma-bot setup` (webhook і профіль бота з `apps/api/bot/profile.json`).

## Оновлення пакетів

Усі `@dmytro-rudenko/tma-*` закріплені точною версією. Щоб оновити їх, виконайте:

```bash
pnpm up -r '@dmytro-rudenko/tma-*@latest'
pnpm db:migrate
```

Друга команда застосовує міграції, які нова версія пакетів могла додати.
