---
paths:
  - "deploy/**"
  - ".github/workflows/**"
  - "apps/api/Dockerfile"
---
# Deploy

Details, secret rotation and rollback are in `deploy/README.md`.

- `.github/workflows/deploy.yml` deploys every push to `main`, except changes only in `docs/**` and `*.md`.
- Do not change the order in `deploy/deploy.sh`: image build, DB dump, migrations in a one-off container, `up -d api`, health check, rsync web, `tma-bot setup`. A new web build is published only after the new api is healthy.
- The webhook and bot profile are set by `tma-bot setup` (`BOT_PROFILE=/app/apps/api/bot/profile.json` inside the api container); there is no separate script for it. That is why `apps/api/Dockerfile` copies `apps/api/bot` into the image.
- A new variable in `env.ts` must appear in `.env.example`, otherwise `deploy/check.sh` stops the deploy. `deploy/server-setup.sh` adds it to the server `.env` on its next run.
- The host is shared with other projects: no `docker system prune`, clean up only with the filter `label=com.docker.compose.project=__APP_SLUG__`, do not touch volumes.
- After changes here: `bash deploy/check.sh`, `bash deploy/deploy.test.sh`, `bash deploy/server-setup.test.sh`.
