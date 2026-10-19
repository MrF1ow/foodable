# Contributing to Foodable

Thanks for taking a look. Foodable is a personal project: one household runs it on its own deploy, and the code is open so others can self-host it or borrow from it. That shapes what fits here, so please read the first section before you write code.

## What fits

- **Welcome:** bug fixes, self-hosting fixes (Docker, reverse proxies, other hosts), MCP client compatibility, tests, docs, and small improvements to the existing pillars (fridge, groceries, nutrition, recipes, settings).
- **Ask first:** new tools, new pages, schema changes, and new dependencies. Open an issue describing the problem before writing the code. A short "would you take this?" saves both of us a rejected PR.
- **Out of scope:** multi-tenant or hosted-service features, a public marketing site, translations and locale switchers (the app is English only), analytics or tracking beyond the existing `tool_analytics` table, and theming beyond the one accent.

## Getting set up

You need [Bun](https://bun.sh) (CI uses the version pinned in `.github/workflows/ci.yml`) and a Supabase project, either cloud or local via the Supabase CLI.

```bash
git clone https://github.com/MrF1ow/foodable.git
cd foodable
bun install
cp .env.example .env          # fill in Supabase and OAuth values
bun run generate-oauth-creds  # prints OAuth and session secrets for .env
supabase db push              # after `supabase link`
bun run dev                   # http://localhost:8080
```

On Windows, enable symlink support so shared agent docs materialize after a later change adds them:

```bash
git config core.symlinks true
```

Then re-clone or refresh the worktree. The repo will link [AGENTS.md](AGENTS.md) and the skill stubs under [.agents/skills](.agents/skills); without symlinks those paths stay empty files.

[`docs/self-hosting.md`](docs/self-hosting.md) covers environment variables, the first-user flow, and connecting an MCP client. `bun run inspect` opens the MCP Inspector, and `bun run harness` previews the in-chat widgets without a real client.

## Before you open a PR

Run what CI runs. A PR that fails any of these can't merge:

```bash
bun run gen:all        # regenerate login HTML and tokens
bun run format:check   # Prettier, 4-space indent (`bun run format` fixes it)
bun run typecheck      # src/ only
bun test
```

If you touched `supabase/migrations/`, also run `bun run db:dryrun` (see below).

## How the code is laid out

[`CLAUDE.md`](CLAUDE.md) is the detailed map of the codebase and its invariants. It's written for AI coding agents but works just as well for people. The short version:

- `src/domain/` holds pure logic with in-memory stores and tests. New behaviour goes here first.
- `src/db/` has one thin Supabase adapter per domain.
- `src/mcp/` is the agent surface: one `registerXTools` module per domain under `src/mcp/tools/`.
- `src/web/` is the household web app (Hono routes, server-rendered pages, plain browser JS).
- `public/widgets/src/` holds the in-chat widget sources, assembled at startup.

The rules that come up most in review:

- **Pure functions, thin adapters.** MCP tools and web routes only parse input, call a domain function, and format the result. Put the logic in `src/domain/` with a test next to it.
- **Small PRs.** One change per PR. Moving files and changing behaviour go in separate PRs.
- **Changing MCP tools.** Adding, renaming or removing a tool means updating `src/mcp/tools-list.snapshot.json` and `TOOLS` in `src/copy/tools.ts` in the same PR, or `src/mcp.test.ts` fails. Tools that render a widget must return `structuredContent` on every path.
- **Generated files are not hand-edited.** `public/login.html`, `public/widgets/src/shared/tokens.css`, `public/app/brand.css` and the brand icons each come from a script. Edit the source and regenerate.
- **The UI uses shared components.** Pages build their chrome from `src/web/components/ui.ts`. Don't hand-write panels, modals or banners.

## Database migrations

Migrations are the part most likely to hurt a running household, so they get the most scrutiny.

- Schema lives only in `supabase/migrations/`. Name files `YYYYMMDDHHMMSS_short_description.sql`, timestamped after the newest existing one.
- **Never edit a migration that has been merged.** Once a migration is on `main`, deploys treat it as applied. Write a new file instead.
- **Expand, backfill, switch, contract.** Add new columns or tables first, backfill them, move the code over, and only drop the old shape in a later migration. One migration never both destroys data and backfills.
- **Destructive statements** (`DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, column type changes, renames) need a SQL comment on the same migration: `-- foodable:contract <reason>` with a non-empty reason. `DROP POLICY`, `DROP FUNCTION`, and `DROP TRIGGER` do not need the marker. The PR **Contracts** section must explain why the change is safe.
- **Every new table** gets `household_id` and row-level security, with the same policy shape as the existing tables.
- Run `bun run db:dryrun` before opening the PR. It applies the pending migrations to a throwaway local Postgres, checks the backfill, and checks that a re-run is a no-op. Set `PG_BIN` if `initdb` isn't on your `PATH`.

## Branches and commit titles

Branch from `main` and open the PR against `main`. PRs are squash-merged, so the PR title becomes the commit message on `main`.

**Branch name:** `<type>/<scope>-<slug>` — for example `feat/fridge-show-expiry`. The slug is lowercase words separated by hyphens.

**Exceptions** (no `<scope>-<slug>` rule): `dependabot/`, `revert-`, `usability/`, `spike/`, `cursor/`.

**PR title:** `<type>(<scope>)[!]: <subject>`

- **type** — one of:
    - `feat`
    - `fix`
    - `refactor`
    - `perf`
    - `docs`
    - `test`
    - `ci`
    - `build`
    - `chore`
    - `revert`
- **scope** — one of:
    - `nutrition`
    - `fridge`
    - `grocery`
    - `recipes`
    - `settings`
    - `foods`
    - `household`
    - `mcp`
    - `widgets`
    - `web`
    - `auth`
    - `db`
    - `import`
    - `export`
    - `brand`
    - `deps`
    - `repo`
- **!** — optional; marks a breaking MCP or API contract change.
- **subject** — imperative, lower case, no trailing period. The full title must be at most 72 characters.

Example: `fix(fridge): ignore expired lines in grocery sync`.

## Blast radius

Every PR declares how risky the change is. In the **Blast radius** section, set **Level** to `low`, `medium`, or `high`. That level must be at least the **floor** from the files you touch; declaring lower than the floor fails CI.

The floor comes from path rules (see `scripts/conventions/`). In short:

| Floor      | Examples                                                                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **high**   | `supabase/migrations/`, `.github/workflows/`, `.github/rulesets/`, `.github/CODEOWNERS`, `scripts/conventions/`, `scripts/migration-safety/`, `scripts/migration-dryrun/`, `package.json` |
| **medium** | Each product area (`fridge`, `grocery`, `nutrition`, …) spans `src/domain/`, `src/mcp/tools/`, and `src/web/` for that pillar; `bun.lock` counts as `deps`                                |
| **low**    | Docs, copy, and other paths not mapped to a pillar                                                                                                                                        |

If a PR touches two different **medium** areas (for example fridge and grocery), the floor becomes **high** even when no single path is in the high table.

Also set **Rollback** to `revert-safe`, `needs a follow-up migration`, or `needs a data fix`.

## Pull request template

Use the template GitHub fills in. Required sections:

| Section          | Notes                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Summary**      | What changed and why                                                                                                                            |
| **Blast radius** | **Level** and **Rollback** (plus **Affects** / **What could break** when helpful)                                                               |
| **Changes**      | Bullet list                                                                                                                                     |
| **Migrations**   | Describe migration work, or `None.` Must **not** be `None` when any file under `supabase/migrations/` changes                                   |
| **Contracts**    | Breaking changes, snapshot updates, or `None.` Must **not** be `None` when the title contains `!` or `src/mcp/tools-list.snapshot.json` changes |
| **Testing**      | Commands run and anything checked by hand                                                                                                       |
| **Links**        | `Closes #…` when applicable                                                                                                                     |

Include screenshots for UI changes (`bun run preview:app --shots` takes them). Link the issue the PR closes when there is one.

AI-assisted contributions are fine. You are still responsible for the code: read it, run it, and make sure the tests mean something.

## Collaborators

If you are invited to the repository, you receive **Write** access, not Admin. Merging waits for a review from [@MrF1ow](https://github.com/MrF1ow).

## Reporting bugs and security issues

Open a GitHub issue for bugs (use the bug template). Include your host (Railway, Docker, or bare Bun), the MCP client you used, and the steps to reproduce. Do not include tokens, secrets, or personal food data.

**Don't report security vulnerabilities in public issues.** See [SECURITY.md](SECURITY.md) for private reporting.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE), the same license as the rest of the project.
