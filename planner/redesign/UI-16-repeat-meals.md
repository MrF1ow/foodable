---
id: UI-16
title: "Again, recents and copy yesterday (`repeat-meals`)"
status: todo
priority: med
size: M
type: feature
areas: [nutrition]
after: [UI-9, UI-10]
plan: null
prs: []
---

A pure `relogMeal` that copies a whole log (all its items) and re-snapshots from the food rows, a recents query, and a copy-yesterday route with an idempotency key. "Same as yesterday? Eggs & toast" copies yesterday's log for that meal as one log.
