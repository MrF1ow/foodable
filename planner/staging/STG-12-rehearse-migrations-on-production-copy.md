---
id: STG-12
title: Rehearse migrations on a production copy
status: todo
priority: high
size: S
type: feature
areas: [db, tooling]
after: []
plan: null
prs: []
---

Stands in for staging until STG-1: every migration runs against real data before it reaches production. A script plus a short runbook in `docs/self-hosting.md`: take a data-only dump of production through the production container (`railway ssh -p 5c73bffd-c005-4e7f-8c92-57db06aed483 -s foodable -e production -i ~/.ssh/id_github_personal -- …`; production Postgres is internal-only, so `railway run` from a laptop cannot reach it), write it outside the repo, and run `bun run db:dryrun --data <file> --pending-from <first pending version>`. The dump is the household's real data: never commit it, and delete it afterwards.
