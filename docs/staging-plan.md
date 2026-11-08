# Feature flags, and staging later: plan

Status: proposed 2026-11-05. Moved out of [ROADMAP.md](../ROADMAP.md) on 2026-11-07.

**Staging is a follow-up after the redesign** (decided 2026-11-08). There is no paid Railway staging environment until the redesign is finished, so it is not part of the redesign plan. Until then production keeps auto-deploying `main` after CI, migrations are rehearsed on a copy of production data (`bun run db:dryrun --data`, item STG-12), and a flag goes on locally first, then for the owner's account in production. Feature flags stay in the plan: new features ship dark behind Railway feature flags and are switched on without a deploy.

The later staging environment: a `staging` environment in the same Railway project that deploys every commit on main, with production no longer deploying on its own, so a release goes out only after it has run on staging. Checked against the Railway docs on 2026-11-05 ([Environments](https://docs.railway.com/environments), [Feature Flags](https://docs.railway.com/feature-flags)).

## Environments (later, STG-1)

None of this exists yet; it is the follow-up once the redesign is finished.

- Create `staging` with **Duplicate Environment** from production. That copies services, variables and settings, but not sealed variables, and not data: staging gets its own Postgres, volume and domain.
- Staging's app service tracks `main` with auto-deploy and "wait for CI". Production stops auto-deploying. It tracks a `production` branch that is fast-forwarded to the release tag (`v<version>`, from `bun run release`), decided 2026-11-08 (STG-2): the branch is easier to audit than deploying a chosen commit by hand. It applies only once staging exists.
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

- **Sticky pins.** Every temporary flag is pinned per subject in `flag_assignments` the first time it is evaluated from a fresh registry, and the pin holds for 12 hours or until the epoch changes. Web and MCP read the same pin, so a member sees the same answer everywhere and `tools/list` does not change mid-conversation. Pins are cached in memory per subject (`createTtlCache`, bounded), so a request makes no extra query; a pin the process writes is persisted in the background and a failure is logged, never thrown into the request. The site session is a signed user id with no session row, so pins are per user, not per session. A household-token caller has no user, so a user-unit flag is never pinned for it. Pins apply only to the Railway source: env, fallback and memory readers answer from their own rules with no query, so a changed `FOODABLE_FLAGS` applies on restart. An evaluation a pin served has reason `PINNED`.
- **No flicker.** A shell change also changes the content-hashed asset URLs, which Turbo tracks, so the page reloads once instead of morphing.
- **Rollback.** The epoch is the global numeric Railway flag `flags-epoch` (default 0, no rules, not in `FLAGS`). Bump it and every pin written under another epoch re-evaluates on its next reliable read. A missing flag reads as epoch 0; a value that is not an integer from 0 up, or an unreliable read, leaves the epoch unknown (pins keep serving, none is written).
- **Railway unreachable.** The SDK answers every read with its fallback after one failed refresh (reason `STALE`), so only a reliable read (`isReliable`) is ever pinned. Sticky flags serve existing pins; a subject with no pin gets the fallback and no pin is written. Kill switches are never pinned: they serve the last reliable value in memory (per flag, process-wide), then the last value saved in `flag_snapshot`, then their fallback; those served from memory or the snapshot have reason `LAST_KNOWN`. The snapshot is written only when a reliable Railway value differs from the last known one. Expired pins are swept every 10 minutes, on the export cleanup cadence (`startFlagPinSweep`); `flag_snapshot` is never swept, since it has to outlive an outage. Kill switches must be global (no per-subject rules): the memory and the snapshot hold one value per flag, so a per-subject rule would serve one subject's value to another during an outage and rewrite the snapshot whenever two subjects alternate.
- **Clearing.** `clearPins(subject)` in `src/flag-pins.ts` deletes a subject's rows and cache entry (joining the beta calls it, STG-6); a request already in flight for that subject does not write its pin back. The pin cache is per process: with more than one replica, a clear or a new pin reaches the others within the cache TTL (5 minutes).

### Who is on a flag

- **Internal** is a list of account IDs in `flags/rollout.yml`, starting with the owner's, expanded into each flag's internal rule (`key == "…"`). It lives in Railway, not in our database; git is its audit trail.
- **Beta** is the one group the app writes: members join or leave it themselves in Settings › "Try new features", stored in `flag_beta_members` with an append-only `flag_beta_events`, and passed as the `groups` attribute. Any member can join, for themselves only. Joining clears that member's pins, so it applies at once. No deploy.
- **Rules in git.** `flags/rollout.yml` holds each flag's default and rules and the internal list; `bun run flags:apply` (the `railway flag` CLI) runs from CI when it changes on main, and a drift check compares Railway with the file. Emergency kills are flipped directly in Railway and recorded in the file afterwards.

### A flag's life

All rules serve `true`. 0, merged dark (default `false`, flag-off tests green). 1, local: `env == "local"`, a development run with a `RAILWAY_TOKEN`. 2, the owner's account in production, then the rest of internal: `env == "production" && (key == "<owner id>" || …)`, expanded from the internal list. 3, beta: `groups contains ",beta,"`. 4, percentage: `cohort < 10`, then 25 and 50 (`household_cohort` for household flags). 5, everyone: default `true`, rules removed, then a soak of one release with no rollback. 6, a PR removes the check and the old path (this is when self-hosters get it). 7, the flag is deleted in Railway, only after step 6 is deployed. Kill switches stop at step 5 and stay; turning one off takes effect within one refresh.

### What a flag gates

New web routes and tabs, new MCP tools, and the "switch" step of expand, backfill, switch, contract. A schema change is never behind a flag, because migrations always run. Writes are never gated and keep the whole record. A gated route is declared through `gatedRoute` (`src/web/gated.ts`), a gated tool through `gatedTool` (`src/mcp/gated.ts`); `src/test-support/flag-harness.ts` holds the checks, and they already run over everything: `src/web/gated-routes.test.ts` finds every `gatedRoute` in the composed app (through `app.routes`) and requests it with its flag off, and `src/mcp.test.ts` builds `registerTools` with flags off and compares against the snapshot minus `ctx.gatedTools`. A new gated route or tool gets its flag-off tests without writing any. Tests check that every gated route answers a redirect or 404 with its flag off, that the flag-off tool list is the snapshot minus the gated tools, and that every page renders with flags all on, all off, and parents on with children off.

### Metrics

Evaluations are counted in memory per flag, value, reason and client, and written once a minute (a log line and `flag_eval_daily`), never one row per read. `STALE`, `CONFLICT` and `NOT_FOUND` log a warning.

### Without Railway

Self-hosters and local runs without `RAILWAY_TOKEN` get every temporary flag off and every kill switch on: today's app, until a release removes a flag. `FOODABLE_FLAGS`, read only without a token, lets an owner switch features on for a group (`ui-v2:internal`, where internal means the deploy's owner accounts) or everyone (`usuals-tab:all`), decided in STG-11. `.env.example` and `docs/self-hosting.md` document both.

Pin the `railway` SDK version only after checking the current release when this is built (`CLAUDE.md`, "Quality and Safety Rules").
