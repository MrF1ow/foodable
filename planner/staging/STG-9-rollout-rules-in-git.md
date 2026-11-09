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

`flags/rollout.yml` holds every flag's default and rules (all serving `true`) and one `internal:` list of account IDs, starting with the owner's, which the apply step expands into each flag's internal rule (`key == "…"`). `bun run flags:apply` runs the `railway flag` CLI from a CI job on main, with a drift check against Railway, so git is the audit trail for who is internal and what is on. Emergency kills go straight to Railway and are recorded afterwards.
