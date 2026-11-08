---
id: WID-2
title: "The app owns its base CSS"
status: todo
priority: med
size: S
type: improvement
areas: [web]
after: []
plan: null
prs: []
---

A pure move: copy `base`, `form`, `table` and `seg` into `public/app/` and point `app.css` at them, so widget restyling never changes the app.
