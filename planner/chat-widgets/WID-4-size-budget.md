---
id: WID-4
title: "Minify at assembly and enforce a size budget"
status: todo
priority: med
size: M
type: improvement
areas: [mcp, tooling]
after: [WID-1]
plan: null
prs: []
---

Whitespace and comment removal during assembly; a test caps each widget at about 60 KB raw and 20 KB gzipped (import-meals per WID-19). The partial-verbatim check in `widgets.test.ts` compares against the minified output.
