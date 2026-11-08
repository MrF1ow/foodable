---
id: STG-8
title: "`gatedRoute`, `gatedTool` and the flag-off tests"
status: done
priority: high
size: M
type: feature
areas: [web, mcp]
after: [STG-3]
plan: null
prs: [221]
---

Flags on `AppChromeBase` (built in `viewerChromeWithAttention`) and on `ToolContext` (loaded in `buildMcpServer`). Tests: every gated route answers a redirect or 404 with its flag off; the flag-off tool list is the snapshot minus the gated tools; a gated tool called while off is an unknown tool.
