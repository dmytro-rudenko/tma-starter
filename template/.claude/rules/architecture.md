# Architecture

## Dependencies

- Infrastructure (auth, users, admin rights, admin panel, settings, audit, realtime, bot, broadcasts, payments, entitlements) lives in the `tma-starter` package. Do not copy its code into the app: extend it through `forRoot`, registries and `copy`.
- `apps/web` and `apps/api` do not import each other. `apps/web` does not import nest subpaths: it takes the API client, types and error codes from `tma-starter/web`.
- An API module has one responsibility and its own `*.module.ts`; dependencies arrive through the constructor and the Nest DI container.

## Extension points

| Need | How |
|---|---|
| your own setting in the admin panel | `defineSetting` + `AppSettingsRegistry.register` in `onModuleInit` |
| block in the user card | `AdminUserCardRegistry.register(key, userId => …)` |
| broadcast audience filter | `BroadcastAudienceRegistry.register({ key, label, apply })` |
| `/start <param>` parameter | `StartParamRoute` in `TmaBotModule.forRoot({ startParams })` |
| bot texts | `copy` in `TmaBotModule.forRoot` |
| products and subscriptions | `apps/api/src/products.ts` → `TmaPaymentsModule.forRoot({ products })` |
| access by purchase | `@UseGuards(EntitlementGuard('<productId>'))` |
| your own tables | migration in `apps/api/src/database/migrations/` |

## The server is the source of truth

- Trust only the server. Validation in the Mini App is only a UI hint. Take the user from `@CurrentUser()`, never from the body or query.
- An admin is a Telegram ID from `ADMIN_USER_IDS` (these rights cannot be revoked) or a user with `users.admin_granted_at` who was granted rights in the admin panel. Check through `AdminRightsService.isAdmin`.
- An admin action writes an audit record in the same transaction (`AuditService.record`): if the audit fails, the action is rolled back.

## Errors

- Throw an expected failure through `apiError(status, code)`; the client receives `{ statusCode, message, error, code }`.
- Throw a plain `Error` on a violated invariant.
