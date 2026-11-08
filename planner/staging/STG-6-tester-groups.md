---
id: STG-6
title: "Tester groups, beta opt-in and their audit trail"
status: todo
priority: high
size: M
type: feature
areas: [infra, web]
after: [STG-4]
plan: null
prs: []
---

`internal` set by an operator with a container script (owner first); `beta` joined by members in Settings › "Try new features" (its own flag, `beta-opt-in`). Every change appends to `flag_group_events`. Adding a member clears their pins.
