---
id: BAR-3
title: 'Do agents need a "scan straight to the fridge" tool?'
status: done
priority: low
size: XS
type: decision
areas: [mcp]
after: []
plan: null
prs: [208]
---

Agents already have `lookup_barcode`. Decide whether a tool that adds a scanned product straight to the fridge or grocery list is worth it.

Decided 2026-11-08: no new tool. `lookup_barcode` plus `add_fridge_item` covers it.
