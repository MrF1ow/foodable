---
id: PG-10
title: Query-plan tests for the household pages
status: todo
priority: med
size: S
type: improvement
areas: [db]
after: []
plan: null
prs: []
---

`src/db/indexes.test.ts` checks the plans of the nutrition and stock-ledger reads. Extend it to the fridge list, the grocery list, recipes and the food search, so a query that loses its index fails CI. PG-8 adds its new `household_id` indexes to the same test.
