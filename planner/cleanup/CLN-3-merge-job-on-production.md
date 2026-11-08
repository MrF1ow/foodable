---
id: CLN-3
title: Run the duplicate merge job on production
status: done
priority: high
size: XS
type: ops
areas: [foods]
after: []
plan: docs/food-duplicates-plan.md
prs: [209]
---

The job shipped in #177 and only runs by hand. In the production container: `bun run foods:merge-duplicates` (a dry run), review the pairs, then run it again with `--apply`. A revert does not undo merges already applied. If it already ran, close this in any PR.

Ran 2026-11-07: the production dry run found no pairs to merge or skip. The one known pair was already merged on 2026-11-06, so `--apply` was not needed.
