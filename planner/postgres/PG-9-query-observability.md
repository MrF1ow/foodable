---
id: PG-9
title: See slow queries in production
status: todo
priority: med
size: S
type: ops
areas: [db, infra]
after: []
plan: null
prs: []
---

Turn on `pg_stat_statements` and `log_min_duration_statement` (about 200 ms) on the production Postgres, and add a short "finding slow queries" section to `docs/self-hosting.md`. Performance work, including any cache, starts from what these show rather than from guesses.
