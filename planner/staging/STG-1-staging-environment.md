---
id: STG-1
title: Staging environment on Railway
status: todo
priority: high
size: M
type: ops
areas: [infra]
after: []
plan: null
prs: []
---

Duplicate the production environment: its own Postgres, volume and domain, tracking `main` with auto-deploy after CI. Different `DATABASE_URL`, `PUBLIC_ORIGIN` and session secret. Migrations are never behind a flag, so this lands before the first redesign item with a migration (UI-18, UI-21, SCORE-8 and others list it in `after`). Staging has its own tester accounts and groups.
