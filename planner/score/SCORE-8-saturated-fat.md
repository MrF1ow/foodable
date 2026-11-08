---
id: SCORE-8
title: Saturated fat per 100 g, and sugar and saturated-fat levels
status: todo
priority: med
size: S
type: feature
areas: [foods, db]
after: [STG-1]
plan: null
prs: []
---

The Product screen's breakdown shows sugar and saturated fat with a low / moderate / high level. `foods` has `sugar_g` but no saturated fat. Add the column (per 100 g only, the same rule as `catalogNutritionFromOff`) and the level, from Open Food Facts' `nutrient_levels` or our own per-100 g thresholds.
