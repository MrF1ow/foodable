---
id: WID-1
title: "Remove the widget i18n scaffolding"
status: todo
priority: med
size: M
type: improvement
areas: [mcp]
after: []
plan: null
prs: []
---

Drop the `/*@i18n@*/` marker, `i18n.js`, `pickLocale` / `setLocale` and the all-namespace `WIDGET_STRINGS` inlined into every widget; each template keeps its own English strings. `locale` stays in the output for one release (WID-18).
