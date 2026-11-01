# Own Postgres and auth: implementation plan

Status: proposed, 2026-10-31. Replaces the "Local Postgres instead of Supabase" sketch in [roadmap.md](./roadmap.md).

## Goals

**v1: parity.** Same behaviour for every member, on infrastructure we own.

1. Run on plain Postgres reachable through one `DATABASE_URL`: a local process, a container, Railway, Neon, RDS, a VPS.
2. Own the user accounts and password checks. No GoTrue.
3. Supabase cloud keeps working, as a plain Postgres host. No second adapter.

The driver is local development: plain Postgres is one process, while local Supabase is about ten containers that have disappeared after reboots more than once.

**v2: multi-user ready.** Still no user-visible change. Make row level security the real tenant boundary, make auth swappable, make the app safe to run as more than one instance. Billing, public sign-up and a native app stay out of scope (see [Beyond v2](#beyond-v2)).

## Decisions

- **One-way move, not two backends.** Each adapter in `src/db/` is ported to `Bun.sql` and the `@supabase/supabase-js` version is deleted. The roadmap's "second adapter per domain" would mean maintaining about 125 queries twice.
- **Supabase is a host, not an API.** During the port and afterwards, production can point `DATABASE_URL` at the Supabase project's Postgres. Moving to another host later is a dump, a restore and a URL change.
- **Raw `Bun.sql`, no ORM.** Schema stays in `supabase/migrations/` as SQL (CLAUDE.md, "Preferred Bun APIs").
- **One schema history for every host.** The existing migrations reference `auth.users`, `auth.uid()`, the Supabase roles and `storage.buckets`. A committed bootstrap shim creates those on plain Postgres and does nothing on Supabase, so no migration on `main` is edited.
- **Rows keep the PostgREST shape.** Queries return `json_agg` output, which is what PostgREST itself serialises, so every `*FromRow` mapper stays unchanged. Without this, `Bun.sql` returns `numeric` as strings, `int8` as strings and `timestamptz` / `date` as `Date` objects (Bun SQL docs, "Numbers and BigInt" and the type table, read from `node_modules/bun-types/docs/runtime/sql.mdx`).
- **Every query goes through one entry point,** `run(fn)` in `src/db/sql.ts`. In v1 it is only a transaction with a timeout. In v2 it also sets the actor for RLS, which is then one function to change instead of a second pass over every query.
- **Password hashes carry over.** GoTrue stores bcrypt in `auth.users.encrypted_password` (the local dev project's hashes are `$2a$`). `Bun.password.verify` accepts a `$2a$` bcrypt hash; checked on Bun 1.4.2. Hashes are upgraded to argon2id on the next successful sign-in. Nobody resets a password.

Facts checked against the local Supabase project (Postgres 17.11): `supabase_migrations.schema_migrations` has columns `version text`, `statements text[]`, `name text`; the `postgres` role owns all 31 `public` tables and has `rolbypassrls`; `service_role` has `rolbypassrls`.

## Inventory

What touches Supabase today:

| Area              | Where                                                                                                                                                                                                                                                                    | Size                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| PostgREST queries | `src/db/*.ts`, plus `src/foods.ts` (`food_cache`), `src/analytics.ts` (`tool_analytics`)                                                                                                                                                                                 | about 125 `.from(…)` calls; `nutrition.ts` alone has 49       |
| RPCs              | `create_household`, `add_household_member`, `transfer_household_ownership` (`src/db/household.ts`), `resolve_household_mcp_token` (`src/db/tokens.ts`)                                                                                                                   | 5 calls. They are plain Postgres functions and stay unchanged |
| GoTrue            | `signUpUser`, `signInUser`, `authUserCount` (`src/db/client.ts`, used by `src/oauth.ts`); `auth.admin.createUser` / `deleteUser` (`src/db/household.ts`); `auth.admin.deleteUser` (`deleteAllUserData`, `src/db/nutrition.ts`)                                           | 6 call sites                                                  |
| Storage           | `exports` bucket: upload, signed URL, sweep (`src/domain/export.ts`)                                                                                                                                                                                                     | 1 module                                                      |
| Schema            | 12 foreign keys to `auth.users` (9 `on delete cascade`, 3 `on delete set null`); 2 versions of `promote_household_owner_on_leave` join `auth.users.created_at`; 15 migrations use `auth.uid()` in policies; `20260620120000_exports_bucket.sql` writes `storage.buckets` |                                                               |
| Config            | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`; deploy docs use `supabase db push`                                                                                                                                                                                                |                                                               |

Already ours, unaffected: OAuth clients, codes, tokens and site sessions are tables in `public`; password rate limiting is `src/rate-limit.ts`.

## Rules every phase keeps

- Migrations follow expand, backfill, switch, contract. No migration on `main` is edited, renamed or deleted.
- New tables enable RLS and grant DML to `service_role` in the same file (CLAUDE.md, "Migrations").
- One PR per step, with a conventional title (see the `foodable-pr` skill). Moves land before changes.
- `bun test`, `bun run typecheck`, `bun run format:check` and `bun run db:dryrun` pass on every PR.
- During the port, Supabase clients and `Bun.sql` both talk to the same database, so a half-ported tree is consistent and deployable.

---

# v1: parity

## Phase 0: Groundwork (no behaviour change)

**0.1 Contain Supabase in `src/db/`.** Pure moves.

- `src/analytics.ts` insert → `src/db/analytics.ts`.
- `src/foods.ts` `food_cache` read and upsert → `src/db/food-cache.ts`.
- `src/domain/export.ts` storage calls → `src/db/exports.ts` behind an `ExportArchiveStore` (`put`, `signedUrl`, `sweep`, `delete`), with a memory store for tests.

Exit: `grep -rn getSupabase src | grep -v '^src/db/'` finds only tests.

**0.2 Throwaway Postgres helper.** Extract `initdb` / `pg_ctl` / `psql` handling from `scripts/migration-dryrun.ts` into `scripts/lib/pg-temp.ts`. The dry run keeps its behaviour and uses the helper.

**0.3 Bootstrap shim.** Promote `scripts/migration-dryrun/stub.sql` to `db/bootstrap.sql`:

- Idempotent: roles created in `do` blocks that check `pg_roles`; `create schema if not exists`; `create table if not exists`; `create or replace function`. On Supabase every statement is a no-op.
- `auth.users` gains `encrypted_password text` so the Phase 3 backfill runs on both hosts. `created_at` is already there for `promote_household_owner_on_leave`.
- `auth.uid()` reads `request.jwt.claim.sub`, which is Supabase's own definition. v2 relies on it.
- The dry run loads the shim from its new path; `stub.sql` is removed.

**0.4 Migration runner.** `scripts/migrate.ts`, `bun run db:migrate`, reading `DATABASE_URL`:

1. Apply `db/bootstrap.sql` when the `auth` schema is missing.
2. Create `supabase_migrations.schema_migrations (version text primary key, statements text[], name text)` if missing. That is the table the Supabase CLI uses, so either tool sees the same history.
3. Apply each file in `supabase/migrations/` whose version is not recorded, one transaction per file, recording it in the same transaction. Stop at the first failure.
4. `--list` prints applied and pending versions without changing anything.

Production keeps `supabase db push` until Phase 7. The runner gets its first real use on a local database.

**0.5 Database tests.** `src/db/testing/pg.ts`: one temp Postgres per test process (via 0.2), bootstrap and migrations applied once, tables truncated between tests. CI already installs `postgresql` for the dry run, so the same job step gives `bun test` real Postgres. Locally, database tests skip with one warning when `initdb` is missing. In CI they must run.

## Phase 1: SQL foundation

`src/db/sql.ts`, one PR, unused by production code until Phase 2.

- `sql`: `new SQL(process.env.DATABASE_URL, { prepare: false, max, idleTimeout, connectionTimeout })`. `prepare: false` keeps it working behind a transaction pooler (Supabase's port 6543 does not support named prepared statements; [Supabase docs](https://supabase.com/docs/guides/troubleshooting/disabling-prepared-statements-qL8lEL)).
- `run(fn)`: `sql.begin(async tx => …)`. The first statement is `select set_config('statement_timeout', '15000', true)`, which replaces the 15 s fetch timeout the Supabase client has (`SUPABASE_TIMEOUT_MS`). `true` keeps it transaction-local, so it is safe with poolers.
- Read helpers that keep the PostgREST row shape: `rows(tx, q)` wraps `q` as `select coalesce(json_agg(r), '[]'::json) from (q) r`. `one` throws when the row count is not exactly 1, like `.single()`. `maybeOne` throws on more than 1 and returns null on 0, like `.maybeSingle()`.
- `pgError(context, err)` builds the same `Failed to …: <message>` errors the adapters throw today. Postgres error text from RPCs (`not a household member` and the rest) is identical through both clients, so message matching in `src/db/household.ts` keeps working.
- Config: `DATABASE_URL` is required alongside the Supabase variables until Phase 5. In production it is the Supabase session pooler connection string, which also works over IPv4. Confirm the Railway service reaches it before the first ported domain ships.

Spike before the PR, recorded in it: nested `sql` fragments compose inside `rows`; `json` columns come back parsed; timestamps inside `json_agg` match what PostgREST returned for the same row (compare one meal row from both clients in a test).

## Phase 2: Port the adapters

One PR per domain, smallest first, so the patterns settle before the big file:

| Order | Adapter                                        | `.from` / `.rpc` | Notes                                                                                                                 |
| ----- | ---------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1     | `grocery.ts`                                   | 4 / 0            | First real use of `rows` / `one`                                                                                      |
| 2     | `stock.ts`                                     | 3 / 0            | Ledger; `ledgerMatchesStock` must hold in tests                                                                       |
| 3     | `fridge.ts`                                    | 8 / 0            |                                                                                                                       |
| 4     | `settings.ts`                                  | 8 / 0            |                                                                                                                       |
| 5     | `rules.ts`                                     | 9 / 0            |                                                                                                                       |
| 6     | `recipes.ts`                                   | 11 / 0           |                                                                                                                       |
| 7     | `foods.ts`                                     | 18 / 0           | Aliases, barcodes, `mergeFoods`                                                                                       |
| 8     | `profiles.ts`, `food-cache.ts`, `analytics.ts` | 4 / 0            | Analytics stays fire-and-forget                                                                                       |
| 9     | `tokens.ts`                                    | 7 / 1            | OAuth and the household token                                                                                         |
| 10    | `household.ts`                                 | 7 / 4            | Queries and RPCs only; `liveAuthAdmin` waits for Phase 3                                                              |
| 11–13 | `nutrition.ts`                                 | 49 / 0           | Three PRs: meals and `meal_items`; water, weight and goals; bulk readers and `deleteAllUserData` (minus `auth.admin`) |

Each PR:

- Keeps every exported signature, so callers and the `mock.module` tests in `mcp.test.ts`, `middleware.test.ts` and `oauth.test.ts` do not change.
- Adds a contract suite for store-shaped adapters (`FridgeStore`, `FoodsStore`, and so on) that runs against both `createMemoryXStore()` and the live store on test Postgres. That suite is the parity check. Function-shaped adapters (`nutrition`, `profiles`, `tokens`, `household`) get integration tests on test Postgres.
- Wraps multi-step operations in one `run` transaction where today they are several PostgREST round trips. This is the only intended behaviour difference, it only removes partial writes, and each PR names the operations it affects.
- `getAllMeals` / `getAllWater` / `getAllWeight`: one query replaces `fetchAllPages`, because there is no 1000-row cap. Keep the exact-count check so the #66 guard survives.

Exit: no `.from(` or `.rpc(` left in `src/`. `getSupabase` is used only by GoTrue and Storage.

## Phase 3: Own auth

Expand, backfill, switch, contract, with the code switch between the third and fourth migration.

**3.1 Expand.** Migration `…_users.sql`:

- `public.users (id uuid primary key default gen_random_uuid(), email text not null, password_hash text, created_at timestamptz not null default now(), updated_at timestamptz not null default now())` and a unique index on `lower(email)`.
- RLS enabled, no policies; select, insert, update and delete granted to `service_role`; `revoke all on public.users from anon, authenticated`. On Supabase, `public` is exposed through the Data API, so the hash must not be reachable from it.
- A sync trigger on `auth.users` (insert, update of email or password, delete) that mirrors into `public.users`. It keeps sign-ups, member adds and account deletions made through GoTrue correct until the switch. On plain Postgres nothing writes `auth.users`, so it never fires.

**3.2 Backfill.** Migration: `insert into public.users (id, email, password_hash, created_at) select id, email, encrypted_password, created_at from auth.users on conflict (id) do nothing`. Re-runnable; add it to `RERUNNABLE` in the dry run and assert counts in `check.sql`.

**3.3 Repoint.** One migration:

- For each of the 12 foreign keys: add the new one to `public.users (id)` with the same `on delete` action, then drop the old one. Mark the file `-- foodable:contract <reason>` if the migration lint asks.
- `create or replace` `promote_household_owner_on_leave` to join `public.users` for `created_at`.
- After this, deleting through GoTrue still cascades: the trigger deletes the `public.users` row, and the new foreign keys cascade from there.

**3.4 Switch the code.**

- `src/domain/auth.ts`, pure, with a memory store: an `AuthStore` interface (`signUp`, `signIn`, `count`, `createUser`, `deleteUser`), email normalisation (trim, lowercase for lookup), the same minimum password length GoTrue enforces today (read it from the project's auth settings before writing it down), and the rehash policy.
- `src/db/users.ts`: the live store on `Bun.sql`.
- Sign-in: look up by `lower(email)`. When there is no user, still verify against a fixed dummy hash, so response time does not reveal which emails exist. On a match with a bcrypt hash, rehash with `Bun.password.hash` (argon2id) and update.
- Error parity: a wrong password still raises `SignInError` with status `400` and code `invalid_credentials`, so the login page's wrong-password vs. outage logic in `src/oauth.ts` is unchanged. A duplicate email (unique violation `23505`) maps to `alreadyRegistered: true`.
- Replace `signUpUser`, `signInUser`, `authUserCount`, `liveAuthAdmin` and the `auth.admin.deleteUser` in `deleteAllUserData`.

**3.5 Contract.** A later migration drops the sync trigger and its function. `auth.users` on Supabase is left alone: it belongs to Supabase and nothing reads it.

Verification: a test signs in with a bcrypt `$2a$` hash and checks it was rewritten as argon2id; the dry run asserts every `auth.users` row has a `public.users` row; deleting a member removes their rows in every cascading table.

## Phase 4: Exports without Storage

- Migration: `public.export_archives (user_id uuid primary key references public.users (id) on delete cascade, archive bytea not null, created_at timestamptz not null default now(), expires_at timestamptz not null)` with RLS and `service_role` grants. One row per user keeps "each export overwrites the last".
- `export_all_data` builds the ZIP as today, upserts it and returns a link to `GET /exports/:token`. The token is an HMAC (`SESSION_SECRET`) over user id and expiry, valid for the same 60 minutes. The archive is still a snapshot taken when the tool ran.
- The route checks the signature and expiry, then serves `application/zip` with `Content-Disposition: attachment`, `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Unknown, expired and tampered tokens all return the same 404. Rate-limit it like the other public routes.
- `sweepStaleExports` becomes `delete from export_archives where expires_at < now()`. `deleteAllUserData` is covered by the cascade.
- Unlike the bucket, the table works across several app instances, which v2 needs.
- The Supabase `exports` bucket is left in place. Empty it by hand once; no migration touches `storage`.

## Phase 5: Remove `@supabase/supabase-js`

- Delete the client, the dependency, `createTimedFetch` and `src/db/client.test.ts`. Move the pure helpers `src/supabase.test.ts` covers into suitably named tests.
- `.env.example`: `DATABASE_URL` replaces `SUPABASE_URL` / `SUPABASE_SECRET_KEY`.
- Update `docs/self-hosting.md`, `docs/deploy-checklist.md` and CLAUDE.md (data model, migrations, export sections).

Exit: `grep -rn supabase src package.json` finds only the `supabase/migrations` path. Production still runs on Supabase cloud, through `DATABASE_URL` only. Goal 3 is met.

## Phase 6: Local development on plain Postgres

- Run Postgres outside Docker as a systemd user unit next to `foodable.service`, using the same `initdb` the dry run uses. That avoids the disappearing-containers problem entirely. Also ship a `docker-compose.yml` (Postgres plus app) for anyone who prefers it. Use production's major version; local Supabase is 17.11.
- Move the bumblebee data:
    1. `bun run db:migrate` on the new empty database.
    2. `pg_dump` the local Supabase database's `public` schema `--data-only`, then load it with `session_replication_role = replica`, as the dry run does.
    3. Sign in with an existing account to confirm the hashes carried over.
- Point `.env` at the new database, restart `foodable.service`, stop the Supabase containers, and update `~/.local/share/foodable-dev/README.md`.

## Phase 7: Production host (optional, whenever)

- Switch deploy docs from `supabase db push` to `bun run db:migrate`. Both use the same history table, so it is a docs change.
- Moving off Supabase cloud: pick a host and confirm its backups and point-in-time recovery first, because that is what Supabase currently provides. If the host does not back up, schedule a `pg_dump` to object storage before switching. Then put the app in a short maintenance window, `pg_dump` `public` and `supabase_migrations`, restore on the target with `db/bootstrap.sql` applied first, point `DATABASE_URL` at it, and check sign-in, an MCP call and an export. Rollback is pointing `DATABASE_URL` back.

## v1 done when

- No Supabase client code or dependency remains.
- Every store passes its contract suite against memory and Postgres. `bun test`, `bun run db:dryrun` and `bun run e2e:agent` pass.
- bumblebee runs on plain Postgres, and existing accounts sign in with their old passwords.
- Production runs on `DATABASE_URL` against Supabase cloud or another host.

---

# v2: multi-user ready

None of this is visible to members. Order matters within 2.1–2.2; the rest is independent.

**2.1 Actor context.** An `AsyncLocalStorage<Actor>` set by the site middleware, `handleMcp` and the household-token path. `run()` reads it and adds `set_config('request.jwt.claim.sub', userId, true)` and `set_config('app.household_id', householdId, true)` to its first statement. Background work (sweeps, analytics, token resolution before an actor is known) calls an explicit `runAsSystem()`, allowlisted to a few files by a test.

**2.2 Real row level security.**

- Additive migrations: per table, policies `to foodable_app` on `household_id = current_setting('app.household_id', true)::uuid` or `user_id = auth.uid()`. The existing `service_role` policies stay.
- Create a `foodable_app` login role: not the table owner, no `bypassrls`, DML grants only. `runAsSystem()` keeps an owner connection.
- Switch the app's pool to `foodable_app`. Test suites run as that role, so a missing filter or policy fails a test instead of returning another household's rows.

**2.3 Auth behind `AuthStore`, hardened.** Decide then between building email verification, password reset and passkeys ourselves, or a library such as Better Auth that keeps users in our Postgres. Either one plugs into the Phase 3 interface.

**2.4 More than one instance.** Move the in-memory rate limits (`src/rate-limit.ts`) and any per-process caches that must agree across instances into Postgres or `Bun.redis`.

**2.5 No new single-household assumptions.** `householdExists()` and `authUserCount()` become a sign-up policy setting (`closed`, `invite`, `open`), default `closed`, so today's behaviour holds. Review that every `household_id` column used in a filter has an index.

## Beyond v2

Not planned, only kept possible: billing (a plan on `households` plus Stripe webhooks), public sign-up, and a native app. Hotwire Native can wrap the existing Turbo pages without a separate JSON API.

## Risks

| Risk                                                 | Mitigation                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Row shape drift (numbers as strings, `Date` objects) | `json_agg` reads; Phase 1 spike compares both clients on the same row                                |
| Partial port in production                           | Both clients use one database; each domain PR is independently deployable and revertable             |
| Auth switch locks someone out                        | Hashes copied, `$2a$` verify tested, sync trigger covers the window, dry run checks counts           |
| Cascade delete breaks after repoint                  | Trigger delete plus new FKs; a test deletes a member and checks every table                          |
| Railway cannot reach Supabase Postgres               | Use the session pooler (IPv4); confirmed before Phase 2's first deploy                               |
| Migration history diverges between tools             | Runner writes the Supabase CLI table; `--list` compared with `supabase migration list --linked` once |
