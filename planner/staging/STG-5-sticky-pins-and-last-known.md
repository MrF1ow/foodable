---
id: STG-5
title: "Sticky pins and last-known values"
status: done
priority: high
size: M
type: feature
areas: [infra]
after: [STG-3, STG-4]
plan: null
prs: [224]
---

Pin every temporary flag per subject when it is evaluated from a fresh registry; serve pins until they expire or the epoch changes; cache them with `createTtlCache`. The SDK answers every read with its fallback after one failed refresh, so this layer is what keeps a member on the same UI when Railway is unreachable. Kill switches: last value in memory, then `flag_snapshot`, then the fallback.
