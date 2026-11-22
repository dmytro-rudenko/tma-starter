# tma-starter

A Claude Code plugin and the npm package `tma-starter` for Telegram Mini Apps. After a short interview, the plugin generates a working app (NestJS API + React web) with users, admin rights, a bot and Telegram Stars payments. All shared logic lives in the package, so the template stays thin and fixes arrive as a regular dependency update.

## Installing the plugin

```
/plugin marketplace add dmytro-rudenko/tma-starter
/plugin install tma-starter@tma-starter
```

Creating a project:

```
/tma-starter:new
```

The skill asks for the variant (`empty` or `shop`), the app name, the bot username, the domain, the default language and the accent colour. It then generates the project from the template, installs dependencies, brings the tests to green and makes the first commit. It does not deploy, create a GitHub repository or touch secrets.

## The package

`tma-starter` is one package with one version. The server subpaths are built as CommonJS, the web subpaths as ESM, and each ships `.d.ts` files. All peer dependencies are optional: a server app does not need React or i18next, and a web app does not need Nest or knex.

| Subpath | Purpose |
| --- | --- |
| `tma-starter/nest-core` | Telegram initData auth, users, admin rights, `app_settings`, audit log, realtime, migrations |
| `tma-starter/nest-bot` | grammY bot webhook, notifications, broadcasts, the `tma-bot` CLI |
| `tma-starter/nest-payments` | Telegram Stars: one-time purchases, subscriptions, refunds, entitlements, reconcile |
| `tma-starter/web` | Client side: `tg`, the API client, i18n; React hooks in `tma-starter/web/react` |
| `tma-starter/testing` | Test utilities: initData signing, a fake Bot API (`startFakeBotApi`), `createTestApp`, per-test databases from a template, the `tma-test-pg` CLI; `installFakeWebApp` in `tma-starter/testing/dom` |

See [packages/tma/README.md](packages/tma/README.md) for usage. The code lives in `packages/tma/src/<subpath>`, with tests next to it in `src` and in `packages/tma/test/<subpath>`. `pnpm test` in the package runs jest for the server subpaths and vitest for `web`.

## Development

You need Node `26.13.0` (`.nvmrc`), pnpm `10.28.0` and PostgreSQL 16 (`pg_ctl` on `PATH`) for the test database.

```
pnpm install
pnpm -r build
pnpm db:start
pnpm -r typecheck && pnpm -r test
```

`pnpm db:start` starts `tma-test-pg` on `127.0.0.1:54329`; `pnpm db:stop` stops it. Set `DATABASE_ADMIN_URL` to use another database.

Additional checks:

```
node --test scripts/*.test.mjs
bash scripts/pack-check/run.sh
bash scripts/smoke-template.sh empty
bash scripts/smoke-template.sh shop
```

`pack-check` packs `tma-starter`, installs the tarball into a clean project, compiles an import of every path in `exports` and imports each of them in Node. `smoke-template` generates a project from the template against a local tarball and runs its tests and build.

Every PR that changes `packages/`, `skills/` or `template/` includes a changeset (`pnpm changeset`); without one, `changeset-check` fails.

## Release

Publishing to npm is manual: the owner of the `tma-starter` package runs it locally with an npm one-time password (OTP).

1. Every change in `packages/`, `skills/` or `template/` comes with a changeset (`pnpm changeset`).
2. After a merge into `main`, `.github/workflows/release.yml` runs `pnpm run version-packages` and opens the «Version Packages» PR. It bumps the `tma-starter` version, and `scripts/sync-plugin-version.mjs` rewrites `version` in `.claude-plugin/plugin.json` and `skills/new/SKILL.md`.
3. After that PR is merged, from the updated `main`: `pnpm install && pnpm -r build && pnpm --filter tma-starter publish --access public --otp=<code>`.
4. Check: `npm view tma-starter@<version> version license` shows the new version and MIT.

## License

MIT
