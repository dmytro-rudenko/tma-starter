---
paths:
  - "apps/api/**"
---
# apps/api

## Загальне

- БД — PostgreSQL через Knex. Той самий екземпляр `DatabaseModule` передано в `TmaCoreModule.forRoot`; не створюй друге з'єднання.
- Схему змінюй лише новою міграцією в `database/migrations/`; застосовану міграцію не редагуй — на проді вона вже виконана. Порядок міграцій задає `composeMigrations(core, bot, payments, appMigrations)` у `database/migrate.ts`: спершу пакети, потім застосунок. Пакети припускають, що схема вже змігрована.
- **Міграції йдуть до старту нового API.** `deploy.sh` виконує `node dist/database/migrate.js latest` в одноразовому контейнері, а потім `up -d api`. Поки міграція виконується, а потім до перезапуску, стара версія коду працює на новій схемі: пиши міграції зворотно сумісними (додавай колонки, не перейменовуй і не видаляй у тому ж деплої).
- `process.env` читає лише `config/env.ts`; решта коду бере значення з `ConfigService`. Логуй через Nest `Logger`, не `console.*`. Виняток для обох правил — CLI `database/migrate.ts`.
- Не пиши в логи `BOT_TOKEN`, `WEBHOOK_SECRET`, `WEBHOOK_PATH_TOKEN`, `initData` і заголовок `Authorization`.
- Нові ендпоінти, що приймають великі тіла чи шлють повідомлення, отримують власний `@Throttle` і ліміт розміру.
- Виклики Telegram не робимо всередині транзакції: лише після коміту, сповіщення — fire-and-forget (`NotificationsService.send` не кидає винятків).
- Deep links будуй лише через `BotService.startAppUrl(param)`: `t.me/<bot>?startapp=<param>` без short name, інакше Main Mini App втрачає `start_param`.
- Налаштування бота (webhook, профіль) під час старту API не змінюються: це робить `tma-bot setup` на деплої. Змінив `bot/profile.json` — задеплой.

## Авторизація

- `TelegramAuthGuard` і `UserThrottlerGuard` реєструє `TmaCoreModule` як `APP_GUARD`; не додавай їх вдруге в `AppModule`.
- Guard перевіряє лише `/api/*` (заголовок `Authorization: tma <initData>`, `@Public()` це вимикає). `/bot` має власний захист.
- Заблокований користувач (`users.blocked_at`) отримує 403 `USER_BLOCKED`; бот його ігнорує, крім `successful_payment`.
- Webhook бота має два окремі секрети: `WEBHOOK_PATH_TOKEN` у шляху і `WEBHOOK_SECRET` у заголовку, бо URL потрапляють у логи.

## Платежі

- Платежі, відшкодування й entitlements веде `@dmytro-rudenko/tma-nest-payments`; застосунок лише описує продукти. Ідемпотентність за `telegram_payment_charge_id` забезпечує пакет.
- Доступ за покупкою перевіряй через `EntitlementGuard('<productId>')` або `EntitlementsService.has`, а не власними запитами до таблиць.

## Тести

- `createTestApp` з `@dmytro-rudenko/tma-testing` піднімає `AppModule` на новій базі з фейковим Bot API. Підміняй лише зовнішнє (`overrides`), не сервіси й не БД.
