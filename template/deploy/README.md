# Деплой

Production працює на **спільному** хості: поруч стоять контейнери й nginx-сайти інших проєктів.
Host nginx віддає збірку web із `/var/www/__APP_SLUG__` і проксіює `/api/` та `/bot/` на контейнер
`api` за адресою `127.0.0.1:__API_PORT__` (`API_HOST_PORT`, значення за замовчуванням у compose).
`postgres` назовні не опублікований. `/api/socket.io/` проксіюється як websocket (заголовки
Upgrade, таймаут читання 75 с). Проєкт compose закріплено як `__APP_SLUG__`, тож мережа й томи в
нього власні. Наш nginx-сайт — `/etc/nginx/sites-available/__DOMAIN__` (+ симлінк); решту в
`/etc/nginx` скрипти не чіпають.

## Деплой через GitHub Actions

Кожен push у `main` запускає `.github/workflows/deploy.yml`: job **Unit tests** (unit-тести api і
web проти сервісу `postgres:16`) і, лише якщо він зелений, job **Deploy** (середовище GitHub
`production`). Push, що змінює тільки `docs/**` або `*.md`, пропускається. Запустити вручну можна
через Actions → **Deploy** → **Run workflow**; запуск з іншої гілки, ніж `main`, проганяє лише
тести. Група `concurrency: deploy` ставить другий запуск у чергу замість паралельного. Повторити
деплой можна кнопкою Run workflow або «Re-run jobs»: кожен крок ідемпотентний.

Job: checkout → Node 26.13.0 і pnpm 10.28.0 → `pnpm install --frozen-lockfile` →
`deploy/check.sh` → запис SSH-ключа й `known_hosts` → `bash deploy/deploy.sh`. Скрипт робить таке:

1. локально збирає `@__APP_SLUG__/web`; далі відкриває одне ssh-з'єднання (до 6 спроб,
   `ConnectTimeout=20`), яке повторно використовують усі наступні ssh і rsync через
   `ControlMaster`, тож збій рукостискання sshd не ламає крок посередині;
2. rsync-ить репозиторій у `/opt/__APP_SLUG__` (без `node_modules`, `.git`, `dist`, `.env*`, крім
   кореневого `.env.example`, і без `.pgdata`);
3. запускає на сервері `deploy/server-setup.sh` (`BOT_TOKEN` іде через stdin ssh, див. нижче);
4. `docker compose -f deploy/docker-compose.yml --env-file /etc/__APP_SLUG__/.env build`. Образ
   тягне пакети в шарі, ключем якого є лише `pnpm-lock.yaml`, а потім ставить їх `--offline`, тож
   з реєстру npm щось завантажується лише після зміни lockfile. Збірка йде відокремлено на сервері
   (`setsid nohup`, лог у `/var/log/__APP_SLUG__/build.log`); `deploy.sh` опитує лог кожні 10 с
   короткими ssh-викликами, повторює обірваний виклик і здається через 20 хв;
5. резервна копія перед міграціями: піднімає `postgres` (`up -d --wait postgres`) і знімає дамп
   (лише для власника, `.tmp` + `mv`) у `/var/backups/__APP_SLUG__/pre-deploy-<ts>.sql.gz`; копії
   живуть 14 днів; невдалий дамп зупиняє деплой;
6. міграції в одноразовому контейнері: `docker compose run --rm api node dist/database/migrate.js latest`.
   Поки вони йдуть, працює стара версія api. Збій міграції зупиняє деплой, стара версія лишається;
7. `up -d api` створює контейнер із новою версією;
8. чекає до 60 с на `http://127.0.0.1:${API_HOST_PORT:-__API_PORT__}/api/health` (порт береться з
   `/etc/__APP_SLUG__/.env`; при збої друкує логи api);
9. лише тепер rsync-ить `apps/web/dist/` у `/var/www/__APP_SLUG__/` (`/.well-known` для certbot
   лишається): якщо будь-який попередній крок упав, попередня збірка web лишається живою;
10. `docker compose exec -T -e BOT_PROFILE=/app/apps/api/bot/profile.json api npx tma-bot setup`
    ставить webhook (`secret_token`, `allowed_updates`) і синхронізує профіль бота з
    `apps/api/bot/profile.json`: кнопку меню, описи й команди (`en` за замовчуванням, `uk` через
    `language_code`). Код виходу 1 означає, що впав `setWebhook`; код 2 означає, що webhook уже
    встановлено, але впав хоча б один виклик профілю. Обидва коди валять деплой;
11. очищення лише цього проєкту: `docker image prune -f --filter
    label=com.docker.compose.project=__APP_SLUG__` і `docker builder prune -f --filter until=168h`.
    Ніколи `docker system prune`, ніколи томи.

Compose обмежує пам'ять (`api` 768m, `postgres` 512m) і ротує логи контейнерів (json-file,
10m × 3), щоб спільний хост не вичерпався.

**Відкат невдалої міграції:** відновіть останній `pre-deploy-*.sql.gz`
(`gunzip -c … | docker compose … exec -T postgres psql -U __APP_DB__ __APP_DB__` у порожню БД),
потім задеплойте попередній коміт.

### Секрети репозиторію (Settings → Secrets and variables → Actions)

| Секрет | Значення |
|---|---|
| `DEPLOY_SSH_KEY` | приватний ключ (ed25519), публічна частина якого лежить в `~root/.ssh/authorized_keys` сервера |
| `DEPLOY_HOST` | IP сервера або `__DOMAIN__` |
| `DEPLOY_USER` | `root` |
| `DEPLOY_KNOWN_HOSTS` | вивід `ssh-keyscan -t ed25519 <DEPLOY_HOST>`; звірте відбиток із `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` на сервері |
| `BOT_TOKEN` | токен від @BotFather |

`DEPLOY_KNOWN_HOSTS` має називати той самий хост, що й `DEPLOY_HOST` (IP і DNS-ім'я — різні).

### Ротація

- **Ключ деплою:** `ssh-keygen -t ed25519 -N '' -f __APP_SLUG__-deploy`, додайте
  `__APP_SLUG__-deploy.pub` в `authorized_keys` сервера, оновіть `DEPLOY_SSH_KEY`, запустіть
  workflow і лише потім приберіть старий публічний ключ.
- **BOT_TOKEN:** відкличте в @BotFather, оновіть секрет, запустіть workflow: `server-setup.sh`
  замінить рядок `BOT_TOKEN=`, compose перестворить `api`, `tma-bot setup` перереєструє webhook.
- **WEBHOOK_SECRET / WEBHOOK_PATH_TOKEN:** `WEBHOOK_PATH_TOKEN` — сегмент шляху `/bot/<token>`,
  `WEBHOOK_SECRET` — значення заголовка `X-Telegram-Bot-Api-Secret-Token`. Відредагуйте
  `/etc/__APP_SLUG__/.env` на сервері (`openssl rand -hex 32`) і запустіть workflow: `api`
  перестворюється, webhook реєструється заново.
- **PG_PASSWORD:** спершу змініть пароль у Postgres
  (`docker compose … exec postgres psql -U __APP_DB__ -c "ALTER USER __APP_DB__ PASSWORD '<новий>'"`),
  потім оновіть і `PG_PASSWORD`, і `DATABASE_URL` в `/etc/__APP_SLUG__/.env` і запустіть workflow.
- **Змінився ключ хоста сервера:** оновіть `DEPLOY_KNOWN_HOSTS`, інакше ssh відмовить (так задумано).
- **`client_loop: send disconnect: Broken pipe`:** ssh-з'єднання обірвалося (кожен виклик шле
  keepalive кожні 15 с і здається після 2 хв тиші від сервера). Нічого після невдалого кроку не
  виконувалось, стара версія жива; перезапустіть job.

### Адміни

`ADMIN_USER_IDS` — Telegram id через кому. Ці користувачі бачать адмінку в Settings. Порожнє
значення означає, що адмінів немає. Ключ додається до наявного `/etc/__APP_SLUG__/.env` з
`.env.example` під час наступного деплою (дрейф env); щоб змінити значення, відредагуйте його там.

## server-setup.sh (на сервері, при кожному деплої)

- створює `/etc/__APP_SLUG__` (700), `/var/www/__APP_SLUG__`, `/opt/__APP_SLUG__`,
  `/var/backups/__APP_SLUG__` (700);
- створює `/etc/__APP_SLUG__/.env` (600) **лише якщо його немає**, з кореневого `.env.example` з
  production-значеннями й випадковими `PG_PASSWORD`, `WEBHOOK_SECRET`, `WEBHOOK_PATH_TOKEN`;
  `WEBAPP_URL`, `PORT=3000` (порт контейнера) і `DATABASE_URL` записуються літерально. Наявні
  значення ніколи не перегенеровуються. Ключі, додані в `.env.example` пізніше, дописуються при
  наступному запуску: випадкове значення для секретів, інакше значення з прикладу;
- upsert-ить `BOT_TOKEN` з env `BOT_TOKEN` або з першого рядка stdin (формат перевіряється, у
  вивід не потрапляє, запис атомарний). Якщо токен не передано, лишається наявний; перший запуск
  без токена падає;
- nginx: поки сертифіката немає, ставить `nginx/__APP_SLUG__-bootstrap.conf` (лише ACME),
  запускає `certbot certonly --webroot -w /var/www/__APP_SLUG__` (поновлення перезавантажують
  nginx через `--deploy-hook`), потім ставить `nginx/__APP_SLUG__.conf` (HTTPS + редирект
  80→443). Кожне встановлення спершу проганяє `nginx -t`; при збої наш попередній файл
  відновлюється (або наш новий файл і симлінк видаляються), nginx **не** перезавантажується,
  а скрипт завершується з помилкою, тож інші сайти продовжують працювати;
- `/etc/cron.d/__APP_SLUG__-backup`: `backup.sh` щодня о 03:30, лог у `/var/log/__APP_SLUG__-backup.log`.

## Деплой з робочої станції

```bash
DEPLOY_HOST=<хост> DEPLOY_USER=root DEPLOY_KEY=~/.ssh/__APP_SLUG__ [BOT_TOKEN=…] bash deploy/deploy.sh
```

`DEPLOY_KEY` необов'язковий (інакше ssh бере типові ключі). Локально потрібні `pnpm`, `rsync`,
`ssh`; на сервері: Docker з compose, `rsync`, `curl`, nginx і certbot.

## Резервні копії

`backup.sh` знімає дамп БД у `/var/backups/__APP_SLUG__/db-YYYY-MM-DD.sql.gz` і видаляє дампи
старші за 14 днів. Файли доступні лише власнику (`umask 077`, тека 700); дамп пишеться в `.tmp` і
перейменовується лише після успіху.

Відновлення: `cd /opt/__APP_SLUG__/deploy && gunzip -c db-….sql.gz | docker compose --env-file /etc/__APP_SLUG__/.env exec -T postgres psql -U __APP_DB__ __APP_DB__`.

## Перевірки й тести

- `bash deploy/check.sh`: синтаксис shell, `docker compose config` (пропускається без docker CLI),
  суттєве в nginx, compose і workflow, а також що `.env.example` покриває кожну змінну з
  `apps/api/src/config/env.ts`. Запускається й у workflow перед деплоєм.
- `bash deploy/server-setup.test.sh`: проганяє `server-setup.sh` проти тимчасового кореня
  (`TMA_ROOT`) зі стабами nginx/systemctl/certbot.
- `bash deploy/deploy.test.sh`: проганяє `deploy.sh` зі стабами pnpm/rsync/ssh.
