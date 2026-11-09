# Contributing to Foodable

Thanks for taking a look. Foodable is a personal project: one household runs it on its own deploy, and the code is open so others can self-host it or borrow from it. That shapes what fits here, so please read the first section before you write code.

## What fits

- **Welcome:** bug fixes, self-hosting fixes (Docker, reverse proxies, other hosts), MCP client compatibility, tests, docs, and small improvements to the existing pillars (fridge, groceries, nutrition, recipes, settings).
- **Ask first:** new tools, new pages, schema changes, and new dependencies. Open an issue describing the problem before writing the code. A short "would you take this?" saves both of us a rejected PR.
- **Out of scope:** multi-tenant or hosted-service features, a public marketing site, translations and locale switchers (the app is English only), analytics or tracking beyond the existing `tool_analytics` table, and theming beyond the one accent.

## Getting set up

You need [Bun](https://bun.sh) (CI uses the version pinned in `.github/workflows/ci.yml`) and Postgres. `bun run db:dev init` starts a local cluster for you (it needs `initdb` on your `PATH` or `PG_BIN` set); `docker compose up` is the alternative.

```bash
git clone https://github.com/MrF1ow/foodable.git
cd foodable
bun install
bun run db:dev init           # local Postgres on :54330, migrated; prints DATABASE_URL
cp .env.example .env          # fill in DATABASE_URL and OAuth values
bun run generate-oauth-creds  # prints OAuth and session secrets for .env
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
bun run gen:all         # regenerate login HTML and tokens
bun run check:changed   # what CI's check job runs for your changes
```

`check:changed` picks format (Prettier, 4-space indent; `bun run format` fixes it), `bun run lint` (oxlint with the repo's rules in `scripts/lint-rules/`), `bun run typecheck` (the whole project), the tests that import what you changed, and migration safety plus `bun run db:dryrun` when you touched `db/migrations/`. `--list` shows the plan and `--all` runs everything. A push to `main` runs every check, listed directly in `ci.yml`.

### Policy checks

Three CI jobs enforce the repo's own rules, and one required check, **policy**, sums them up. They run from `main`, never from your branch, and read your PR through the GitHub API:

- **PR conventions and migration safety** (`scripts/conventions/policy.ts`): the title, branch name, body sections and blast level, and the rules for `db/migrations/` files.
- **skill-drift:** a skill lists the files it describes in its frontmatter `watches:`. A PR that changes a watched file without touching that skill's folder fails; update the skill (or its `watches:`) in the same PR. An entry can name one top-level JSON key (`package.json#scripts`): it then counts only when that key differs between your branch point and your head, so a version bump or a dependency update does not trigger it. `bun run scripts/conventions/skill-drift.ts` checks your working tree.
- **agent-context-budget:** `CLAUDE.md` and each `.claude/skills/<name>` folder have a size baseline in `.github/agent-context-budget.json`. A PR that grows one past it, or adds a skill folder, fails unless it carries the `agent-context-increase` label, and with the label it must also commit a regenerated baseline (`bun run scripts/conventions/context-budget.ts --write`, which counts tracked files only), or the next PR would start from the old sizes.

Because main's copy does the judging, a PR that edits these scripts (`scripts/conventions/`, `scripts/migration-safety*`, `scripts/data-api-grants.ts`, the budget file, `policy.yml`, the skills) is still held to the old rules, and its edit takes effect after it merges. The policy job lists such files in its log. **policy** is the check a PR cannot change: it never checks out or runs the PR's code. The `migrations` job in `ci.yml` also runs the safety rules from the base branch's copy (with the base's `bunfig.toml`, so a PR's `preload` cannot touch it), but that is defence in depth, since `pull_request` runs the PR's own `ci.yml` and a PR can edit that job.

When every required check is green, a PR merges without a review or a label (the budget label above only matters when a PR grows the agent context).

## How the code is laid out

[`CLAUDE.md`](CLAUDE.md) is the detailed map of the codebase and its invariants. It's written for AI coding agents but works just as well for people. The short version:

- `src/domain/` holds pure logic with in-memory stores and tests. New behaviour goes here first.
- `src/db/` has one thin Postgres adapter per domain (`Bun.sql`, every query through `run()` in `src/db/sql.ts`).
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

- Schema lives only in `db/migrations/`. Name files `YYYYMMDDHHMMSS_short_description.sql`, timestamped after the newest existing one. `bun run db:migrate` applies them in order and records each version in `foodable_migrations.schema_migrations`; [docs/self-hosting.md](docs/self-hosting.md#how-migrations-work) explains the runner.
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

## Planner

Planned work lives in [planner/](planner/), one Markdown file per item, and [ROADMAP.md](ROADMAP.md) is the overview. A PR that works on an item names it in its `## Planner` section (`Closes CAL-2` or `Part of CAL-2`) and updates the item in the same PR with `bun run planner --close CAL-2 --pr <number>` or `--start`. Closing a project's last item also removes the project folder and retires its key. The **PR lint** check fails when the body and the files disagree. Run `bun run planner --next` to see what is next, and read [planner/README.md](planner/README.md) for the fields.

## Releases

Railway deploys `main`, so a release is not what ships code. It marks a point on `main` that a self-hosted deploy can safely update to.

- **Cut one** with `bun run release` on an up-to-date `main`. It reads the labels on the PRs merged since the last tag, suggests a level, bumps `version` in `package.json` on a `chore/repo-release-<version>` branch, and opens `chore(repo): release <version>` listing those PRs. Pass `patch`, `minor` or `major` to override the suggestion, and `--dry-run` to see the PR without opening it. When the PR merges, the **Release** workflow tags the commit `v<version>` and publishes a GitHub release.
- **Level:** while the version is `0.y.z`, a `breaking` PR, a contract migration or a feature that touches the product (any area besides `repo`, `docs`, `test` and `deps`) bumps the minor version, and anything else bumps the patch version. Major is never suggested: going to `1.0.0` is a deliberate call. From then on, breaking changes and contract migrations suggest major.
- **Notes** are generated from PR titles and grouped by the labels CI already applies. Breaking changes and contract migrations come first because they are what a forker has to read before updating.
- **Don't cut one** in the middle of an expand → contract sequence. Release once the code that reads the new shape has merged.

If the workflow failed or the tag is missing, run it again from the Actions tab (**Release → Run workflow**). It does nothing when the current version already has a release.

## Blast radius

Every PR declares how risky the change is. In the **Blast radius** section, set **Level** to `low`, `medium`, or `high`. That level must be at least the **floor** from the files you touch; declaring lower than the floor fails CI.

The floor comes from path rules (see `scripts/conventions/`). In short:

| Floor      | Examples                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **high**   | `db/`, `.github/workflows/`, `.github/rulesets/`, `.github/CODEOWNERS`, `scripts/conventions/`, `scripts/migration-safety/`, `scripts/migration-dryrun/`, `package.json`, and what decides what green means: `scripts/check-changed.ts`, `scripts/typecheck.ts`, `scripts/lint-rules/`, `.oxlintrc.json`, `.claude/settings.json`, `.flow/profile.yaml`, `.github/agent-context-budget.json` |
| **medium** | Each product area (`fridge`, `grocery`, `nutrition`, …) spans `src/domain/`, `src/mcp/tools/`, and `src/web/` for that pillar; `bun.lock` counts as `deps`                                                                                                                                                                                                                                   |
| **low**    | Docs, copy, and other paths not mapped to a pillar                                                                                                                                                                                                                                                                                                                                           |

If a PR touches two different **medium** areas (for example fridge and grocery), the floor becomes **high** even when no single path is in the high table.

Also set **Rollback** to `revert-safe`, `needs a follow-up migration`, or `needs a data fix`.

## Pull request template

Use the template GitHub fills in. Required sections:

| Section          | Notes                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Summary**      | What changed and why                                                                                                                            |
| **Blast radius** | **Level** and **Rollback** (plus **Affects** / **What could break** when helpful)                                                               |
| **Changes**      | Bullet list                                                                                                                                     |
| **Migrations**   | Describe migration work, or `None.` Must **not** be `None` when any file under `db/migrations/` changes                                         |
| **Contracts**    | Breaking changes, snapshot updates, or `None.` Must **not** be `None` when the title contains `!` or `src/mcp/tools-list.snapshot.json` changes |
| **Testing**      | Commands run and anything checked by hand                                                                                                       |
| **Planner**      | `Closes <ID>`, `Part of <ID>`, or `None.` A named item must be updated in the same PR (see [planner/README.md](planner/README.md))              |
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
