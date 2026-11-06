---
branch: spec/tma-starter
spec: docs/sdd/specs/2026-11-06-tma-starter.md
plan: -
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
Shaping A+B завершено: spec docs/sdd/specs/2026-11-06-tma-starter.md (A — пакети, B — шаблон/scaffold.sh/skill), два builder-check закрито.
Чекаємо, поки користувач перегляне spec у PR #1.
Далі: після схвалення — pasadena:leonard (один план на A+B, реліз 0.1.0 останнім кроком).
Не змінювати: без e2e і без прототипу — рішення користувача.

## Timeline

### 2026-11-06
- 19:12 ✎ Shaping: проаналізовано обидва застосунки; плагін живе в окремому репо tma-starter
- 19:12 ✎ codex-mode: explore
- 19:12 ✎ Стек шаблону: повністю як plivka (Postgres, React, grammY, nginx-деплой)
- 19:20 ✎ Рішення: оплата = разові + підписка Stars; механізм = template/ + scaffold.sh; модулі = розсилки, аудит, app_settings, realtime; підхід 1+2 — пакети @dmytro-rudenko/tma-* у публічному npm + шаблон; розбито на частину A (пакети) і B (шаблон+skill)
- 19:44 ✎ Spec частини A написано; builder-check: fixed-версії 0.1.0, правила entitlements при refund/grant, migrate-before-start, createTestApp з фабрикою imports; перший реліз входить в обсяг, ліцензія MIT
- 19:44 ● 2b9cc00 docs(spec): tma-* packages design (part A)
- 20:18 ✎ Spec розширено на частину B: skill-опитування empty|shop, scaffold.sh з плейсхолдерами й маркерами, шаблон на пакетах, без e2e і без прототипу; builder-check B закрито рішеннями білдера; один реліз 0.1.0
