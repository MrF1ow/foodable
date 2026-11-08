---
id: STG-13
title: "Per-household last-known values for kill switches"
status: todo
priority: med
size: M
type: feature
areas: [infra]
after: [STG-5, STG-10]
plan: null
prs: []
---

STG-5 keeps one last-known value per kill switch (process memory and `flag_snapshot`), so kill switches must be global today: a per-household rule would serve one household's value to another during an outage and rewrite the snapshot whenever two households alternate. Key the memory and the snapshot by flag and the flag's unit subject (household or user), with a global row for rules that are not per subject. Needs an expand migration on `flag_snapshot` (subject columns, unique per flag and subject), rehearsed with `db:rehearse` (STG-12), then the switch in `src/flag-pins.ts`, then dropping the global-only rule from `docs/staging-plan.md` and the `FLAGS` comment.
