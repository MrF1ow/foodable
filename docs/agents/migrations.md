# The migration runner and dryrun

Read this before changing `src/db/migrate.ts`, `db/bootstrap.sql`, `scripts/migration-dryrun.ts` or its fixture, or when `db:migrate` / `db:dryrun` / the migrations job fails. The rules every new migration follows (naming, the contract marker, RLS and grants) stay in `CLAUDE.md` ("Migrations") and the `foodable-migration` skill.

## `db:migrate`

Schema lives only in `db/migrations/`. Apply it with `bun run db:migrate` (`--list` shows applied and pending without changing anything); Railway runs it as the pre-deploy command.

The runner (`src/db/migrate.ts`):

- runs `db/bootstrap.sql` first when the `auth` schema is missing (the roles, `auth.users`, `auth.uid()` and `storage` stubs the early, Supabase-era migrations expect);
- applies each pending file in its own transaction, and records it in `foodable_migrations.schema_migrations`.

A database whose history is still in `supabase_migrations` has that schema renamed on the first real migrate (never on `--list`). A recorded version with no file fails as "Migration history diverged".

## `db:dryrun`

Before pushing, run `bun run db:dryrun`. It:

1. starts a throwaway local Postgres (set `PG_BIN` if `initdb` is not on `PATH`) and loads the same bootstrap;
2. applies every migration older than `DEFAULT_PENDING_FROM` in `scripts/migration-dryrun.ts` as the baseline;
3. loads `scripts/migration-dryrun/seed.sql`;
4. applies the pending migrations one transaction per file, the way `db:migrate` does;
5. asserts `check.sql` plus a re-run no-op.

The re-run of the backfills happens just before `RERUN_BEFORE` (the Phase 8 contract), because they read columns it drops.

`--data <file>` swaps the fixture for a data-only production dump (`pg_dump "$DATABASE_URL" --data-only --schema=public -f prod-data.sql`), and then `--pending-from <version>` must name the first migration production has not applied.

Leave `DEFAULT_PENDING_FROM` where it is: the fixture is written against the schema before it, and every later migration (including new ones) runs on top of the fixture.

`bun run db:rehearse` runs the same dryrun on a copy of production's data through `railway ssh`; see "Rehearsing migrations on a production copy" in `docs/self-hosting.md`.

## The migrations job

Once a migration is on main, the migrations job (`scripts/migration-safety.ts`) treats it as applied. Editing, renaming or deleting it fails CI. The one exception `scripts/migration-safety/check.ts` allows is an unchanged move from the old `supabase/migrations/` folder to `db/migrations/` under the same name. The escape is the manual checks-ruleset bypass (disable that ruleset, merge, turn it back on), not a label.
