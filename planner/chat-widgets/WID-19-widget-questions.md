---
id: WID-19
title: "Chat widgets: open questions"
status: decide
priority: med
size: XS
type: decision
areas: [mcp]
after: []
plan: null
prs: []
---

A named size allowance for import-meals? A confirm step and servings for Cook? Do the week-plan and grocery widgets write or only read? When should agents call the restock nudge? Extend `list_expiring` or add a tool? Keep `set_widget_display` as it is?

Decided 2026-11-08:

- import-meals gets a named allowance of 80 KB raw and 24 KB gzipped until it is trimmed.
- Cook on the Recipe card asks first, with servings and a "log a serving" switch.
- The week-plan and grocery widgets can write (plan or unplan, tick off), hidden when the host cannot call tools.
- Agents call the restock nudge when asked, or on the restock day when the user starts a chat.
- Use soon extends `list_expiring`; no new tool.
- `set_widget_display` stays as it is.
