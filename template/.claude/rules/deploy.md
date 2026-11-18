---
paths:
  - "deploy/**"
  - ".github/workflows/**"
  - "apps/api/Dockerfile"
---
# Деплой

Деталі, ротація секретів і відкат — у `deploy/README.md`.

- `.github/workflows/deploy.yml` деплоїть кожен push у `main`, окрім змін лише в `docs/**` і `*.md`.
- Порядок у `deploy/deploy.sh` не змінюй: збірка образів, дамп БД, міграції в одноразовому контейнері, `up -d api`, health-check, rsync web, `tma-bot setup`. Нова збірка web публікується лише після того, як новий api здоровий.
- Webhook і профіль бота ставить `tma-bot setup` (`BOT_PROFILE=/app/apps/api/bot/profile.json` усередині контейнера api); окремого скрипта для цього немає. Тому `apps/api/Dockerfile` копіює `apps/api/bot` в образ.
- Нова змінна в `env.ts` мусить зʼявитися в `.env.example`, інакше `deploy/check.sh` зупинить деплой. `deploy/server-setup.sh` допише її в серверний `.env` при наступному запуску.
- Хост спільний з іншими проєктами: жодного `docker system prune`, очищення лише з фільтром `label=com.docker.compose.project=__APP_SLUG__`, томи не чіпаємо.
- Після змін тут: `bash deploy/check.sh`, `bash deploy/deploy.test.sh`, `bash deploy/server-setup.test.sh`.
