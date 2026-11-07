# Staging environment and feature flags: plan

Status: proposed 2026-11-05. Moved out of [ROADMAP.md](../ROADMAP.md) on 2026-11-07.

The last item on the roadmap. Add a `staging` environment in the same Railway project that deploys every commit on main, and stop production deploying on its own: a release goes out only after it has run on staging. New features ship dark behind Railway feature flags and are switched on without a deploy. Checked against the Railway docs on 2026-11-05 ([Environments](https://docs.railway.com/environments), [Feature Flags](https://docs.railway.com/feature-flags)).

## Environments

- Create `staging` with **Duplicate Environment** from production. That copies services, variables and settings, but not sealed variables, and not data: staging gets its own Postgres, volume and domain.
- Staging's app service tracks `main` with auto-deploy and "wait for CI". Production stops auto-deploying. It either deploys a chosen commit by hand or tracks a `production` branch that is fast-forwarded to the release tag (`v<version>`, from `bun run release`). Pick one when this ships. The branch is easier to audit.
- Migrations run as the pre-deploy command in both environments, so every migration reaches staging's database first. That is the main reason to have staging at all.
- Variables that must differ: `DATABASE_URL`, `PUBLIC_ORIGIN` and the domain, and the session secret, so a staging session or export token is never valid on production. Agents connect to staging over OAuth separately.
- Staging data: either the fixture data (`scripts/migration-dryrun/seed.sql`), or a copy of production made with `bun run db:import-postgres` into an empty database at the same migration version. A copy is the household's real data, and it stays on staging until it is wiped.
- Later changes to services or variables go through **Sync** (staging into production), which lists every new, edited and removed service before it deploys.
- PR environments stay off. A second app and database per pull request costs more than it helps one household.

## Feature flags

Railway flags are typed (`bool`, `string`, `number`, `json`), managed under Project Settings › Feature Flags, with `railway flag` or with the Railway MCP tools, and read at runtime through the `railway` TypeScript SDK. The SDK keeps the registry in memory and refreshes it in the background, so a read is synchronous and makes no network call. Flags are not environment variables: anything static per environment (secrets, URLs) stays a variable.

- **One registry for both environments.** Flags belong to the project, not to an environment. Each read therefore passes `env` (from `RAILWAY_ENVIRONMENT_NAME`) in the context, and a rule such as `env == "staging"` turns a feature on in staging while the default keeps it off in production. Switching it on in production means changing the default or adding a production rule. No deploy is needed.
- **Who sees it.** The context `key` is the member's `user_id`, so a flag can turn a feature on for one member first (`key == "<id>"`). Percentage rollouts are pointless for one household.
- **One adapter.** `src/flags.ts` is the only file that imports the SDK. It holds a typed list of every flag with its code-side fallback and calls `flags.init()` once at boot (a project token in `RAILWAY_TOKEN`). The rest of the code calls something like `isEnabled("calendar-view", actor)` and never sees Railway. Tests use an in-memory version, like the domain stores.
- **Works without Railway.** Self-hosters may not deploy on Railway, and `bun run src/index.ts` locally has no token. Without `RAILWAY_TOKEN` the adapter skips `init()` and every read returns its fallback. A fallback is the conservative value (off). A flag that cannot be read never turns on a half-built feature, and the server never fails to boot because of a missing flag.
- **What a flag gates.** New web routes and tabs, new MCP tools, and the "switch" step of expand, backfill, switch, contract: the code that starts reading a new shape. A schema change is never behind a flag, because migrations always run. A gated MCP tool is not registered while its flag is off, so `tools/list` changes with the flag. `src/mcp/tools-list.snapshot.json` pins the full list with every flag on, and a test checks that the flag-off list is that list minus the gated tools.
- **Kill switches.** A `bool` flag can turn off something that calls out to the internet (recipe link reading, Open Food Facts lookups) without a deploy if it starts failing or a platform objects. These are different from household settings such as the per-platform social reader opt-ins in [recipe-import-plan.md](./recipe-import-plan.md): a household setting is the household's choice and lives in Postgres, a flag is the operator's.
- **Flags are temporary.** Once a feature is on everywhere and has stayed on, delete the check from the code, then delete the flag. Kill switches are the exception and stay. Each flag in `src/flags.ts` notes why it exists.
- Pin the `railway` SDK version only after checking the current release when this is built (`CLAUDE.md`, "Quality and Safety Rules").
