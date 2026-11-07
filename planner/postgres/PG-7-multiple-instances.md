---
id: PG-7
title: v2.4 Safe to run more than one instance
status: todo
priority: low
size: M
type: improvement
areas: [infra]
after: []
plan: null
prs: []
---

Move the in-memory rate limits and any per-process caches that must agree into Postgres or `Bun.redis`.
