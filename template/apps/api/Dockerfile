# Build from the repo root: docker build -f apps/api/Dockerfile .

FROM node:26.13.0-slim AS build
WORKDIR /repo
# Node >= 25 images no longer bundle the pnpm shim.
RUN npm i -g pnpm@10.28.0
# Packages are fetched in a layer keyed on the lockfile alone: `COPY . .` changes on every
# deploy, so installing after it would download everything again.
COPY pnpm-lock.yaml ./
RUN pnpm fetch --frozen-lockfile
COPY . .
# pnpm 10 `deploy` refuses workspace packages unless `inject-workspace-packages=true`, which
# changes the lockfile and breaks --frozen-lockfile; `--legacy` keeps the pnpm 9 behaviour.
RUN pnpm install --frozen-lockfile --offline \
 && pnpm --filter @__APP_SLUG__/api build \
 && pnpm deploy --legacy --filter @__APP_SLUG__/api --prod /out

FROM node:26.13.0-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out /app
COPY --from=build --chown=node:node /repo/apps/api/bot /app/apps/api/bot
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","dist/main.js"]
