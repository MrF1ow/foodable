---
id: UI-27
title: "Retire the old app"
status: todo
priority: low
size: L
type: contract
areas: [web]
after: [UI-9, UI-10, UI-11, UI-12, UI-13, UI-14, UI-15]
plan: null
prs: []
---

Once every page flag has reached everyone and been removed: delete the old shell and pages, the marketing layer, card arranging (then drop `nutrition_layout`), the embedded widgets (`/app/widgets/:key`, `embed.css`, the skin) and the old-body compatibility layer.
