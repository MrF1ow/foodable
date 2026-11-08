---
name: foodable-migration
description: Add or change files under db/migrations/ using Foodable's phased migration workflow.
---

# Foodable database migration

Use for any change under `db/migrations/`.

Read the **Migrations** section in [CLAUDE.md](CLAUDE.md) and follow expand, backfill, switch, contract there — do not duplicate those rules in the PR or in chat.

Before you open a pull request, run `bun run db:dryrun`.

Before the pull request merges, also run `bun run db:rehearse`: it dry-runs the pending migrations on a copy of production's data and deletes the copy afterwards ("Rehearsing migrations on a production copy" in [docs/self-hosting.md](docs/self-hosting.md)). Put the outcome in the PR's `## Migrations` section as counts and pass or fail only, never rows: the repository is public.

Destructive statements need a `-- foodable:contract <reason>` comment on the same migration file; see CLAUDE.md for what counts as destructive and when the marker is required.
