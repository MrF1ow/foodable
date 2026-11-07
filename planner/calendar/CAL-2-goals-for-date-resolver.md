---
id: CAL-2
title: "`goalsForDate` resolver, and every goal reader using it"
status: todo
priority: high
size: L
type: feature
areas: [nutrition, mcp]
after: [CAL-1]
plan: null
prs: []
---

A pure `goalsForDate(defaults, overrides, date)` in `src/domain/` with memory-store tests. Every reader that compares a day against goals goes through it: `get_goal_progress`, the meal-progress strip, `get_nutrition_summary`, `get_trends`, the dashboard, insights and the weekly digest. A range read resolves each day on its own.
