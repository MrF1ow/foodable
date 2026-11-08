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

Move the in-memory rate limits (`src/rate-limit.ts`), the OAuth login sessions (the `sessions` map in `src/oauth.ts`, 10-minute TTL), and any other per-process state that must agree across instances into Postgres or `Bun.redis`. Moving the login sessions also stops a redeploy from dropping a sign-in in progress.
