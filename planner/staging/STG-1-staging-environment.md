---
id: STG-1
title: Staging environment on Railway
status: todo
priority: low
size: M
type: ops
areas: [infra]
after: [UI-27]
plan: null
prs: []
---

Duplicate the production environment: its own Postgres, volume and domain, tracking `main` with auto-deploy after CI. Different `DATABASE_URL`, `PUBLIC_ORIGIN` and session secret. Staging has its own tester accounts and groups.

A follow-up to the redesign, deferred for cost (decided 2026-11-08): no paid Railway staging environment until the redesign is finished. Until then, migrations are rehearsed on a copy of production data (STG-12), and flags go local first, then to the owner's account in production.
