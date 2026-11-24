# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. It holds the rules that apply to almost every change. Subsystem detail lives in `docs/agents/`; each section below says when to read which doc.

## Project Overview

Foodable is a self-hosted MCP platform for one household, built with Bun and TypeScript. Entry point: `src/index.ts`. It is a fork of `akutishevsky/nutrition-mcp`; the GitHub repo remains https://github.com/MrF1ow/foodable. It is not a public hosted service. The version lives only in `package.json` (`src/version.ts` re-exports it for the MCP `serverInfo`); releases are a version-bump PR opened by `bun run release`, which `.github/workflows/release.yml` tags `v<version>` on main with notes grouped by PR label (`.github/release.yml`); see "Releases" in `CONTRIBUTING.md`.

**The MCP server.** `/mcp` runs on MCP TypeScript SDK **v2** (`@modelcontextprotocol/server`; the v1 `@modelcontextprotocol/sdk` is gone) with Zod 4, and serves both the `2026-07-28` and `2025-11-25` protocol eras from one stateless server factory (`src/mcp/server.ts`). Every `inputSchema` / `outputSchema` is a schema object, never a raw shape. `src/mcp/server.ts` calls one `registerXTools(server, ctx)` per domain module in `src/mcp/tools/`; `src/mcp/shared.ts` holds `withAnalytics`, actor resolution and the shared schemas. There are 106 tools, as many as `src/mcp/tools-list.snapshot.json` has names. Declare a flag-gated tool with `gatedTool` in `src/mcp/gated.ts`. **Before touching `src/mcp/`, `src/mcp.test.ts`, the SDK dependencies or the db mocks in tests, read `docs/agents/mcp-server.md`** (era handling, the auth and origin plumbing, why the HTTP tests live in `mcp.test.ts`, the lint rules on `mock.module`).

## Architecture rules

Follow these for every change.

- **Subtract before you add.** Phase 0 removes upstream leftovers before any feature work.
- **Moves before changes.** Phase 1 is pure file moves with zero behavior change. Feature diffs after it stay small and reviewable.
- **Expand, backfill, switch, contract.** Every schema change ships as additive columns or tables, then a backfill, then code reads the new shape, then a later migration drops the old shape. No migration is destructive and backfilling in the same step.
- **Keep the mature nutrition stack untouched.** Meals keep their denormalized totals (`calories`, `protein_g`, and the rest). Insights, widgets, goals, import, and export keep reading those columns.
- **Pure functions plus thin adapters.** New logic (put-away, cook, eat, unit resolution) lives in pure modules with memory-store tests. `mcp.ts` and the routes only adapt. Domain modules in `src/domain/` (`fridge.ts`, `grocery.ts`, `recipes.ts`, `settings.ts`, `rules.ts`, `linking.ts`, `quantity.ts`) already follow that pattern: store interface, in-memory store, row mappers, pure functions.
- **Destructive agent tools go through the guard.** A tool that deletes, clears or overwrites what a person set calls `ctx.runDestructive` (`src/mcp/shared.ts` → `withAgentAction`): it records the rows it will change (`rec`, `captureCascade`) before writing, is refused when the owner's switch is Off, and can be undone for 24 h in Settings › AI connections. A new one needs a scenario in its module's guard db test. Event notifications (`Notify`, `createNotifyQueue`) ride its third `notify` argument and send only after the commit.
- **One household per deploy stays.** New tables still carry `household_id` and the same RLS shape, for consistency and for a future multi-household option.

Layout: `src/db/` is one Postgres adapter per domain (`Bun.sql` via `src/db/sql.ts`), `src/domain/` the pure modules, `src/mcp/` the agent surface, and `src/web/` the household app (`shell.ts` for the head, theme and `renderBarePage`, `shell-v2.ts` for the shell itself, `loaders.ts`, `routes/` one Hono sub-app per area, `pages/` and `pages/v2/`, `components/` with `ui.ts` for page primitives and `v2/` for the `fd-` components, `client/` plain browser JS concatenated as `/app.js` and `client/v2/` as `/app-v2.js`, `middleware.ts` for the site actor, `form.ts` for form parsing). `src/app/` is gone. Auth, OAuth, rate limiting and analytics still sit at the top of `src/`.

Host-agnostic config: optional `PUBLIC_ORIGIN` (see `.env.example` and `docs/self-hosting.md`). Docker keeps `--smol`. English only; do not restore locale switchers, `set_language`, or `src/copy/*.<locale>.ts`. There is one accent, the logo green `#28cf8b` (`BRAND_GREEN` in `src/brand.ts`, `--accent` in `public/widgets/src/shared/tokens.css`), the same in both themes, on the app, the login page, the widgets and the icons alike. Text on an accent fill uses `--on-accent`, never `--bg` or white. The brand icons are generated from `src/brand.ts` (`bun run gen:icons`); do not hand-edit them.

## Conventions and skills

PR titles, blast radius, branch naming, and migration lint live in [`scripts/conventions/`](scripts/conventions/) and [`CONTRIBUTING.md`](CONTRIBUTING.md). Repo-specific agent workflows are in [`.claude/skills/`](.claude/skills/).

**Design source of truth.** `~/Projects/designs/Foodable/Foodable Design.figcraft` (fonts in `~/Projects/designs/Foodable/fonts/`), open in the FigCraft app, holds every screen, the chat widgets and the design tokens. It is **read-only**: read it with the FigCraft MCP tools (`inspect_document`, `get_node`, `screenshot`, read-only `run_command`s such as `variable.list`), and never edit or save it. When the code and the design disagree, change the code or ask the design owner.

**Planning.** Plans and planned work are kept outside this repo. PR bodies, commits and code comments do not reference them.

**Testing and verifying.** The `foodable-test` skill is how to run and verify Foodable: an isolated local stack, which tool fits which change, and what never to touch. Use it before starting the server, the tests, `check:nav`, the previews, the widget harness or e2e. Verify that any dependency version you pin is current and not deprecated.

## Ways to hurt yourself

- **Merging to main deploys.** Railway deploys `main` to the household's live service. Never push to `main`; land through a PR, and put new behaviour behind a flag (`src/flags.ts`).
- **Touching production data.** Production Postgres is internal-only. Reach it through `bun run db:rehearse` (it works on a copy), or `railway ssh` when the user asks. A dev server, test or migration pointed at it writes to the household's real data; never do that.
- **Destructive migrations.** Railway's pre-deploy runs `db:migrate` on merge, so a dropped column is gone in production. Expand, backfill, switch, contract: never drop and backfill in the same step. `scripts/migration-safety.ts` (the `migrations` job) lints this (see Migrations); splitting the steps is on you.
- **Leaking `.env`.** It may hold real secrets. Never print it, copy it into a fixture, or commit it; use the URL from `bun run db:dev url` locally. Bun auto-loads `.env`, and `bun run db:dev` defaults to the user's own dev database unless `FOODABLE_PG_DIR` and `FOODABLE_PG_PORT` are set: read the `foodable-test` skill first.
- **Editing the design file.** `~/Projects/designs/Foodable/Foodable Design.figcraft` is read-only; a save overwrites the design owner's source of truth (see "Design source of truth").
- **Bypassing protection.** Never use `gh pr merge --admin`, push to `main`, or create, edit or delete rulesets. `.claude/settings.json` denies these for Claude Code only; other tools are bound by this rule alone.

## Hit every surface

A change may need to reach more than the file you edit. `foodable-test` says which tool verifies which surface.

- **MCP tools:** update `src/mcp/tools-list.snapshot.json` and `TOOLS` in `src/copy/tools.ts` together.
- **Household web app:** the page, its route, `bun run check:nav`, and a look with `bun run preview:app`.
- **Chat widgets:** the widget partials, `src/widgets.test.ts`, and `bun run harness`.
- **Flags:** exercise the change with the flag on and off.
- **Both MCP protocol eras:** `2026-07-28` and `2025-11-25`, through the "/mcp over HTTP" tests in `src/mcp.test.ts`.
- **Migrations:** `bun run db:dryrun`, and the phased workflow in "Migrations".
- **Data export and import:** the CSV shapes stay round-trippable (`meals.csv` re-imports).
- **Docs:** `docs/`, `docs/agents/`, `CONTRIBUTING.md` and this file, when behaviour or a command changes.

## Subsystem reference docs

Read the doc before you change its area. Each one keeps invariants that were real bugs.

- **Chat widgets (MCP Apps).** In-chat cards assembled at startup from `public/widgets/src/` partials, served as `ui://widget/v2/<file>` resources, under a deny-all CSP, with an exact host handshake and mandatory height reporting. Before touching `public/widgets/`, `src/widgets.ts`, the harness, or a tool's `_meta.ui` / `outputSchema`, read `docs/agents/widgets.md` (and `public/widgets/STYLE_GUIDE.md` for the partials).
- **Bulk meal import.** `start_meal_import` (widget, parses in the browser) and `bulk_import_meals` (model and widget) share one write path in `src/domain/import.ts`, and every meal write resolves `logged_at` through `parseLoggedAt`. Before touching either tool, `src/domain/import.ts`, `src/domain/csv.ts`, `src/domain/tz.ts` or a write path's timestamp handling, read `docs/agents/meal-import.md`.
- **Data export.** `export_all_data` is the only way out: a ZIP of CSVs behind a 60-minute HMAC link. Before touching the export tool, `src/zip.ts`, the CSV builders, `/exports/:token` or the `getAll*` readers, read `docs/agents/data-export.md`.
- **Login, routes and Turbo.** Canonical paths are `APP_PATHS` in `src/web/route-map.ts`; the only generated public HTML is the login template; no marketing routes. Turbo 8 drives in-app navigation (303 on POST success, 4xx in place, 401 for expired-session POSTs) with a few deliberate opt-outs. Before touching routes, the login page, static assets, `shell.js` or any `data-turbo` opt-out, read `docs/agents/web-app.md`.
- **Household app styling.** `/app.css` (base and brand layer) plus `/app-v2.css` (the `fd-` shell); tokens come from `src/tokens.ts` via `bun run gen:tokens`; pages use the `ui.ts` primitives and never hand-write them; the brand layer never reaches a widget. Before touching `public/app/`, `src/tokens.ts`, `src/brand.ts`, `src/web/components/` or writing page markup, read `docs/agents/app-styling.md`.
- **Migration runner and dryrun.** Before changing `src/db/migrate.ts`, `db/bootstrap.sql` or `scripts/migration-dryrun*`, or when `db:migrate` / `db:dryrun` / the migrations job fails, read `docs/agents/migrations.md`.
- **Data model detail.** Before touching foods, stock, food-backed meals, usuals or step mentions, read `docs/agents/data-model.md`.

## Household data model

The invariants in brief; `docs/agents/data-model.md` has the full rules.

- **One `foods` row is the identity.** Fridge items, grocery lines and recipe ingredients carry a `not null` `food_id`, and "already have" matching (`sameFood`) compares `food_id` alone. Names resolve through `normalizeFoodName`; `mergeFoods` repoints every reference. Supplies are foods with `kind = 'supply'`. Dislikes are free text.
- **Nutrition is per 100 g** (per 100 ml when `nutrition_basis = '100ml'`), and null means unknown, never zero. OFF quality columns follow the same rule (`[]` means OFF listed none) and are written only through `setFoodQuality`.
- **Units.** Quantities keep their own unit; `toGrams` is the one conversion path. A missing factor is null, never a guessed density.
- **Food-backed meals.** `meal_items` are write-time snapshots; the `meals` totals are their null-aware sum, so every reader of `meals` is unchanged. Free-text meals still work as before.
- **Stock ledger.** Every change to `fridge_items`, manual edits included, writes a `stock_movements` row through `applyMovement`, so `ledgerMatchesStock` holds. Decrements go oldest expiry first and never below zero.
- **Usuals.** A plain food is a usual when it has live products or `usual_added_at` is set; `usualProductRows` is the one rule.
- **Step mentions** are warnings computed on read for imported recipes; they never block anything.

### Migrations

Schema lives only in `db/migrations/`, applied by `bun run db:migrate` (Railway's pre-deploy). Before pushing, run `bun run db:dryrun`. How the runner and the dryrun work: `docs/agents/migrations.md`.

Once a migration is on main, the migrations job treats it as applied: editing, renaming, or deleting it fails CI. A new file is db/migrations/<14-digit timestamp>_<snake_case>.sql and its timestamp is later than every migration already on main. Two open pull requests that both add a migration need the second one rebased and renumbered. A destructive statement (DROP TABLE, DROP COLUMN, TRUNCATE, ALTER COLUMN … TYPE, RENAME, SET NOT NULL, or DELETE / UPDATE without WHERE) needs a line -- foodable:contract <reason> with a non-empty reason. DROP POLICY, DROP FUNCTION, and DROP TRIGGER do not. Every new CREATE TABLE enables row level security in that same file, and grants select, insert, update, and delete on that table to service_role. A serial or identity column also grants usage and select on its sequence to service_role.

## Commands

- `bun run src/index.ts` - Run the server (`bun --watch src/index.ts` restarts on file changes)
- `bun test` - Run all tests; `bun test src/path/to/file.test.ts` runs one file
- `bun run format` - Format code with `bun fmt` (4-space indentation, config in `bunfig.toml` `[fmt]`). Needs Bun 1.4.4 or newer (CI and the Dockerfile pin 1.4.4); an older Bun fails with the misleading `Script not found "fmt"`
- `bun run format:check` - Verify the tree is formatted (CI runs this on every PR)
- `bun run typecheck` - Typecheck the whole project, tests and `scripts/` included (CI runs this on every PR)
- `bun run lint` - oxlint with the repo's own rules (`scripts/lint-rules/`, enabled in `.oxlintrc.json`). A suppression needs a reason: `// oxlint-disable-next-line foodable/<rule> -- <why>`
- `bun run check:changed` - Run the checks CI would run for the files you changed (`--list` previews them, `--all` runs everything)
- `bun run db:dev` - Persistent local Postgres for development (`init`, `start`, `stop`, `status`, `url`, `migrate`)
- `bun run db:dryrun` - Apply the pending migrations to a throwaway local Postgres and check the backfill
- `bun run db:rehearse` - Dry-run what production has not applied on a copy of its data, through `railway ssh` (see `docs/self-hosting.md`)
- `bun run db:import-postgres` - Copy the `public` data of a migrated Postgres (`--from`) into an empty one at the same migration version (`--to`, default: `db:dev` URL; `--check-only` checks preconditions)
- `bun run release [patch|minor|major] [--dry-run]` - Open the release PR (see "Releases" in `CONTRIBUTING.md`)
- `bun run gen:tokens` - Write the token CSS files from `src/tokens.ts`; `bun run gen:all` also regenerates the login page

The committed tree is kept `bun fmt`-clean, so `bun run format` only rewrites files you actually edited. Generated output that must not be formatted goes in `[fmt] ignorePatterns` in `bunfig.toml` (`bun fmt` also skips anything a repo `.gitignore` lists).

## Bun Runtime

Default to Bun for everything. Do not use Node.js equivalents.

- `bun <file>` instead of `node`/`ts-node`; `bun install`, `bun run <script>` and `bunx <pkg>` instead of npm and npx
- Bun auto-loads `.env` — don't use dotenv
- Prefer Bun APIs: `Bun.serve()` (not Express), `bun:sqlite`, `Bun.redis`, `Bun.sql` for Postgres (not pg/postgres.js), `Bun.file` (not node:fs readFile/writeFile), `Bun.$\`cmd\``(not execa), built-in`WebSocket` (not ws)
- Tests use `import { test, expect } from "bun:test";`
- Frontend, if needed: HTML imports with `Bun.serve()`, not Vite. Bun API docs: `node_modules/bun-types/docs/**.mdx`.
