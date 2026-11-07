---
id: GEN-7
title: "Look up barcodes once per `search_food` call, not once per result"
status: todo
priority: low
size: XS
type: improvement
areas: [foods, mcp]
after: []
plan: null
prs: []
---

`searchFoodCatalog` calls `listBarcodes` for each household hit (and `getBarcodeFoodId` / `getFood` for each Open Food Facts hit), so a broad query like "eggs" issues one query per result. Load the barcodes for all hit ids in one query. Noted in the QA review of #164.
