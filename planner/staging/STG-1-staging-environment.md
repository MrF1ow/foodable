---
id: STG-1
title: Staging environment on Railway
status: todo
priority: low
size: M
type: ops
areas: [infra]
after: []
plan: null
prs: []
---

Duplicate the production environment: its own Postgres, volume and domain, tracking `main` with auto-deploy after CI. Different `DATABASE_URL`, `PUBLIC_ORIGIN` and session secret.
