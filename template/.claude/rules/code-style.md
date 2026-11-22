# Code style

## TypeScript

- `strict: true` from `tsconfig.base.json`; do not weaken it in package tsconfigs.
- Accept external data through `class-validator` DTOs (request body) or as `unknown` narrowed with checks.
- Instead of `enum`, use a union of string literals or `as const`.
- Use named exports; default export only where a tool requires it (`vite.config.ts`).
- Leave no floating promises: `await`, `return`, `.catch(...)` or `void` if the call is intentionally fire-and-forget and never throws itself.
- Write a comment only for a constraint the code does not show: a protocol quirk, a non-obvious invariant, a workaround with a ticket. Do not narrate what the next line does.

## Naming

- `apps/api`: `kebab-case.ts` with a Nest suffix for the role — `*.module.ts`, `*.service.ts`, `*.controller.ts`, `*.guard.ts`, `*.decorator.ts`.
- `apps/web`: components are `PascalCase.tsx` with styles in `PascalCase.module.css`, everything else is `camelCase.ts`.
- Classes and types are `PascalCase`, module constants are `UPPER_SNAKE`.
- Put the unit in the name: `INIT_DATA_MAX_AGE_SEC`, `amount_stars`.

## Tests

| Package | Next to the code | Separate |
|---|---|---|
| `apps/api` | jest, `*.spec.ts` | `test/*.spec.ts`, `test/*.acceptance.spec.ts` |
| `apps/web` | vitest, `*.test.ts(x)` | — |

Unit and module tests only: there are no e2e or Playwright tests. API tests bring up `AppModule` through `createTestApp` from `tma-starter/testing` on a real Postgres (`pnpm db:start`).

## Tooling

- Prettier formats (`.prettierrc`: single quotes, trailing commas, width 100).
- There is no linter: `pnpm typecheck` checks types.

## Language

- Code, comments, logs and commits (Conventional Commits) are in English.
- User-facing text goes only through i18n, in both languages (`uk`, `en`).
- `CLAUDE.md`, these rules and the README are in English.
