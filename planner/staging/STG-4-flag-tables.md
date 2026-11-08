---
id: STG-4
title: "Flag tables: pins, snapshot, groups, events, daily counts"
status: todo
priority: high
size: S
type: feature
areas: [db, infra]
after: []
plan: null
prs: []
---

One migration, never behind a flag: `flag_assignments` (sticky pins per user or household, with epoch and expiry), `flag_snapshot` (last-known kill-switch values), `flag_group_members` and the append-only `flag_group_events`, and `flag_eval_daily`. Row level security and `service_role` grants in the same file.
