---
paths:
  - "apps/web/**"
---
# apps/web

- There is no router. The UI is built from tabs (`state/tabs.ts`) and a stack of sheets on top of them (`state/stack.ts`). A new screen is a value in `EntryKind` and an entry in `features/registry.tsx`; a fullscreen layer is also added to `FULLSCREEN_KINDS`.
- HTTP to the server goes only through the `createApiClient` client from `tma-starter/web` (it adds `Authorization: tma <initData>` and turns the response into `ApiError`). Server state lives in TanStack Query: package hooks (`useMe`, `useProducts`, `useEntitlement`, `usePurchase`) from `tma-starter/web/react`; your own queries go through `tmaKeys` and your own hooks.
- Access `window.Telegram.WebApp` only through `tg` from `tma-starter/web`: every method works outside Telegram and on old clients.
- Take the theme and device prefs (`applyTheme`, `createPrefsCache`) from `tma-starter/web`; do not write your own `localStorage` access.
- Show a server error code through `api/errorText.ts`, not the raw `code` or `message`. `errorText` has the type `Record<TmaApiErrorCode | AppErrorCode, string>`, so a code missing from the map fails `pnpm typecheck`.
- Take colors from the variables in `theme/tokens.css`; add a new theme color there too, for both the light and dark theme.
- Take insets from the `--safe-top` and `--safe-bottom` variables, not directly from `env(safe-area-inset-*)`: Telegram's fullscreen mode adds its own buttons at the top.
- Texts live in `i18n/uk.json` and `i18n/en.json`; add new strings to both files, a key parity test checks this.
- Component tests run in jsdom with `installFakeWebApp` from `tma-starter/testing/dom`.
- Check a UI change in a browser at 320px width with touch, in the light and dark theme.
