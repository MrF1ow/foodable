---
id: PG-4
title: v2.1 Actor context
status: todo
priority: low
size: M
type: improvement
areas: [db]
after: []
plan: null
prs: []
---

An `AsyncLocalStorage<Actor>` set by the site middleware, `handleMcp` and the household-token path, which `run()` turns into the row level security settings. Background work uses an allowlisted `runAsSystem()`.
