# Planner

Every piece of planned work is one Markdown file here. [ROADMAP.md](../ROADMAP.md) is the high-level picture; this folder holds what is still open, and CI keeps it honest.

```
planner/
  <project>/_project.md          the project: key (the ID prefix), name, plan
  <project>/<ID>-<slug>.md       one item, for example calendar/CAL-2-goals-for-date-resolver.md
  inbox/<slug>.md                an idea nobody has decided to build yet
  retired.yml                    finished projects, so their keys are never reused
```

A project folder exists only while it has open work. The pull request that finishes its last item deletes the folder, retires the key in `retired.yml`, and moves the project to Shipped in `ROADMAP.md`. Its history stays in git and in the PRs.

## Reading it

`bun run planner` prints every open item, grouped by project. Other forms:

- `bun run planner --next`: what to work on next. Open items whose `after` items are all finished, ranked by priority, then items already in progress, then size.
- `bun run planner --project CAL`: one project.
- `bun run planner --all`: include done and dropped items.
- `bun run planner --check`: validate every file.

## An item

```md
---
id: CAL-2
title: "`goalsForDate` resolver, and every goal reader using it"
status: todo
priority: high
size: L
type: feature
areas: [nutrition, mcp]
after: [CAL-1]
plan: null
prs: []
---

What it is and why, in a few sentences. The full design lives in the plan file.
```

| Field      | Values                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `id`       | The project's key and the next free number: `bun run planner --new CAL`. Never reused; the file name starts with it.                 |
| `status`   | `todo`, `decide` (a question to answer, not code), `doing`, `done`, `dropped`                                                        |
| `priority` | `urgent` (now), `high` (this cycle), `med` (next), `low` (later), `none` (optional, may never happen)                                |
| `size`     | `XS` under an hour, `S` one small PR, `M` one PR of a day or two, `L` a few PRs, `XL` a stack                                        |
| `type`     | `feature`, `improvement`, `fix`, `chore`, `contract` (a migration that drops something), `ops` (run by hand), `security`, `decision` |
| `areas`    | One or two of `nutrition`, `foods`, `fridge`, `grocery`, `recipes`, `household`, `web`, `mcp`, `db`, `infra`, `tooling`              |
| `after`    | Item IDs that must be finished first. An ID from a retired project counts as finished.                                               |
| `plan`     | A repo path to the design, or `null` to use the project's plan                                                                       |
| `prs`      | Pull request numbers that worked on the item. A `done` item has at least one.                                                        |

Keep the body short. Detail belongs in `docs/*-plan.md`.

## How an item closes

The pull request that does the work also updates the item, so the planner is always as current as `main`.

1. Open the PR with a `## Planner` section saying one of:
    - `Closes CAL-2`: this PR finishes it.
    - `Part of CAL-2`: one PR of several.
    - `None.`: the PR is not planned work.
2. Once the PR has a number, run one command and push the result:
    - `bun run planner --close CAL-2 --pr <number>` sets `status: done` and adds the number to `prs`. When that was the project's last open item, it also deletes the project folder, appends the key to `retired.yml` with this PR's number, and moves the project's `ROADMAP.md` row to Shipped.
    - `bun run planner --start CAL-2 --pr <number>` sets `status: doing` and adds the number to `prs`.
3. Keep the item files in step with the PR yourself.

Planning edits (new items, priorities, sizes, order) need no declaration: say `None.` and change the files. Dropping the last open item of a project also finishes it, so retire the project in the same PR. Bugs stay GitHub issues.

The rules live in `scripts/conventions/planner.ts` and are covered by `planner.test.ts`. No PR check runs them since #228 removed the planner check from `pr:check`, so keep `planner/` in step yourself.

## The inbox

A new idea goes in `inbox/` as a file with only a `title` and a sentence or two. It gets an ID only when someone decides to build it: move it into a project folder, rename it `<ID>-<slug>.md`, and fill in the fields.
