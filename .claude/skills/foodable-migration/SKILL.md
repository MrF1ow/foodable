---
name: foodable-migration
description: Add or change files under supabase/migrations/ using Foodable's phased migration workflow.
---

# Foodable database migration

Use for any change under `supabase/migrations/`.

Read the **Migrations** section in [CLAUDE.md](CLAUDE.md) and follow expand, backfill, switch, contract there — do not duplicate those rules in the PR or in chat.

Before you open a pull request, run `bun run db:dryrun`.

Destructive statements need a `-- foodable:contract <reason>` comment on the same migration file; see CLAUDE.md for what counts as destructive and when the marker is required.
