---
name: new
description: Use when the user asks to create a new Telegram Mini App, start a TMA project, or scaffold a mini app with users, admin rights and Telegram Stars payments. Interviews for the variant (empty or shop) and parameters, generates the project from the tma-starter template and brings it to locally green tests
version: 0.0.0
---

# Новий Telegram Mini App

Створи проєкт із шаблону `tma-starter`, доведи його до зелених тестів і зроби перший коміт. Спілкуйся мовою користувача. Деплой, GitHub-репозиторій і секрети не чіпай.

## Preflight

Перед опитуванням перевір у Bash:

- `node -v` — не нижче 26.13.0;
- `pnpm -v` — версія 10;
- `perl -v` і `openssl version`;
- `pg_ctl` — у `PATH`, `/usr/lib/postgresql/16/bin`, `/opt/homebrew/opt/postgresql@16/bin`, `/usr/local/opt/postgresql@16/bin`.

Якщо бракує Node, pnpm, `perl` чи `openssl`, назви, що саме, і зупинися, доки користувач не встановить. Якщо немає Postgres 16, запропонуй через `AskUserQuestion` або команду встановлення для його ОС (`apt install postgresql-16` або `brew install postgresql@16`), або вказати наявний `DATABASE_ADMIN_URL`. У другому випадку `pnpm db:start` пізніше пропусти.

## Опитування

Кожне питання задай окремим `AskUserQuestion`. Те, що користувач уже назвав у запиті, не перепитуй.

1. **Варіант.** `AskUserQuestion` з варіантами «Порожній каркас» (Home, Settings, адмінка) і «Демо-магазин» (те саме плюс Shop, Premium, paywall, керування підпискою). Значення прапорця: `empty` або `shop`.
2. **Назва застосунку** (`--title`). `AskUserQuestion` із 2 запропонованими назвами; свою користувач вводить через Other. Назва: 2–32 символи, лише літери (зокрема кирилиця), цифри, пробіл і `. , - ! ? : ’`. Апостроф лише `’` (U+2019), ASCII `'` заміни. Виведи `slug` транслітерацією в kebab-case (`^[a-z][a-z0-9-]{1,30}$`) і підтверди його окремим `AskUserQuestion`: «Так» або правка через Other.
3. **Username бота** і **домен**: два окремі `AskUserQuestion`, у кожному є варіант «Ще немає».
   - Бот: `^[A-Za-z0-9_]{5,32}$`, без `@`. «Ще немає» дає `<slug з _ замість ->_bot`; якщо довше за 32 символи, скороти slug перед `_bot`.
   - Домен: без схеми й без `/`. «Ще немає» дає `<slug>.example.com`.
   - Запам'ятай, що саме підставлено за замовчуванням: це піде у фінальне повідомлення.
4. **Мова за замовчуванням** (`uk` або `en`) і **акцентний колір**: два окремі `AskUserQuestion`. Кольори: `#2f80ed`, `#e5484d`, `#30a46c`; свій `#rrggbb` через Other.
5. **Telegram id адмінів.** `AskUserQuestion` з варіантом «Пропустити»; id через кому вводяться через Other. Підкажи, що id показує `@userinfobot`. Якщо пропущено, прапорець `--admin-ids` не передавай і запам'ятай це для фінального повідомлення.
6. **Продукти** (лише для `shop`). `AskUserQuestion` з варіантами «Прийняти стандартні» (`premium`: subscription, 250 ⭐; `coffee`: one_time, repeatable, 50 ⭐) і «Задати свої».
   - «Задати свої»: для кожного продукту збери `id`, `kind` (`one_time` або `subscription`), `priceStars` (ціле 1–10000), `repeatable` (необов'язково), `title` і `description` українською та англійською.
   - Обов'язково один продукт з `id` `premium` і `kind` `subscription`: від нього залежать Premium-блок і paywall. Якщо користувач відмовляється, поверни стандартні.
7. **Директорія.** `AskUserQuestion` з варіантом `./<slug>` від поточної теки; свою через Other. Тека має не існувати або бути порожньою.

## Підсумок

Покажи всі параметри одним повідомленням: варіант, title, slug, бот, домен, мова, колір, адміни, продукти (для shop), директорія. Познач значення, підставлені за замовчуванням. Далі переходь до генерації; перепитувати потрібно, лише якщо користувач поправить щось у відповідь.

## Генерація

Shell не зберігається між викликами Bash, тому запис JSON продуктів, запуск скрипта й видалення файла роби одним викликом. Для `shop` це такий блок (стандартні продукти):

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

- Для власних продуктів заміни рядок з масивом усередині heredoc на свій масив, екрануючи лапки за правилами JSON.
- Для `empty` файл продуктів не потрібен:

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

- `--admin-ids` пропусти, якщо користувач не назвав id. `--tma-source` не використовуй: це прапорець для CI плагіна.
- Успіх друкує `scaffolded <dir> (<variant>)`.
- Exit 2: невалідний аргумент. Покажи повідомлення скрипта, перепитай лише проблемне значення через `AskUserQuestion` і запусти знову. Якщо проблема в `--dir`, це непорожня тека.
- Exit 3: у згенерованому проєкті лишились плейсхолдери чи маркери магазину. Це баг плагіна: покажи вивід, нічого не латай, запропонуй повідомити на `https://github.com/dmytro-rudenko/tma-starter/issues`.
- Інший код: покажи вивід і зупинися.

## Перевірка в проєкті

З теки проєкту виконуй команди по черзі. Вони довгі, тож став timeout до 10 хвилин.

1. `pnpm install`
2. `pnpm db:start` (пропусти, якщо користувач вказав `DATABASE_ADMIN_URL`; тоді передавай його в середовище наступних команд і, якщо сервер не `127.0.0.1:54329`, узгодь з користувачем `DATABASE_URL` у локальному `.env`)
3. `pnpm db:create`
4. `pnpm db:migrate`
5. `pnpm -r typecheck`
6. `pnpm -r test`
7. `pnpm -r build`

Якщо команда падає, зупинися на ній. Покажи її вивід, не запускай наступні команди й нічого в шаблоні не змінюй. Запропонуй повідомити про баг на `https://github.com/dmytro-rudenko/tma-starter/issues`, додавши команду та вивід.

## Коміт

Версію візьми з `version` у `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`. З теки проєкту:

```bash
git init -b main && git add -A && git commit -m "chore: scaffold from tma-starter <version>"
```

Перед комітом переконайся, що `.env` не потрапив в індекс (`git ls-files .env` порожній). У повідомлення коміту не додавай жодних трейлерів авторства.

## Фінальне повідомлення

Напиши користувачу:

- Як запустити: `pnpm dev` піднімає застосунок без Telegram і без справжнього бота та друкує `devUrl` для першого id з `ADMIN_USER_IDS`. Відкрий цей URL у браузері. Потрібна запущена БД (`pnpm db:start`).
- Чекліст деплою з розділу «Deploy» файла `README.md` проєкту: прочитай його й перелічи пункти.
- Позначки, де лишились значення за замовчуванням, лише з тих, що справді підставлено:
  - бот `<slug>_bot` не існує: створи його в BotFather й підстав справжній username;
  - домен `<slug>.example.com` — заглушка: підстав справжній;
  - адміни: локально `ADMIN_USER_IDS=1`, а у `.env.example` для production значення порожнє, тож додай свої id у `/etc/<slug>/.env`.
- Мова бота: українською бот відповідає лише користувачам із мовою `uk`, усім іншим англійською.
- Нагадай, що push у `main` деплоїть у production, а скрипти деплою, GitHub-репозиторій і секрети ти не налаштовував.
