---
id: STG-7
title: "Flag evaluation counts and warnings"
status: todo
priority: med
size: S
type: feature
areas: [infra]
after: [STG-3, STG-4]
plan: null
prs: []
---

Count evaluations in memory per flag, value, reason and client; write once a minute (a log line and `flag_eval_daily`), never a row per read. Warn on `STALE`, `CONFLICT` and `NOT_FOUND`.
