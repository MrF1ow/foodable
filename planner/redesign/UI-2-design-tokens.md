---
id: UI-2
title: "Design tokens that match the FigCraft variables exactly"
status: todo
priority: high
size: M
type: improvement
areas: [web, tooling]
after: []
plan: null
prs: []
---

Commit the FigCraft Theme and Tokens collections as `design/figcraft-variables.json`; a test compares `src/tokens.ts` to it (names, hex, alpha, numbers). Generate `public/app/v2/tokens.css`. `brand.css` and the widgets' tokens stay as they are.
