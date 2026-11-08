---
id: SCORE-2
title: Product score with configurable weights
status: todo
priority: med
size: M
type: feature
areas: [foods]
after: [SCORE-1]
plan: null
prs: []
---

Pure `scoreProduct(product, weights)` with presets, a breakdown per part, and missing parts dropped rather than counted as bad. Computed on read.

From the design: four weighted parts (Nutrition, Processing, Additives, Environment; Organic is dropped) and presets Balanced, Health first, Less processed, Planet and Custom. Sugar and saturated fat are information rows with a level, not weighted parts.
