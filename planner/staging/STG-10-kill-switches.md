---
id: STG-10
title: "Kill switches for Open Food Facts, recipe links and the restock runner"
status: todo
priority: med
size: S
type: feature
areas: [infra, foods]
after: [STG-3]
plan: null
prs: []
---

`off-lookups` inside `lookupBarcode` and `searchFoodsByName`, `recipe-link-reader` inside `recipeImportFetcher`, `restock-runner` as an `isEnabled` dependency of `runRestockCheck`. Fallback on; never pinned.
