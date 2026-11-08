---
name: foodable-pr
description: Open or update a Foodable pull request with CI checks, conventional title, and required body sections.
---

# Foodable pull request

Use when opening or updating a pull request.

## Checks

Run, in order:

1. `bun run gen:all`
2. `bun run format:check`
3. `bun run typecheck`
4. `bun test`
5. `bun run pr:check`

## Title and body

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for the PR title `<type>(<scope>)[!]: <subject>` and the required sections: **Summary**, **Blast radius** (with **Level** and **Rollback**), **Changes**, **Migrations**, **Contracts**, **Testing**, and **Links**.

Path floors, branch naming, and title parsing are defined in [scripts/conventions/](scripts/conventions/).

Create or update the pull request with `gh pr create` or `gh pr edit` once checks pass and the body is complete.
