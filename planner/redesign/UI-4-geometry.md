---
id: UI-4
title: "Gauge, ring and bar geometry as one pure module"
status: done
priority: high
size: S
type: feature
areas: [web]
after: []
plan: null
prs: [214]
---

Arc paths, ring segments and bar fills in `src/domain/`, unit-tested (zero, full, over, missing goal). The app renders it on the server; the chat widgets bring it in with `@inlinets` (WID-3).
