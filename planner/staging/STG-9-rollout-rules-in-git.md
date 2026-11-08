---
id: STG-9
title: "Rollout rules in git, applied from CI"
status: todo
priority: med
size: M
type: feature
areas: [infra, tooling]
after: [STG-3]
plan: null
prs: []
---

`flags/rollout.yml` holds every flag's default and rules (all serving `true`); `bun run flags:apply` runs the `railway flag` CLI from a CI job on main, with a drift check against Railway. A new workflow file is a gate file. Emergency kills go straight to Railway and are recorded afterwards.
