---
id: STG-3
title: "Flag adapter, context and in-memory version (`src/flags.ts`)"
status: done
priority: high
size: M
type: feature
areas: [infra, mcp]
after: []
plan: null
prs: [215]
---

`src/flags.ts`, the only file that imports the Railway SDK: a typed registry (kind, unit, parent, fallback, why), the context built from `AuthContext` / `HouseholdMember` / `VERSION`, `initFlags()` with a timeout that never blocks boot, and an in-memory version for tests. No `RAILWAY_TOKEN` means fallbacks: temporary flags off, kill switches on. Documents `RAILWAY_TOKEN` in `.env.example` and `docs/self-hosting.md`. Check the SDK release before pinning it (3.16.0 on 2026-11-07).
