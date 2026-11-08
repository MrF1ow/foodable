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

Members join or leave beta themselves in Settings › "Try new features" (its own flag, `beta-opt-in`). Every change appends to `flag_beta_events`; joining clears that member's pins so it applies at once. The internal list is not here: it is a Railway rule (STG-9).
