---
id: STG-2
title: How production deploys after staging
status: decide
priority: high
size: XS
type: decision
areas: [infra]
after: [STG-1]
plan: null
prs: []
---

Either deploy a chosen commit by hand, or track a `production` branch fast-forwarded to the release tag. The plan leans towards the branch: it is easier to audit.

Decided 2026-11-08: production tracks a `production` branch, fast-forwarded to each release tag from `bun run release`.
