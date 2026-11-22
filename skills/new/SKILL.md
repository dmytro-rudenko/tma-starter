---
name: new
description: Use when the user asks to create a new Telegram Mini App, start a TMA project, or scaffold a mini app with users, admin rights and Telegram Stars payments. Interviews for the variant (empty or shop) and parameters, generates the project from the tma-starter template and brings it to locally green tests
version: 0.1.1
---

# New Telegram Mini App

Create a project from the `tma-starter` template, bring it to green tests and make the first commit. Talk to the user in their language. Do not touch deploy, the GitHub repository or secrets.

## Preflight

Before the interview, check in Bash:

- `node -v` — at least 26.13.0;
- `pnpm -v` — version 10;
- `perl -v` and `openssl version`;
- `pg_ctl` — in `PATH`, `/usr/lib/postgresql/16/bin`, `/opt/homebrew/opt/postgresql@16/bin`, `/usr/local/opt/postgresql@16/bin`.

If Node, pnpm, `perl` or `openssl` is missing, name what is missing and stop until the user installs it. If there is no Postgres 16, use `AskUserQuestion` to offer either the install command for their OS (`apt install postgresql-16` or `brew install postgresql@16`) or an existing `DATABASE_ADMIN_URL`. In the second case, skip `pnpm db:start` later.

## Interview

Ask each question in its own `AskUserQuestion`. Do not re-ask what the user already stated in the request.

1. **Variant.** `AskUserQuestion` with the options "Empty skeleton" (Home, Settings, admin panel) and "Demo shop" (the same plus Shop, Premium, paywall, subscription management). Flag value: `empty` or `shop`.
2. **App name** (`--title`). `AskUserQuestion` with 2 suggested names; the user types their own through Other. The name: 2–32 characters, only letters (Cyrillic included), digits, space and `. , - ! ? : ’`. The apostrophe is only `’` (U+2019); replace ASCII `'`. Derive the `slug` by transliteration into kebab-case (`^[a-z][a-z0-9-]{1,30}$`) and confirm it in a separate `AskUserQuestion`: "Yes" or an edit through Other.
3. **Bot username** and **domain**: two separate `AskUserQuestion`s, each with a "Not yet" option.
   - Bot: `^[A-Za-z0-9_]{5,32}$`, without `@`. "Not yet" gives `<slug with _ instead of ->_bot`; if that is longer than 32 characters, shorten the slug before `_bot`.
   - Domain: no scheme and no `/`. "Not yet" gives `<slug>.example.com`.
   - Remember exactly what was filled in by default: it goes into the final message.
4. **Default language** (`uk` or `en`) and **accent color**: two separate `AskUserQuestion`s. Colors: `#2f80ed`, `#e5484d`, `#30a46c`; a custom `#rrggbb` through Other.
5. **Admin Telegram ids.** `AskUserQuestion` with a "Skip" option; the user enters comma-separated ids through Other. Mention that `@userinfobot` shows the id. If skipped, do not pass the `--admin-ids` flag and remember this for the final message.
6. **Products** (`shop` only). `AskUserQuestion` with the options "Accept defaults" (`premium`: subscription, 250 ⭐; `coffee`: one_time, repeatable, 50 ⭐) and "Set my own".
   - "Set my own": for each product collect `id`, `kind` (`one_time` or `subscription`), `priceStars` (integer 1–10000), `repeatable` (optional), `title` and `description` in Ukrainian and English.
   - One product with `id` `premium` and `kind` `subscription` is required: the Premium block and the paywall depend on it. If the user refuses, restore the defaults.
7. **Directory.** `AskUserQuestion` with the option `./<slug>` in the current directory; a custom one through Other. The directory must not exist or must be empty.

## Summary

Show all parameters in one message: variant, title, slug, bot, domain, language, color, admins, products (for shop), directory. Mark the values filled in by default. Then go on to generation; ask again only if the user corrects something in reply.

## Generation

The shell does not persist between Bash calls, so write the products JSON, run the script and delete the file in one call. For `shop` this is the block (default products):

```bash
PRODUCTS="$(mktemp "${TMPDIR:-/tmp}/tma-products.XXXXXX")"
cat > "$PRODUCTS" <<'JSON'
[{"id":"premium","kind":"subscription","priceStars":250,"title":{"uk":"Преміум","en":"Premium"},"description":{"uk":"Доступ до преміум-контенту на 30 днів","en":"Access to premium content for 30 days"}},{"id":"coffee","kind":"one_time","priceStars":50,"repeatable":true,"title":{"uk":"Кава для автора","en":"Coffee for the author"},"description":{"uk":"Разова підтримка проєкту","en":"One-time support for the project"}}]
JSON
bash "${CLAUDE_PLUGIN_ROOT}/skills/new/scaffold.sh" \
  --dir "<dir>" \
  --slug "<slug>" \
  --title "<title>" \
  --bot-username "<bot>" \
  --domain "<domain>" \
  --variant shop \
  --default-lang <uk|en> \
  --accent "<#rrggbb>" \
  --admin-ids "<1,2>" \
  --api-port 3200 \
  --products "$PRODUCTS"
status=$?
rm -f "$PRODUCTS"
exit $status
```

- For custom products, replace the array line inside the heredoc with your own array, escaping quotes per JSON rules.
- For `empty` no products file is needed:

  ```bash
  bash "${CLAUDE_PLUGIN_ROOT}/skills/new/scaffold.sh" \
    --dir "<dir>" \
    --slug "<slug>" \
    --title "<title>" \
    --bot-username "<bot>" \
    --domain "<domain>" \
    --variant empty \
    --default-lang <uk|en> \
    --accent "<#rrggbb>" \
    --admin-ids "<1,2>" \
    --api-port 3200
  ```

- Skip `--admin-ids` if the user did not give any ids. Do not use `--tma-source`: it is a flag for the plugin's CI.
- Success prints `scaffolded <dir> (<variant>)`.
- Exit 2: invalid argument. Show the script's message, re-ask only the problem value through `AskUserQuestion` and run again. If the problem is `--dir`, the directory is not empty.
- Exit 3: the generated project still has placeholders or shop markers. This is a plugin bug: show the output, patch nothing, and suggest reporting it at `https://github.com/dmytro-rudenko/tma-starter/issues`.
- Any other code: show the output and stop.

## Checks in the project

Run the commands one after another from the project directory. They are long, so set the timeout to 10 minutes.

1. `pnpm install`
2. `pnpm db:start` (skip if the user gave `DATABASE_ADMIN_URL`; then pass it in the environment of the next commands and, if the server is not `127.0.0.1:54329`, agree with the user on `DATABASE_URL` in the local `.env`)
3. `pnpm db:create`
4. `pnpm db:migrate`
5. `pnpm -r typecheck`
6. `pnpm -r test`
7. `pnpm -r build`

If a command fails, stop at it. Show its output, do not run the next commands and change nothing in the template. Suggest reporting the bug at `https://github.com/dmytro-rudenko/tma-starter/issues`, attaching the command and its output.

## Commit

Take the version from `version` in `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`. From the project directory:

```bash
git init -b main && git add -A && git commit -m "chore: scaffold from tma-starter <version>"
```

Before committing, make sure `.env` did not get into the index (`git ls-files .env` is empty). Do not add any authorship trailers to the commit message.

## Final message

Write to the user:

- How to run: `pnpm dev` brings up the app without Telegram and without a real bot, and prints `devUrl` for the first id in `ADMIN_USER_IDS`. Open this URL in a browser. A running DB is required (`pnpm db:start`).
- The deploy checklist from the "Deploy" section of the project's `README.md`: read it and list the items.
- Notes on where default values remain, only for those actually filled in:
  - bot `<slug>_bot` does not exist: create it in BotFather and fill in the real username;
  - domain `<slug>.example.com` is a placeholder: fill in the real one;
  - admins: locally `ADMIN_USER_IDS=1`, and in `.env.example` the production value is empty, so add their ids to `/etc/<slug>/.env`.
- Bot language: the bot replies in Ukrainian only to users whose language is `uk`, and in English to everyone else.
- Remind them that a push to `main` deploys to production, and that you did not set up the deploy scripts, the GitHub repository or the secrets.
