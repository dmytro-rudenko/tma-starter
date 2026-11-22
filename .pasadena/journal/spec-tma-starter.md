---
branch: spec/tma-starter
spec: docs/sdd/specs/2026-11-06-tma-starter.md
plan: docs/sdd/plans/2026-11-06-tma-starter.md
codex-mode: explore
status: in-progress
started: 2026-11-06
---

## Goal
Плагін для Claude Code зі skill-ом, що розгортає стартовий шаблон Telegram Mini App
(керування користувачами, адмінські права, оплата Telegram Stars), зібраний з
перевірених фрагментів plivka та retro-game-bot. Готово, коли skill генерує проєкт,
який проходить свої тести й стартує локально.

## Now
Хвилі 0–8 закриті (8ac81d5): smoke OK: empty, pack-check OK. PR #1 змержено передчасно; продовження йде новим PR із тієї ж гілки. Хвиля 9: Task 15 (shop) — `bash skills/new/scaffold.test.sh` і `bash scripts/smoke-template.sh shop`.
Postgres 16 для тестів: Docker-контейнер tma-test-pg-docker на 127.0.0.1:54329 (на хості лише PG 13, `pnpm db:start` не працює).

## Timeline

### 2026-11-06
- 19:12 ✎ Shaping: проаналізовано обидва застосунки; плагін живе в окремому репо tma-starter
- 19:12 ✎ codex-mode: explore
- 19:12 ✎ Стек шаблону: повністю як plivka (Postgres, React, grammY, nginx-деплой)
- 19:20 ✎ Рішення: оплата = разові + підписка Stars; механізм = template/ + scaffold.sh; модулі = розсилки, аудит, app_settings, realtime; підхід 1+2 — пакети @dmytro-rudenko/tma-* у публічному npm + шаблон; розбито на частину A (пакети) і B (шаблон+skill)
- 19:44 ✎ Spec частини A написано; builder-check: fixed-версії 0.1.0, правила entitlements при refund/grant, migrate-before-start, createTestApp з фабрикою imports; перший реліз входить в обсяг, ліцензія MIT
- 19:44 ● 2b9cc00 docs(spec): tma-* packages design (part A)
- 20:18 ✎ Spec розширено на частину B: skill-опитування empty|shop, scaffold.sh з плейсхолдерами й маркерами, шаблон на пакетах, без e2e і без прототипу; builder-check B закрито рішеннями білдера; один реліз 0.1.0
- 20:18 ● e4d6bca docs(spec): extend design with part B (template, scaffold, skill)
- 20:32 ✎ План схвалено: 18 задач у 11 хвилях; паралельно йдуть testing/scaffold/SKILL, core/web/deploy, bot-broadcast/payments, template api/web/CI
- 20:32 ● fc09e4b docs(plan): tma-starter implementation plan
- 20:55 ● 0e48580 test: acceptance tests for tma-* packages and scaffold
- 20:55 ● b4fa31d docs(plan): tick wave 0
- 20:55 ✎ Хвиля 0: acceptance-тести написано й переглянуто; додано тести на Review Focus 1–4
- 20:55 ● 454cc5a chore(journal): wave 0 closed
- 20:59 ● 1232bed chore: pnpm monorepo skeleton for tma-* packages
- 20:59 ● 59add99 docs(plan): tick wave 1
- 21:07 ● 99c1f59 feat(testing): tma-testing helpers for Telegram apps
- 21:07 ● 27c0b1f feat(skill): scaffold.sh and template smoke script
- 21:07 ● 90c1a70 feat(skill): /tma-starter:new skill instructions
- 21:07 ● c9c2d87 docs(plan): tick wave 2
- 21:07 ✎ Хвиля 2: tma-testing зелений (36 тестів), scaffold.sh і SKILL.md готові
- 21:07 ● 0f552d0 chore(journal): wave 2 closed
- 21:23 ● df3448d feat(nest-core): auth, users, admin rights, health and core migration
- 21:23 ● 9a63fa4 feat(web): tma-web Telegram facade, theme, i18n, api client and React hooks
- 21:23 ● c8a7919 feat(template): deploy scripts, workflow, docs and agent rules
- 21:34 ● 3517a8f fix(testing): build template database atomically
- 21:34 ● 7edd55f fix(nest-core): guard bare /api and reject future auth_date
- 21:34 ● 305d856 fix(web): settle refresh after pending fallback, require socket.io-client
- 21:34 ● fb12342 fix(skill): safer argument handling in scaffold.sh
- 21:34 ● f6a54b5 fix(skill): products temp file via mktemp in one Bash call
- 21:34 ● faa79a3 fix(template): deploy tests independent of the project slug
- 21:34 ● a556b13 docs(plan): tick wave 3
- 21:35 ✎ Хвиля 3 і групове рев'ю 1–3: core A, web, deploy-шаблон; виправлено guard /api, future auth_date, atomic template DB, pending fallback, scaffold args
- 21:35 ● 278e3c5 chore(journal): wave 3 and group 1-3 review closed
- 21:45 ✎ Хвиля 4: nest-core повністю зелений, core.acceptance пройдено
- 21:45 ● a403d2b feat(nest-core): audit, app settings, realtime and admin/me API
- 21:45 ● 59601fd docs(plan): tick wave 4
- 21:45 ● 75b6fb7 chore(journal): wave 4 closed
- 21:54 ● 0780812 test(nest-bot): type error replies in bot acceptance as ok: false
- 21:54 ● 22037ab feat(nest-bot): webhook, middleware, commands, i18n and notifications
- 21:54 ● e290b5a docs(plan): tick wave 5
- 22:05 ● 2d49198 feat(nest-bot): durable broadcasts and tma-bot setup
- 22:05 ● a8f043b feat(nest-payments): Stars products, invoices and entitlements
- 22:05 ● 24561c8 fix(testing): waitFor resolves NonNullable<T>
- 22:05 ● cafd260 fix(web): add BROADCAST_NOT_FOUND to TMA_ERROR_CODES
- 22:25 ✎ Хвиля 6 і групове рев'ю 4–6: розсилки на lease, settled_at для onRefund, backoff refund-retry
- 22:25 ● 0689dc4 fix(testing): fingerprint migration bodies in template DB name
- 22:25 ● 7cb3fd3 fix(nest-bot): lease-based broadcast worker and input limits
- 22:25 ● 4b042e8 fix(nest-payments): refund hooks only for accepted payments, retry backoff
- 22:25 ● 80c6ee5 docs(plan): tick wave 6
- 22:25 ● 5ba6476 chore(journal): wave 6 and group 4-6 review closed
- 22:35 ● f59f5aa feat(nest-payments): refunds, subscription cancel, admin API and reconcile
- 22:35 ● 8a5cc63 docs(plan): tick wave 7
- 22:35 ✎ Хвиля 7: nest-payments B, усі пакети та їхні acceptance зелені
- 22:35 ● 9afaa01 chore(journal): wave 7 closed

### 2026-11-07
- 08:56 ⏸ pause · exit · HEAD=9afaa01 · dirty: scripts/error-codes.test.mjs,scripts/sync-plugin-version.test.mjs,template/.dockerignore

### 2026-11-22
- 11:45 ✎ Відновлено після передчасного merge PR #1; гілку fast-forward до main d06397e
- 11:45 ● 66c444a feat(template): workspace root and apps/api on tma-* packages
- 11:45 ● 564e72f feat(template): apps/web base screens and admin sheets
- 11:45 ● 8ac81d5 ci: plugin manifest, CI and release workflows, pack-check
- 11:45 ✎ Хвиля 8: smoke empty зелений, pack-check OK, error-codes 5/5. Ruling: template/.dockerignore → Task 13, scripts/sync-plugin-version.test.mjs → Task 16 — не були в Writes — ціна помилки нульова. mutator: skipped (код хвилі вже існував; тести перевірені ручними мутаціями агентів)
