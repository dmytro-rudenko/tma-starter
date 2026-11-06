# Організація коду

## Модулі

- Не створюй тек `utils/`, `helpers/` у `src/`: код живе в модулі, якому належить.
- Файл понад ~300 рядків — сигнал розділити.
- Одна тека на Nest-модуль у `apps/api/src/features/<тема>/`, контролер живе у своєму модулі, DTO запитів — у `<модуль>/dto/*.dto.ts`.
- Не дублюй те, що вже є в `@dmytro-rudenko/tma-*`: спершу перевір експорти пакетів.

## Куди класти новий код

| Що | Куди |
|---|---|
| HTTP-ендпоінт | `apps/api/src/features/<тема>/*.controller.ts` + сервіс |
| таблиця чи колонка | нова міграція в `apps/api/src/database/migrations/` + інтерфейс `*Row` поруч із запитами |
| змінна середовища | `apps/api/src/config/env.ts` + `.env.example` |
| продукт чи підписка | `apps/api/src/products.ts` |
| команда чи параметр `/start` бота | `StartParamRoute` у `TmaBotModule.forRoot` в `app.module.ts` |
| текст бота | `apps/api/src/bot/copy.ts` (`copy` у `TmaBotModule.forRoot`) |
| профіль бота: кнопка меню, описи, команди | `apps/api/bot/profile.json`; застосовується `tma-bot setup` під час деплою |
| екран, аркуш | `apps/web/src/features/<тема>/` + `EntryKind` у `state/stack.ts` + `features/registry.tsx` |
| код помилки застосунку | `apiError(status, code)` на сервері + текст у `apps/web/src/api/errorText.ts` |
| текст UI | `apps/web/src/i18n/uk.json` + `en.json` |
| виклик API з Mini App | клієнт `createApiClient` і `tmaApi` з `@dmytro-rudenko/tma-web`, свої виклики — в `apps/web/src/api/` |
| виклик Telegram WebApp | `tg` з `@dmytro-rudenko/tma-web` |
| колір чи токен теми | `apps/web/src/theme/tokens.css` |
| деплой | `deploy/` |
