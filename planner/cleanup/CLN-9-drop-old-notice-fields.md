---
id: CLN-9
title: "Drop the old `gaps`, `incompleteReasons` and grocery `warning` fields"
status: todo
priority: low
size: S
type: chore
areas: [mcp, recipes]
after: []
plan: docs/notices-plan.md
prs: []
---

#185 put `notices` on `get_recipe`, `list_grocery_lines`, `get_fridge` and `get_food`, and kept `macros_per_portion.gaps`, `incompleteReasons` and the grocery `warning` string for one release, filled from the same notices. Once agents read `notices`, remove the old fields from the output schemas and the web page code, and update the tool tests. Plan: "Surfaces › MCP".
