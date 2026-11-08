---
id: UI-18
title: 'Restock schedules and "add when it runs low" (`usual-schedules`)'
status: todo
priority: med
size: L
type: feature
areas: [grocery, db]
after: [UI-12, STG-1, UI-29]
plan: null
prs: []
---

Migration first: schedule, paused, when-low, low level and `last_restocked_on` on the plain food. Then a pure `usualsDue`, the runner switch (household flag) and the Usuals UI. Saving a usual elsewhere keeps its schedule.
