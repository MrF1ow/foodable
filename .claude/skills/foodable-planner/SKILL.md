---
name: foodable-planner
description: Read, add to, triage, or close Foodable's planned work (the item files under planner/). Use to find what to work on next, to capture a new idea, and in every pull request that works on a planner item, so the item is closed (and a finished project retired) in the same PR and the PR lint check passes.
---

# Foodable planner

Planned work is one Markdown file per item under [planner/](planner/), with YAML frontmatter for the fields. [ROADMAP.md](ROADMAP.md) is the high-level page. The field rules are in [planner/README.md](planner/README.md); the CI rules are in [scripts/conventions/planner.ts](scripts/conventions/planner.ts).

## Read it cheaply

Do not open every file. Run:

- `bun run planner --next` for what to work on: open, unblocked, ranked.
- `bun run planner` for every open item by project, or `bun run planner --project CAL` for one project.

Open an item's file, and its plan, only once you are working on it.

## Close an item in the PR that ships it

Every PR has a `## Planner` section:

| The PR…                  | Body            | After the PR is open, run and push                 |
| ------------------------ | --------------- | -------------------------------------------------- |
| finishes the item        | `Closes CAL-2`  | `bun run planner --close CAL-2 --pr <number>`      |
| is one of several for it | `Part of CAL-2` | `bun run planner --start CAL-2 --pr <number>`      |
| is not planned work      | `None.`         | nothing                                            |

Several items: `Closes CAL-2, CAL-4`, and run the command once per item.

`--close` on a project's last open item also deletes the project folder, retires its key in [planner/retired.yml](planner/retired.yml), and moves its row in [ROADMAP.md](ROADMAP.md) to Shipped. Commit all of that in the same PR; CI requires it.

Then check: `bun run pr:check body.md --pr <number>`.

Never delete an item file by hand or remove a number from `prs`; CI rejects both. To abandon an item, set `status: dropped`. If that leaves a project with nothing open, retire it in the same PR: remove the folder, append the key to `planner/retired.yml` with this PR's number, and move its `ROADMAP.md` row to Shipped.

## Add or change items

- **A new idea that nobody has decided to build** goes in the inbox folder ([planner/inbox/](planner/inbox/)), as a lowercase-with-dashes file name holding only a `title` field and a sentence or two. No ID.
- **Decided work** joins a project. Get its ID from `bun run planner --new CAL`, which also prints the file name to use. Fill in every field, as in [planner/README.md](planner/README.md). Keep the body to a few sentences and link the plan in `docs/`.
- **A new project** is a folder with a project file (like [planner/calendar/\_project.md](planner/calendar/_project.md)) holding `key` (2–5 capitals, the ID prefix, never one listed in `planner/retired.yml`), `name` and `plan`, plus a row in the Projects table of [ROADMAP.md](ROADMAP.md). A test fails if the table and the folders disagree.
- Planning edits (new items, priority, size, `after`) go in any PR with `None.` under `## Planner`.

Run `bun run planner --check` after any edit.

## Rules

- The repo is public. Security details never go in an item; name the private advisory and nothing more.
- Bugs stay GitHub issues, not planner items.
- One line of `title`, a short body. The design lives in the plan file.
