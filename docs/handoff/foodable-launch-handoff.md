# Foodable launch handoff

Written 2026-10-05. For an agent with access to GitHub, Supabase, and Railway. It takes Foodable from "merged" to "live for the household", starting with an empty database.

**Deploy day:** follow [deploy-checklist.md](../deploy-checklist.md) for the ordered go-live checklist.

Read `CLAUDE.md` and `docs/handoff/foodable-architecture-plan.md` (its "Status at handoff" section) first. This file does not repeat them.

## Status (2026-10-12)

**Done**

- Preflight was green at `ee7f06f`: `bun test`, `bun run typecheck`, `bun run format:check`, `bun run gen:all`, and `bun run db:dryrun` all passed.
- A new empty Supabase project exists: ref `dapbxswqfiqvxutsobhr`, region `us-east-1`, name **Foodable**. The 39 migrations of 2026-10-05 were applied there, giving 31 `public` tables and the `exports` storage bucket. Email and password sign-in is enabled; confirmation email is off (mailer autoconfirm). No data was copied from the old project. The old Supabase project and the old server were not touched.
- Local server checks on an agent machine against that project passed: `GET /health` returned `ok`, `GET /` served the Foodable sign-in page, and OAuth discovery URLs used host `127.0.0.1` with `PUBLIC_ORIGIN` unset. The server was then stopped (port 8080); it is **not** still running.
- 2026-10-06: the live schema was checked against the repo. The SQL applied to the project was identical to the 39 committed migration files, with no drift.
- 2026-10-06: the fridge ledger gap (#50), the old-name leftovers (#49) and `railway.toml` with a Railway section in `docs/self-hosting.md` (#48) are merged.
- 2026-10-06: the household app and login moved onto the widget design system (#52, #53). There is now one green accent; the sky accent and the marketing CSS, `site.js` and fonts are gone.
- 2026-10-10: the deployment-audit fixes are merged. #55 adds the OAuth redirect allow-list and required PKCE. #56 revokes `anon` / `authenticated` from the household RPCs, and its migration is applied live, so the project now has **40 migrations**. #57 removes the MCP `add_household_member` / `rotate_household_token` tools (67 tools; membership and the bot token are web-only). #58 adds `SESSION_SECRET`, a Supabase fetch timeout, Bun pinned to 1.4.2, and `docs/deploy-checklist.md`.
- 2026-10-10: #60 is merged: members sign in by username, login errors are clear, ownership can be transferred and members removed, and the Docker image runs in production mode. #59 cleaned up stale docs.
- 2026-10-12: the GitHub repo is renamed to `MrF1ow/foodable`; the old `MrF1ow/nutrition-mcp` URL redirects. Repo URLs in `package.json`, `README.md`, `docs/self-hosting.md` and `CLAUDE.md` still name the old repo (see step 8).
- 2026-10-12: the Foodable logo exists. #61 adds it as SVG icons (favicon, touch icon, MCP server icon, login mark) and makes the logo green `#28cf8b` the one accent.

**Open PRs to merge before deploy day**

- #61: the logo and the `#28cf8b` accent.
- #62: the add-member form fix (separate Email and Username boxes meant no member could be created from Settings → Household), embedded widget frames that were cut off or scrolled on desktop, and one spacing scale for app forms. Merge this one before the member steps in step 4.

**Not done**

- The two-person household sign-in (step 4) has not been done. The project is no longer empty, though. On 2026-10-05 one Auth user signed up, created a household named "Flow" as owner, and logged two test meals of "Milk". Keep it if that account is the intended owner. Otherwise wipe Auth and the `public` data before step 4, because only the first sign-up is allowed.
- The Docker image has not been built locally, and MCP Inspector OAuth has not been run against the new allow-list. Both are in the deploy checklist.
- The end-to-end walk (step 5) has not been done.
- Railway was not created. DNS was not changed. Phase 8 has not started.

**Unchanged gates:** version `0.1.0`. The repo rename and the logo are no longer gates: both are done.

**Deploy day is still ahead.** Follow [deploy-checklist.md](../deploy-checklist.md). This file keeps the detail behind it: the Railway variables (step 3), the walk (step 5) and retiring the old deploy (step 6).

## Decisions already made

- **Start fresh.** Delete every user's data. Nothing is migrated, exported, or restored from the current deploy. A new Supabase project replaces the old one.
- **Host on Railway** for now, from the repo's `Dockerfile`. Supabase cloud stays the database, Auth, and storage.
- **Unchanged gates.** The version stays `0.1.0`. Phase 8 waits until this deploy has run for a while. The repo is `MrF1ow/foodable` (renamed by 2026-10-12) and the logo exists (#61).

## Where the code is

- Phases 0 to 7 and the audit fixes are merged. `bun test` passes 1098 tests (after `bun run gen:all`, 2026-10-10). `bun run typecheck` and `bun run format:check` are clean. CI is green.
- `tools/list` returns 67 tools.
- There are 40 migrations, all applied to `dapbxswqfiqvxutsobhr`. `bun run db:dryrun` applies them in order to an empty Postgres (with Supabase stubs).
- The app is Railway-ready as is:
    - It binds `0.0.0.0` on `PORT`, which Railway injects.
    - `/health` returns `ok`.
    - It writes nothing to local disk. Exports go to Supabase storage.
    - The site cookie gets `Secure` once `PUBLIC_ORIGIN` is `https://…`.

## Access you need

Get these from the user before starting. Do not paste secrets into PRs, commits, or chat logs.

- [ ] GitHub push access to `MrF1ow/foodable`.
- [ ] A Supabase account that can create a project, and a CLI login (`bunx supabase login`).
- [ ] A Railway account with the GitHub repo connected. Hobby is $5/month including $5 of usage, which a single small Bun service should fit.
- [ ] The **old** Supabase project ref, and where the **old** server runs, so both can be retired in step 6.
- [ ] A contact email for `OFF_USER_AGENT`. Open Food Facts requires one.
- [ ] Two household people to sign in for the walk in step 5: the owner and one member. Prefer that the user drives the browser for sign-ins, so passwords stay with them.

## Rules for this run

- Stop and report on any failure. Do not improvise past a failed step.
- Ask the user once, explicitly, before anything irreversible: deleting the old Supabase project, or shutting down the old server. "Start fresh" is the decision. The moment is still theirs to confirm.
- Never edit a migration once it is applied to the new project. Fixes go in a new migration.
- Repo changes go through a PR with green CI. Do not push to `main`.
- Report evidence: command output, URLs, screenshots of the walk.

---

## 1. Preflight

- [x] `git clone`, `bun install`, `bun run gen:all`. (Green at `ee7f06f` on 2026-10-05.)
- [x] `bun test`, `bun run typecheck`, `bun run format:check` all pass.
- [x] `bun run db:dryrun` passes. Set `PG_BIN` if `initdb` is not on `PATH`. This exercises the migration chain and the Phase 2 backfill on a fixture.

## 2. New Supabase project

Why a new project and not `supabase db reset --linked`: a remote reset only rebuilds the `public` schema. Auth users survive, and storage files are orphaned. Foodable's first-user flow signs up a new account only while Auth is empty (`docs/self-hosting.md`, "First-user flow"). Leftover Auth users would turn the first visit into a sign-in with no household. A new project gives an empty Auth, empty storage, and empty migration history in one step.

- [x] Create the project in the Supabase dashboard. Pick the region closest to the Railway service's region. (2026-10-05: ref `dapbxswqfiqvxutsobhr`, `us-east-1`, name Foodable.)
- [x] Authentication: email and password enabled. **Confirm email off**, so the owner can sign in immediately.
- [x] Note the project URL (`SUPABASE_URL`) and the **service role** secret (`SUPABASE_SECRET_KEY`). The anon or publishable key is not enough. (Recorded outside this doc; do not commit secrets.)
- [x] Apply the schema:

    ```bash
    bunx supabase link --project-ref dapbxswqfiqvxutsobhr
    bunx supabase db push --dry-run   # listed all 39 migrations on 2026-10-05
    bunx supabase db push
    bunx supabase migration list      # local and remote columns match (40 rows since #56)
    ```

- [x] Verify the result in the SQL editor:
    - `select count(*) from pg_tables where schemaname = 'public'` returns 31.
    - `select id from storage.buckets` includes `exports`.
- [ ] Know the free-plan catch. Supabase pauses a free project after a week without database activity. Daily household use keeps it awake. If it is ever paused, restore it from the dashboard. A paid Supabase plan never pauses.

### Local smoke (2026-10-05, not production)

Against the new project, with env vars set locally and `PUBLIC_ORIGIN` unset:

- [x] `GET /health` returned `ok`.
- [x] `GET /` served the Foodable sign-in page.
- [x] OAuth discovery URLs used host `127.0.0.1`.
- [x] Server stopped afterward; port 8080 is not in use.

## 3. Railway

- [x] `railway.toml` is at the repo root (#48): it builds from the `Dockerfile` and health-checks `GET /health`, so a broken boot never takes traffic.
- [ ] Create a Railway project, then a service from the GitHub repo on `main`.
- [ ] Set the service variables. Generate fresh OAuth credentials with `bun run generate-oauth-creds`. Do not reuse the old deploy's values.

    | Variable              | Value                                               |
    | --------------------- | --------------------------------------------------- |
    | `SUPABASE_URL`        | new project URL                                     |
    | `SUPABASE_SECRET_KEY` | new project service role secret                     |
    | `OAUTH_CLIENT_ID`     | fresh, from `generate-oauth-creds`                  |
    | `OAUTH_CLIENT_SECRET` | fresh, from `generate-oauth-creds`                  |
    | `SESSION_SECRET`      | fresh, from `generate-oauth-creds` (site cookie)    |
    | `OFF_USER_AGENT`      | `Foodable (<contact email>)`                        |
    | `PUBLIC_ORIGIN`       | `https://<railway domain>`, set after the next step |

    Do **not** set `PORT`. Railway injects it, and the app reads it. `ALLOWED_ORIGINS` is not needed.

- [ ] Networking: **Generate Domain**. Set `PUBLIC_ORIGIN` to that `https://` origin with no trailing slash, then redeploy. Without it, OAuth metadata follows forwarded headers. With it, the advertised URLs and the Secure cookie are pinned. If the user adds a custom domain later, add Railway's CNAME and TXT records, then change `PUBLIC_ORIGIN` to the custom origin.
- [ ] Checks after deploy:
    - `curl https://<domain>/health` returns `ok`.
    - `GET /` serves the login page.
    - `/.well-known/oauth-authorization-server` advertises URLs on `PUBLIC_ORIGIN`.
    - The deploy logs show no Supabase errors.

## 4. First user, household, second member

Follow `docs/self-hosting.md`, "First-user flow".

- [ ] The owner opens `/`, signs up with email and password, then submits **Create household**.
- [ ] In Supabase, turn **Allow new users to sign up** off. Members are created through the admin API, which ignores it.
- [ ] A second sign-up email at `/` is refused ("Wrong email, username or password.").
- [ ] The owner adds the second person in **Settings → Household** (`/settings/household`). That person signs in.
- [ ] Connect each person's AI client to `https://<domain>/mcp` and complete OAuth. Remove any old Foodable or nutrition-mcp connection from those clients, because it points at the old deploy.

## 5. The walk

This is Cursor's end-to-end walk, run on the live site with two members. Capture a screenshot or tool output for each line.

- [ ] **Foods.** On `/settings/foods`, save **Eggs** with grams per each and calories per 100 g. Save **Toast** the same way.
- [ ] **Food-backed meal.**
    - On `/`, set Meal type to Breakfast.
    - Add Eggs: amount 2, unit each. Use **Add another food** for Toast: amount 1, unit each. Submit **Log meal**.
    - Expect the meal total to equal the sum of the item snapshots.
- [ ] **Snapshot.** Change the egg calories on `/settings/foods`. Expect the logged breakfast to keep the old total.
- [ ] **Recipe to grocery.**
    - On `/recipes`, save a recipe that uses eggs. Put a note on an ingredient and a tag on the recipe.
    - Submit **Add to grocery**. Expect only what is not already stocked to be added.
- [ ] **Put away.** On `/grocery`, check that line and submit **Put away**. Expect `/fridge` to show the new stock. (**Clear checked** deliberately does not stock the fridge.)
- [ ] **Cook.** On the recipe, submit **Cooked it** with **Log meals** checked, for both members. Expect:
    - The fridge count drops, and two meals appear, one per member.
    - If stock is short, the shortfall is reported and the fridge does not go negative.
    - With two lots of the same food, the earlier expiry is used first.
- [ ] **Eat and toss.** On `/fridge`, submit **Ate it** on one item and **Toss** on another. Expect **Ate it** to also log a meal.
- [ ] **Export.** Run `export_all_data`. Expect:
    - The ZIP holds `meals.csv`, `meal_items.csv`, `water.csv`, `weight.csv`, `goals.csv`, `profile.csv` and `README.txt`.
    - `meal_items.csv` is keyed by `meal_id`, has a `timezone` column, and keeps its header with zero rows.
- [ ] **Agent surface.**
    - `tools/list` returns 67 tools.
    - `get_meals`, `get_water`, `get_weight`, `get_fridge`, `get_household_rules` and `set_household_rules` exist. The old split names are gone.
    - `list_grocery_lines` and `get_fridge` render their cards in a widget-capable client.
- [ ] **Barcode.** `lookup_barcode` on a real product returns data, which proves `OFF_USER_AGENT` is set.

Manual fridge add, edit and delete write `adjust` movements since #50, so after each step every item's stock should match its ledger.

## 6. Retire the old deploy

The decision is to delete all old user data. Confirm with the user once, right before each step below.

- [ ] Shut down the old server, wherever the user says it runs.
- [ ] Delete the old Supabase project from its project settings in the dashboard. Deleting the project removes its Auth users, data, and storage together. No export or dump of it is wanted.
- [ ] Revoke anything that still points at the old deploy: OAuth connections in AI clients, and any DNS record for the old host.

## 7. Repo follow-up (after launch)

- [ ] Update the status sections here and in `docs/handoff/foodable-architecture-plan.md` with the deploy date, the Railway domain and the walk result.
- [ ] Update the memory or notes the user keeps on hosting: Railway, chosen 2026-10-05, "for now". (After Railway exists.)

## 8. After launch, in order

1. ~~**Ledger gap.**~~ Done in #50 (2026-10-06).
2. ~~**Old-name leftovers.**~~ Done in #49 (2026-10-06). The repo is now renamed, so the remaining repo URLs (`package.json` `homepage` / `repository`, the clone commands in `README.md` and `docs/self-hosting.md`, and `CLAUDE.md`) can move to `MrF1ow/foodable`. The old URL redirects, so this is not a deploy blocker.
3. **Phase 8 (contract)** once the deploy has run stably, after a fresh backup. With a fresh start there is no legacy `identity` data to worry about, only rows written since launch.
4. **Gated items** when the user decides: the optional weekly household digest. (The repo rename is done, and the logo is in #61.)

## Notes on `db:dryrun` from here

Fixture mode (`bun run db:dryrun`) stays useful as is. It applies everything before `DEFAULT_PENDING_FROM`, seeds the fixture, then applies every later migration, including any added after launch, and checks the backfill. Leave `DEFAULT_PENDING_FROM` alone. For a dry run on real data before a future push, dump the new project with `pg_dump --data-only --schema=public`. Then pass `--pending-from <first unapplied version>` along with `--data`.
