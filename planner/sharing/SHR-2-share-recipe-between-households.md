---
id: SHR-2
title: Share a recipe with another household
status: todo
priority: low
size: L
type: feature
areas: [recipes, mcp]
after: [SHR-1]
plan: null
prs: []
---

A portable recipe document at `/s/:token.json`, and an Import recipe action on the receiving deploy that resolves foods by name without overwriting any. The importer fetches only share URLs, with a timeout and a size cap.
