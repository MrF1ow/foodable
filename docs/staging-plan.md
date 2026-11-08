# Staging environment and feature flags: plan

Status: proposed 2026-11-05. Moved out of [ROADMAP.md](../ROADMAP.md) on 2026-11-07.

Add a `staging` environment in the same Railway project that deploys every commit on main, and stop production deploying on its own: a release goes out only after it has run on staging. New features ship dark behind Railway feature flags and are switched on without a deploy. Checked against the Railway docs on 2026-11-05 ([Environments](https://docs.railway.com/environments), [Feature Flags](https://docs.railway.com/feature-flags)).

## Environments

- Create `staging` with **Duplicate Environment** from production. That copies services, variables and settings, but not sealed variables, and not data: staging gets its own Postgres, volume and domain.
- Staging's app service tracks `main` with auto-deploy and "wait for CI". Production stops auto-deploying. It tracks a `production` branch that is fast-forwarded to the release tag (`v<version>`, from `bun run release`), decided 2026-11-08 (STG-2): the branch is easier to audit than deploying a chosen commit by hand.
- Migrations run as the pre-deploy command in both environments, so every migration reaches staging's database first. That is the main reason to have staging at all.
- Variables that must differ: `DATABASE_URL`, `PUBLIC_ORIGIN` and the domain, and the session secret, so a staging session or export token is never valid on production. Agents connect to staging over OAuth separately.
- Staging data: either the fixture data (`scripts/migration-dryrun/seed.sql`), or a copy of production made with `bun run db:import-postgres` into an empty database at the same migration version. A copy is the household's real data, and it stays on staging until it is wiped.
- Later changes to services or variables go through **Sync** (staging into production), which lists every new, edited and removed service before it deploys.
- PR environments stay off for now: a second app and database per pull request costs more than it helps while one team works on Foodable.

## Feature flags

Revised 2026-11-08: flags are designed as if Foodable had thousands of users, not one household. The redesign ([redesign-plan.md](./redesign-plan.md)) and the chat widgets ([chat-widgets-plan.md](./chat-widgets-plan.md)) ship through them.

Railway flags are typed (`bool`, `string`, `number`, `json`), managed under Project Settings › Feature Flags, with `railway flag` or with the Railway MCP tools, and read at runtime through the `railway` TypeScript SDK (`flags.getBoolean(name, context, fallback)`, or `evaluateBoolean` for the reason). The SDK keeps the registry in memory and refreshes it in the background (about every 10 s while busy, 5 min when idle), so a read is synchronous and makes no network call. Flags are not environment variables: anything static per environment (secrets, URLs) stays a variable. Checked against the SDK source, `railway@3.16.0`, on 2026-11-07.

Three SDK facts shape the design:

- **A failed refresh makes every read return its fallback.** The SDK marks its registry stale and answers `STALE` until a refresh succeeds; a failed `init()` does the same. Our adapter therefore keeps its own last-known values (below).
- **When matching rules disagree, the default wins.** So every rule on a flag serves `true` and the default is `false`; a flag never mixes "on for X" with "off for Y". Kill switches are separate flags.
- **Named lists resolve to empty in the public SDK**, and no audit log is documented for flag changes. Tester groups live in our Postgres and are passed as attributes; rules live in git.

### Context

Every read passes the same context, built in `src/flags.ts` from the actor:

| Attribute          | Value                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `key`              | `user_id`; `hh:<household_id>` for household-token MCP callers and background jobs (as `rateLimitKey`) |
| `household_id`     | The member's household                                                                                 |
| `env`              | `RAILWAY_ENVIRONMENT_NAME`, or `local`                                                                 |
| `groups`           | Comma-wrapped group names, for example `,internal,beta,`                                               |
| `role`             | `owner`, `admin` or `member`                                                                           |
| `cohort`           | `hash(user_id) % 100`, the same for every flag                                                         |
| `household_cohort` | `hash(household_id) % 100`                                                                             |
| `client`           | `web`, or the MCP client when known; for logs only, never for targeting (tokens carry no client yet)   |
| `app_version`      | `VERSION` from `src/version.ts`                                                                        |

Each flag declares its unit, `user` or `household`. Anything that acts on shared household data uses `household` and rolls out on `household_cohort`, so a household moves together.

### The adapter

`src/flags.ts` is the only file that imports the SDK (a test enforces it). It holds a typed registry: name, type, `kind` (`temporary` or `kill-switch`), unit, parent flag, fallback, why it exists and when it can go. Temporary flags fall back to off; kill switches fall back to **on**, because they guard features that already work. `initFlags()` runs once at boot with `required: false` and a timeout, so the server never fails to boot because of flags. Tests use an in-memory version, like the domain stores. Web pages get plain booleans in their view model (`flags` on `AppChromeBase`); MCP gets them on `ToolContext`, loaded in `buildMcpServer`'s existing `Promise.all`.

### Consistency and last-known values

- **Sticky pins.** Every temporary flag is pinned per subject in `flag_assignments` the first time it is evaluated from a fresh registry, and the pin holds for 12 hours or until the flag's epoch changes. Web and MCP read the same pin, so a member sees the same answer everywhere and `tools/list` does not change mid-conversation. Pins are cached in memory per subject (`createTtlCache`), so a request makes no extra query. The site session is a signed user id with no session row, so pins are per user, not per session.
- **No flicker.** A shell change also changes the content-hashed asset URLs, which Turbo tracks, so the page reloads once instead of morphing.
- **Rollback.** A numeric `flags-epoch` (global or per flag) makes every pin re-evaluate on its next read.
- **Railway unreachable.** Sticky flags serve existing pins; a subject with no pin gets the fallback and no pin is written. Kill switches are never pinned: they serve the last value in memory, then the last value saved in `flag_snapshot`, then their fallback.

### Who is on a flag

- **Internal** is a list of account IDs in `flags/rollout.yml`, starting with the owner's, expanded into each flag's internal rule (`key == "…"`). It lives in Railway, not in our database; git is its audit trail.
- **Beta** is the one group the app writes: members join or leave it themselves in Settings › "Try new features", stored in `flag_beta_members` with an append-only `flag_beta_events`, and passed as the `groups` attribute. Any member can join, for themselves only. Joining clears that member's pins, so it applies at once. No deploy.
- **Rules in git.** `flags/rollout.yml` holds each flag's default and rules and the internal list; `bun run flags:apply` (the `railway flag` CLI) runs from CI when it changes on main, and a drift check compares Railway with the file. Emergency kills are flipped directly in Railway and recorded in the file afterwards.

### A flag's life

All rules serve `true`. 0, merged dark (default `false`, flag-off tests green). 1, staging: `env == "staging"`. 2, internal: `env == "production" && (key == "<owner id>" || …)`, expanded from the internal list. 3, beta: `groups contains ",beta,"`. 4, percentage: `cohort < 10`, then 25 and 50 (`household_cohort` for household flags). 5, everyone: default `true`, rules removed, then a soak of one release with no rollback. 6, a PR removes the check and the old path (this is when self-hosters get it). 7, the flag is deleted in Railway, only after step 6 is deployed. Kill switches stop at step 5 and stay; turning one off takes effect within one refresh.

### What a flag gates

New web routes and tabs, new MCP tools, and the "switch" step of expand, backfill, switch, contract. A schema change is never behind a flag, because migrations always run. Writes are never gated and keep the whole record. A gated route is declared through `gatedRoute`, a gated tool through `gatedTool`; tests check that every gated route answers a redirect or 404 with its flag off, that the flag-off tool list is the snapshot minus the gated tools, and that every page renders with flags all on, all off, and parents on with children off.

### Metrics

Evaluations are counted in memory per flag, value, reason and client, and written once a minute (a log line and `flag_eval_daily`), never one row per read. `STALE`, `CONFLICT` and `NOT_FOUND` log a warning.

### Without Railway

Self-hosters and local runs without `RAILWAY_TOKEN` get every temporary flag off and every kill switch on: today's app, until a release removes a flag. `FOODABLE_FLAGS`, read only without a token, lets an owner switch features on for a group (`ui-v2:internal`, where internal means the deploy's owner accounts) or everyone (`usuals-tab:all`), decided in STG-11. `.env.example` and `docs/self-hosting.md` document both.

Pin the `railway` SDK version only after checking the current release when this is built (`CLAUDE.md`, "Quality and Safety Rules").
