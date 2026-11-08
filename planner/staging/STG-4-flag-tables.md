---
id: STG-4
title: "Flag tables: pins, snapshot, beta members, daily counts"
status: done
priority: high
size: S
type: feature
areas: [db, infra]
after: []
plan: null
prs: [213]
---

One migration, never behind a flag: `flag_assignments` (sticky pins per user or household, with epoch and expiry), `flag_snapshot` (last-known kill-switch values), `flag_beta_members` with an append-only `flag_beta_events`, and `flag_eval_daily`. Row level security and `service_role` grants in the same file. The internal list is not stored here: it lives in Railway (STG-9).
