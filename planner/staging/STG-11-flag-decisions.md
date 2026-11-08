---
id: STG-11
title: "Pin lifetime, the self-hoster override, and who can join beta"
status: decide
priority: high
size: XS
type: decision
areas: [infra]
after: []
plan: null
prs: []
---

How long a pin holds (proposed 12 h); whether `FOODABLE_FLAGS` (read only without `RAILWAY_TOKEN`) lets a self-hosting owner turn features on for a group or everyone; whether every member or only owners and admins can join beta; soak time before a flag is removed.

Decided 2026-11-08: pins hold 12 hours (plus the epoch for instant rollback); `FOODABLE_FLAGS` is accepted, read only without `RAILWAY_TOKEN`, with group syntax (`ui-v2:internal`); any member can join beta, for themselves only; a flag is removed from the code after one release at "everyone" with no rollback; the internal list lives in Railway (through `flags/rollout.yml`), not in our database.
