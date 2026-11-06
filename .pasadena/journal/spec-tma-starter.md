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
Хвилі 0–3 закриті, групове рев'ю 1–3 закрито (faa79a3). Наступна хвиля 4: Task 4 (core B: audit, settings, realtime, admin/me API) — вона ж закриває core.acceptance (Satisfies перенесено з Task 3).
GROUP_BASE: (нова група 4–6 починається з HEAD перед хвилею 4)
Перенесено в контекст: Task 4 — clamp limit у users list; Task 13 — pnpm.overrides для tma-* і .dockerignore у шаблоні.
Перевірка хвилі 4: pnpm --filter @dmytro-rudenko/tma-nest-core test (усе зелене, включно з core.acceptance).

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
