---
name: foodable-pr
description: Open or update a Foodable pull request with CI checks, conventional title, and required body sections.
---

# Foodable pull request

Use when opening or updating a pull request.

## Checks

Run, in order:

1. `bun run gen:all`
2. `bun run check:changed` (format, lint, typecheck and the tests CI's `check` job runs for your changes; `--all` runs everything)
3. `bun run pr:check body.md` (title, branch, body sections, blast floor)

## Title and body

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for the PR title `<type>(<scope>)[!]: <subject>` and the required sections: **Summary**, **Blast radius** (with **Level** and **Rollback**), **Changes**, **Migrations**, **Contracts**, **Testing**, and **Links**.

## Merging

The required checks are `check`, `docker`, `migrations`, `dependency-review` and `policy` (main's copy of the conventions, migration safety, skill drift and the agent context budget). When they are green and review threads are resolved, the PR merges with no review or label.

Path floors, branch naming, and title parsing are defined in [scripts/conventions/](scripts/conventions/).

Create or update the pull request with `gh pr create` or `gh pr edit` once checks pass and the body is complete.
