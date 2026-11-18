# Архітектура

## Залежності

- Інфраструктура (auth, користувачі, права адмінів, адмінка, налаштування, аудит, realtime, бот, розсилки, платежі, entitlements) живе в пакетах `@dmytro-rudenko/tma-*`. Не копіюй її код у застосунок: розширюй через `forRoot`, реєстри й `copy`.
- `apps/web` і `apps/api` не імпортують один одного. `apps/web` не імпортує nest-пакети: клієнт API, типи й коди помилок бере з `@dmytro-rudenko/tma-web`.
- Модуль API — одна відповідальність і власний `*.module.ts`; залежності приходять через конструктор і DI-контейнер Nest.

## Точки розширення

| Потрібно | Як |
|---|---|
| власне налаштування в адмінці | `defineSetting` + `AppSettingsRegistry.register` в `onModuleInit` |
| блок у картці користувача | `AdminUserCardRegistry.register(key, userId => …)` |
| фільтр аудиторії розсилки | `BroadcastAudienceRegistry.register({ key, label, apply })` |
| параметр `/start <param>` | `StartParamRoute` у `TmaBotModule.forRoot({ startParams })` |
| тексти бота | `copy` у `TmaBotModule.forRoot` |
| продукти й підписки | `apps/api/src/products.ts` → `TmaPaymentsModule.forRoot({ products })` |
| доступ за покупкою | `@UseGuards(EntitlementGuard('<productId>'))` |
| власні таблиці | міграція в `apps/api/src/database/migrations/` |

## Сервер — джерело правди

- Довіряти можна лише серверу. Перевірка в Mini App — лише підказка в UI. Користувача бери з `@CurrentUser()`, ніколи з тіла чи query.
- Адмін — Telegram ID з `ADMIN_USER_IDS` (права не знімаються) або користувач із `users.admin_granted_at`, якому права надали в адмінці. Перевіряй через `AdminRightsService.isAdmin`.
- Дія адміна пише аудит у тій самій транзакції (`AuditService.record`): якщо аудит падає, дія відкочується.

## Помилки

- Очікувану відмову кидай через `apiError(status, code)`; клієнт отримує `{ statusCode, message, error, code }`.
- На порушений інваріант кидай звичайний `Error`.
