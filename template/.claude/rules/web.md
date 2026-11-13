---
paths:
  - "apps/web/**"
---
# apps/web

- Роутера немає. Інтерфейс складається з вкладок (`state/tabs.ts`) і стеку аркушів поверх них (`state/stack.ts`). Новий екран — це значення в `EntryKind` і запис у `features/registry.tsx`; повноекранний шар також додається у `FULLSCREEN_KINDS`.
- HTTP до сервера — лише через клієнт `createApiClient` з `@dmytro-rudenko/tma-web` (додає `Authorization: tma <initData>`, перетворює відповідь на `ApiError`). Серверний стан живе в TanStack Query: хуки пакета (`useMe`, `useProducts`, `useEntitlement`, `usePurchase`) з `@dmytro-rudenko/tma-web/react`, свої запити — через `tmaKeys` і власні хуки.
- До `window.Telegram.WebApp` звертайся лише через `tg` з `@dmytro-rudenko/tma-web`: кожен метод працює поза Telegram і на старих клієнтах.
- Тему й префи пристрою (`applyTheme`, `createPrefsCache`) бери з `@dmytro-rudenko/tma-web`, а не пиши свій доступ до `localStorage`.
- Код помилки з сервера показуй через `api/errorText.ts`, не сирий `code` чи `message`. `errorText` має тип `Record<TmaApiErrorCode | AppErrorCode, string>`, тож код, якого немає в мапі, не пройде `pnpm typecheck`.
- Кольори бери зі змінних `theme/tokens.css`; новий колір теми додавай туди ж, для світлої й темної теми.
- Відступи бери зі змінних `--safe-top` і `--safe-bottom`, а не напряму з `env(safe-area-inset-*)`: повноекранний режим Telegram додає власні кнопки зверху.
- Тексти лежать в `i18n/uk.json` і `i18n/en.json`; нові рядки додавай в обидва файли, тест на паритет ключів це перевіряє.
- Компонентні тести працюють у jsdom з `installFakeWebApp` з `@dmytro-rudenko/tma-testing`.
- UI-зміну перевіряй у браузері на ширині 320px з touch, у світлій і темній темі.
