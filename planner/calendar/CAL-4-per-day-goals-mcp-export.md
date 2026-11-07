---
id: CAL-4
title: Per-day goals in MCP and the export
status: todo
priority: med
size: M
type: feature
areas: [nutrition, mcp]
after: [CAL-2]
plan: null
prs: []
---

The goals tool takes an optional `date` (or `from`/`to`) to set or clear a day's override, and `export_all_data` includes the overrides, header-only when empty. Update `src/mcp/tools-list.snapshot.json` and `TOOLS` in the same PR.
