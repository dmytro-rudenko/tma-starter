# Стиль коду

## TypeScript

- `strict: true` з `tsconfig.base.json`; не послаблюй його в пакетних tsconfig.
- Зовнішні дані приймай через DTO з `class-validator` (тіло запиту) або як `unknown` зі звуженням перевірками.
- Замість `enum` пиши union рядкових літералів або `as const`.
- Експортуй іменовано; default export — лише там, де його вимагає інструмент (`vite.config.ts`).
- Не залишай плаваючих промісів: `await`, `return`, `.catch(...)` або `void`, якщо виклик навмисно fire-and-forget і сам не кидає винятків.
- Коментар пиши лише для обмеження, яке код не показує: особливість протоколу, неочевидний інваріант, обхід із тікетом. Не розповідай, що робить наступний рядок.

## Імена

- `apps/api`: `kebab-case.ts` з Nest-суфіксом за роллю — `*.module.ts`, `*.service.ts`, `*.controller.ts`, `*.guard.ts`, `*.decorator.ts`.
- `apps/web`: компоненти — `PascalCase.tsx` зі стилями `PascalCase.module.css`, решта — `camelCase.ts`.
- Класи й типи — `PascalCase`, константи модуля — `UPPER_SNAKE`.
- Одиниця виміру — в імені: `INIT_DATA_MAX_AGE_SEC`, `amount_stars`.

## Тести

| Пакет | Поруч із кодом | Окремо |
|---|---|---|
| `apps/api` | jest, `*.spec.ts` | `test/*.spec.ts`, `test/*.acceptance.spec.ts` |
| `apps/web` | vitest, `*.test.ts(x)` | — |

Лише unit- і модульні тести: e2e і Playwright немає. API-тести піднімають `AppModule` через `createTestApp` з `@dmytro-rudenko/tma-testing` на реальному Postgres (`pnpm db:start`).

## Інструменти

- Форматує Prettier (`.prettierrc`: одинарні лапки, trailing commas, ширина 100).
- Лінтера немає: типи перевіряє `pnpm typecheck`.

## Мова

- Код, коментарі, логи й коміти (Conventional Commits) — англійською.
- Тексти для користувача — лише через i18n, обома мовами (`uk`, `en`).
- `CLAUDE.md`, ці правила й README — українською.
