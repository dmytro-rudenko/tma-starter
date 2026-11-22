# Code organization

## Modules

- Do not create `utils/` or `helpers/` directories in `src/`: code lives in the module it belongs to.
- A file over ~300 lines is a signal to split it.
- One directory per Nest module in `apps/api/src/features/<topic>/`. The controller lives in its own module. Request DTOs go in `<module>/dto/*.dto.ts`.
- Do not duplicate what `tma-starter` already has: check the exports of its subpaths first.

## Where to put new code

| What | Where |
|---|---|
| HTTP endpoint | `apps/api/src/features/<topic>/*.controller.ts` + service |
| table or column | new migration in `apps/api/src/database/migrations/` + a `*Row` interface next to the queries |
| environment variable | `apps/api/src/config/env.ts` + `.env.example` |
| product or subscription | `apps/api/src/products.ts` |
| bot command or `/start` parameter | `StartParamRoute` in `TmaBotModule.forRoot` in `app.module.ts` |
| bot text | `apps/api/src/bot/copy.ts` (`copy` in `TmaBotModule.forRoot`) |
| bot profile: menu button, descriptions, commands | `apps/api/bot/profile.json`; applied by `tma-bot setup` during deploy |
| screen, sheet | `apps/web/src/features/<topic>/` + `EntryKind` in `state/stack.ts` + `features/registry.tsx` |
| app error code | `apiError(status, code)` on the server + text in `apps/web/src/api/errorText.ts` |
| UI text | `apps/web/src/i18n/uk.json` + `en.json` |
| API call from the Mini App | the `createApiClient` client and `tmaApi` from `tma-starter/web`; your own calls go in `apps/web/src/api/` |
| Telegram WebApp call | `tg` from `tma-starter/web` |
| theme color or token | `apps/web/src/theme/tokens.css` |
| deploy | `deploy/` |
