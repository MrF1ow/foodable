---
id: CAL-1
title: Per-day goals table
status: done
priority: high
size: S
type: feature
areas: [nutrition, db]
after: []
plan: null
prs: [196]
---

A `nutrition_goal_days` table (`household_id`, `user_id`, `date`, the same `daily_*` columns, null meaning "use the default"), with row level security and `service_role` grants in the same migration. No backfill: the existing `nutrition_goals` row stays the default.
