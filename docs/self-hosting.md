# Self-hosting Foodable

Foodable is a single-household deploy. It is not a public hosted service. You run the Bun server yourself and point it at Postgres through `DATABASE_URL`.

Clone [https://github.com/MrF1ow/foodable](https://github.com/MrF1ow/foodable), copy `.env.example` to `.env`, fill in the values below, apply the migrations, and start the server. The old `MrF1ow/nutrition-mcp` URL redirects here.

```bash
git clone https://github.com/MrF1ow/foodable.git
cd foodable
bun install
cp .env.example .env
bun run generate-oauth-creds   # paste into .env
bun run db:migrate             # needs DATABASE_URL in .env
bun src/index.ts               # http://localhost:8080
```

`GET /health` returns `ok` when the process is up.

## Running more than one instance

You can run several Foodable processes behind a load balancer as long as they share one `DATABASE_URL` and the same environment variables for secrets and feature flags. Each process keeps its own in-memory caches; authoritative state lives in Postgres.

**Shared in Postgres (every instance sees the same data):**

- Household data (meals, foods, fridge, grocery, recipes, goals, and the rest of the `public` schema)
- OAuth login sessions (`oauth_login_sessions`), including the short-lived site approve flow
- Rate-limit windows and authentication bans (`rate_limit_*`)
- Sticky flag pins and kill-switch snapshots (`flag_pins`, `flag_snapshots`)
- Recipe fetch memory (host refusals and dead links)
- Agent activity (`agent_actions`): what an AI agent deleted, cleared or overwrote, with a snapshot for undo until it is purged
- Export download archives, notices, and every other table the app writes

**Per instance by design (safe to differ between processes):**

- Assembled widget HTML, `/app.css`, `/app.js`, `/app-v2.css`, `/app-v2.js`, and related boot caches (same bytes on every instance for the same deployment)
- Flag pin and snapshot **read caches** (about five minutes TTL; Postgres remains source of truth)
- Recipe fetch **LRU** over refusals and dead links (about five minutes per entry; Postgres remains source of truth)
- Parsed client-IP configuration (from env, fixed for the life of the process)
- The feature-flag reader loaded at boot (Railway or `FOODABLE_FLAGS`)
- Database connection pool (`Bun.sql`) and request-scoped transaction context

`GET /robots.txt` reads the file from disk on each request; there is no in-memory cache.

**Background sweeps** (export archives, login sessions, rate limits, flag pins, unverified recipes, fetch-memory expiry, automatic restock checks, agent-action snapshot purge) start on every instance. Each sweep uses overlap guards so one process does not run two ticks at once. Deletes and expirations target Postgres rows idempotently, so concurrent sweeps on different instances are safe.

## Database

Foodable talks to Postgres through `DATABASE_URL` and nothing else. Any Postgres works: Railway, Neon, RDS, a local `initdb` cluster, or the Docker Compose service below. The app owns its user accounts (`public.users`), so there is no separate auth service to run.

### Row level security and `DATABASE_APP_URL`

Every transaction tells Postgres who is acting: a signed-in user, the household bot token, or the system. Row level security policies (in `db/migrations/`) use that to keep each household's rows, and each person's own logs, out of anyone else's reach. They bind only the `foodable_app` role, which the migrations create without a password. The app connects with two pools:

- **App pool**, `DATABASE_APP_URL`: everything done for a user or the household token. Point it at the same database as the `foodable_app` role.
- **Owner pool**, `DATABASE_URL`: work the system does (sign-up and sign-in, OAuth, rate limits, the background sweeps), which no household boundary applies to. Migrations always run with `DATABASE_URL`.

To turn it on, set the role's password once as the owner, then set the variable and redeploy:

```bash
psql "$DATABASE_URL" -c "alter role foodable_app password '<a long random password>'"
# DATABASE_APP_URL = DATABASE_URL with foodable_app:<that password> as the user and password
```

When `DATABASE_APP_URL` is unset, both pools use `DATABASE_URL` and the policies are not enforced: that is the state before you set it, and unsetting it is the rollback. The server logs at boot which one it uses (it never prints the URL). A transaction that names no actor fails instead of running as nobody.

### How migrations work

The schema lives only in `db/migrations/`, one SQL file per change, named `<14-digit timestamp>_<snake_case>.sql`. Apply them with:

```bash
bun run db:migrate          # apply every pending file
bun run db:migrate --list   # show applied and pending, change nothing
```

The runner (`src/db/migrate.ts`) does this, in order:

1. If the `auth` schema is missing, it runs `db/bootstrap.sql` first. The early migrations were written for Supabase and expect the `anon`, `authenticated` and `service_role` roles, a stub `auth.users`, `auth.uid()`, and a `storage` schema. The bootstrap creates only what is missing, so it is a no-op on a database that already has them.
2. It reads the applied versions from `foodable_migrations.schema_migrations`. A database first migrated by the Supabase CLI, or by this runner before the rename, has that table under `supabase_migrations`; the first real migrate renames the schema in place, so those versions are not applied again. `--list` reads whichever one exists and renames nothing.
3. It refuses to run when a recorded version has no file on disk ("Migration history diverged"). Never delete or rename a migration that has been applied anywhere.
4. It applies each pending file in its own transaction and records the version in the same transaction. A failure rolls that file back, keeps the earlier ones, and stops. A file that contains its own `begin` / `commit` is rejected before anything runs.

Do not skip migrations, and do not change the schema by hand: schema changes ship only in those files.

### Upgrading an existing deploy

Update to a [release](https://github.com/MrF1ow/foodable/releases) rather than whatever is on `main`. Releases are cut at points where every migration and the code that needs it have both landed. Read the notes first: the **Breaking changes** and **Contract migrations** sections list what can affect your data. From a fork:

```bash
git fetch upstream --tags
git merge v0.2.0   # the release you are updating to
```

A deploy that used the old `railway.toml` must, before it pushes the release that removes `railway.toml`, edit `.railway/railway.ts` (repo, region, service name, domains), run `railway config plan`, then `railway config apply`. Otherwise it loses the Dockerfile build and the health check. Pushing `main` is what deploys:

```bash
git push origin main
```

1. Back up. Take a host snapshot or `pg_dump`, and run `export_all_data` for each member as a second copy.
2. Dry-run the pending migrations against a copy of your data, locally:

    ```bash
    pg_dump "$DATABASE_URL" --data-only --schema=public -f prod-data.sql
    bun run db:dryrun --data prod-data.sql --pending-from <version>
    ```

    `<version>` is the first migration your database has not applied (`bun run db:migrate --list` shows it). This uses a throwaway local Postgres and never touches the remote database. Set `PG_BIN` if `initdb` is not on your `PATH`.

3. Apply migrations, then run the matching code. The new code expects the new schema, so do not run it first. On Railway the pre-deploy command does this for you (see [Railway](#railway)).

### Rehearsing migrations on a production copy

There is no staging deploy yet, so every pull request that adds a migration is rehearsed on a copy of production's data before it merges. On Railway, where Postgres is internal-only, one command does it:

```bash
bun run db:rehearse            # needs the Railway CLI, logged in, and an ssh key Railway knows
bun run db:rehearse --list     # only print what production has not applied
```

It reads production's applied versions from `foodable_migrations.schema_migrations` and compares them with `db/migrations/`. When nothing is pending it says so and stops. Otherwise it streams a data-only `pg_dump` of the `public` schema from the `Postgres` service container (`railway ssh`; both calls only read) into a fresh private directory outside the repo (mode 700, dump 600) and runs `db:dryrun --data <dump> --pending-from <first pending>`. The throwaway cluster lives in the same directory, and the directory is deleted when the run ends, on success, failure or Ctrl-C.

Flags: `--key <path>` is the ssh identity (default `~/.ssh/id_github_personal`); `--project`, `--service` and `--environment` name a different deploy (defaults: this deploy's project, `Postgres`, `production`). There is no `--pending-from`: the dump carries production's current schema, so it only loads into a baseline that stops exactly where production does. It fails, without dumping, when the checkout is behind production (rebase) or when a new migration sorts before one production already has (renumber it).

The dump is the household's real data. Never copy it elsewhere, and never paste rows or failing statements' values into a pull request or an issue: the repository is public. Report counts and pass or fail only. The `foods` circular foreign key warning from `pg_dump` is harmless here.

### Local Postgres (no Docker)

For day-to-day development, use a persistent local cluster:

```bash
bun run db:dev init          # creates ~/.local/share/foodable/pg, migrates, prints DATABASE_URL
# paste DATABASE_URL into .env (default port 54330, database foodable)
bun --watch src/index.ts
```

Override paths with `FOODABLE_PG_DIR` and `FOODABLE_PG_PORT` (default **54330**, clear of the Supabase CLI's **54321–54324** in case an old local stack is still around; the migration dry run picks a free port unless you set `PG_DRYRUN_PORT`). Logs live in `postgres.log` inside the data directory. Other commands: `start`, `stop`, `status`, `url`, `migrate`. Set `PG_BIN` when `initdb` is not on your `PATH`.

**Docker Compose** alternative (Postgres 17 + app):

```bash
cp .env.example .env         # fill OAuth secrets
docker compose up --build
```

A one-shot `migrate` service runs `bun run db:migrate` before the app starts.

### Moving data between databases

`db:import-postgres` copies the `public` data of one migrated Postgres into another. Use it to move hosts, or to pull a copy of production into local development:

1. Bring both databases to the same migration version (`bun run db:migrate` against each).
2. Initialize the target if it is local (`bun run db:dev init`).
3. Copy:

    ```bash
    bun run db:import-postgres --from "$OLD_DATABASE_URL" [--to "$NEW_DATABASE_URL"]
    bun run db:import-postgres --from "$OLD_DATABASE_URL" --check-only   # preconditions only
    ```

`--to` defaults to the `db:dev` database. The importer refuses when the two URLs name the same database, when the migration histories differ (it reads `foodable_migrations`, or `supabase_migrations` on a source that has not been migrated since the rename), or when the target already has rows. The source is only read. It reports row counts per table and checks that every password hash came across. The same steps move a database off an old Supabase project: its session pooler URL is just another `--from`.

**systemd user unit** to start Postgres at login (adjust paths):

```ini
[Unit]
Description=Foodable dev Postgres
After=network.target

[Service]
# db:dev start returns once Postgres is up; a oneshot unit that remains
# "active" keeps the server running in its cgroup until ExecStop.
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/path/to/foodable
# systemd's user PATH often lacks a version manager's Postgres (mise, asdf):
# point PG_BIN at the directory that holds initdb and pg_ctl.
Environment=PG_BIN=/path/to/postgres/bin
ExecStart=/usr/bin/bun run db:dev start
ExecStop=/usr/bin/bun run db:dev stop

[Install]
WantedBy=default.target
```

### Merging duplicate foods

`bun run foods:merge-duplicates` merges foods that are certainly the same: same household, same kind, both live, not a product, the same name once case and punctuation are ignored ("All purpose flour" and "all-purpose flour"), and the same brand (or both none). A group of three spellings becomes one food.

- **Which row is kept:** the one with the most references (fridge items, grocery lines, recipe ingredients, meal items, stock movements), then the oldest, then the lower id. Everything moves to it, and the dropped name becomes another name for it.
- **What is filled:** a field known on one row only (nutrition, grams per each, grams per ml, default unit) is copied to the kept row. Allergens are combined.
- **What is skipped and listed:** pairs that disagree. A unit factor or default unit set differently on both rows (a blank unit counts as grams). Nutrition on both rows that is not identical, field for field, including which fields are unknown. Both rows having products, or both having a usual product. A dropped name that is already another food's name.
- **Never merged:** plurals ("egg" / "eggs"), synonyms, word-order variants, different brands or kinds, products and archived rows.

It is not a migration and does not run on deploy. Run the dry run first: it prints each kept row and why, each dropped row, the fields that will be filled and every skipped pair with its reason, and writes nothing. Review it, then apply:

```bash
bun run foods:merge-duplicates          # dry run (default)
bun run foods:merge-duplicates --apply  # merge exactly what the dry run listed
```

On Railway, prefix both with `railway run`. `--json` prints the report as JSON. Each merge is its own transaction; a failed merge is reported and the rest continue, and a second `--apply` finds nothing to do. Reverting the code does not undo merges already applied.

### Finding slow queries

Production Postgres keeps two records of query time: the `pg_stat_statements` extension (totals per query shape) and the server log, which records every statement slower than 200 ms. Start performance work from these, not from guesses.

Enable them once per database. `pg_stat_statements` must be in `shared_preload_libraries` (Railway's Postgres image already lists it; elsewhere add it and restart Postgres). The slow log needs only a reload:

```sql
create extension if not exists pg_stat_statements;
alter system set log_min_duration_statement = '200ms';
-- Never write bound values to the log: they include login tokens.
alter system set log_parameter_max_length = 0;
alter system set log_parameter_max_length_on_error = 0;
select pg_reload_conf();
```

On Railway the database is internal-only, so run psql inside the Postgres service container (`<project-id>` is your Railway project):

```bash
# the ten query shapes with the most total time
railway ssh -p <project-id> -s Postgres -e production -- \
  'psql "$DATABASE_URL" -c "select calls, round(total_exec_time) as total_ms, round(mean_exec_time::numeric, 1) as mean_ms, left(query, 120) as query from pg_stat_statements order by total_exec_time desc limit 10"'

# confirm the slow log is on
railway ssh -p <project-id> -s Postgres -e production -- \
  'psql "$DATABASE_URL" -c "show log_min_duration_statement"'
```

Slow statements appear in the Postgres service's logs as `duration: … ms  statement: …` (Railway dashboard, or `railway logs -s Postgres`). `select pg_stat_statements_reset()` starts the totals over, for example after a fix ships.

The reads the household pages depend on (fridge, grocery, recipes, food catalog) have plan tests in `src/db/indexes.test.ts`: a change that makes one of them stop using its index fails CI.

## Environment variables

| Variable                | Required     | Purpose                                                                                                                     |
| ----------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | yes          | Postgres connection string                                                                                                  |
| `DATABASE_APP_URL`      | recommended  | The database as `foodable_app`, so row level security applies (see [Database](#database))                                   |
| `OAUTH_CLIENT_ID`       | yes          | MCP OAuth client id (`bun run generate-oauth-creds`)                                                                        |
| `OAUTH_CLIENT_SECRET`   | yes          | MCP OAuth client secret                                                                                                     |
| `SESSION_SECRET`        | production   | Site cookie HMAC (min 32 chars; `generate-oauth-creds`). Setting it on a live deploy logs everyone out of the web app once. |
| `OFF_USER_AGENT`        | for barcodes | Open Food Facts User-Agent, `Foodable (you@example.com)`                                                                    |
| `PORT`                  | no           | Listen port, default `8080`                                                                                                 |
| `PUBLIC_ORIGIN`         | production   | Canonical public origin, `https://foodable.example.com`                                                                     |
| `ALLOWED_ORIGINS`       | no           | Extra CORS origins, comma-separated. Localhost is already allowed.                                                          |
| `ALLOWED_REDIRECT_URIS` | no           | Extra OAuth redirect URIs (comma-separated), exact match after URL normalization                                            |
| `RAILWAY_TOKEN`         | no           | Railway project token for feature flags (see [Feature flags](#feature-flags) below)                                         |
| `FOODABLE_FLAGS`        | no           | Self-hosted flag overrides when `RAILWAY_TOKEN` is unset (see [Feature flags](#feature-flags))                              |

`PUBLIC_ORIGIN` is how the server stays host-agnostic. When it is set, `getBaseUrl` in `src/url.ts` returns that origin and **ignores** `X-Forwarded-Host` / `X-Forwarded-Proto`. OAuth metadata (`/.well-known/oauth-authorization-server`), the `/authorize` URLs inside it, the 401 `resource_metadata` challenge, and the MCP icon URL all stay on your origin even if a client sends a different forwarded host.

Leave `PUBLIC_ORIGIN` unset on a laptop. Then the request `Host` and `X-Forwarded-*` still win, which is what local dev and a trusted reverse proxy in front of localhost need.

## Feature flags

`flags/rollout.yml` is the record of every flag's default and rules. Change rollout by opening a pull request that edits that file; merging to `main` runs GitHub Actions (`.github/workflows/flags.yml`) to apply the file to Railway and verify it stayed in sync.

On Railway, set the repository secret `RAILWAY_TOKEN` to a **project token** from the project's token settings (the same kind of token the app reads at runtime). CI and `bun run flags:apply` use it to list and update flags in that project.

Locally, with `RAILWAY_TOKEN` exported, run `bun run flags:apply --dry-run` to see what Railway would change without applying. Add `--check` to exit with an error when the file and Railway disagree (the scheduled drift job on `main` does only this).

**Emergency kill:** flip the flag off in Railway first (`railway flag set <name> false`), then update `flags/rollout.yml` in a follow-up pull request. Until the file matches Railway, the drift check fails — that is intentional.

**Retiring a flag:** remove it from `FLAGS` and from `flags/rollout.yml` in one pull request; the merge deploys normally. `flags:apply` never deletes, so the flag stays in Railway; it reports `retired flag "<name>" in Railway (not in FLAGS; …)` and `flags:apply --check` does not count it as drift. After the deploy, delete it with `railway flag delete <name>`, and drop it from `FOODABLE_FLAGS` if you set it there (an unknown name there only logs a warning). A flag still in `FLAGS` but missing from the file is still drift.

Without `RAILWAY_TOKEN`, Foodable never calls Railway's flag service at runtime. Every **temporary** flag is off and every **kill switch** stays on. `FOODABLE_FLAGS` is read only when `RAILWAY_TOKEN` is unset. Use it to turn features on for yourself or everyone on a self-hosted box. Syntax is comma-separated `name:mode` pairs, for example `mcp-share-links:internal` or `mcp-share-links:all`. Modes:

- `all` — on for every request.
- `off` — off for every request (this is how you disable a kill switch locally).
- `internal` — on for the deploy's owner accounts: for a per-user flag, only when the signed-in member's role is `owner`; for a per-household flag, whenever the request has a household id (household token, background jobs, or a member's household).

Unknown flag names and unknown modes log a warning once at startup and are ignored. Flags you omit use their registry fallback.

Share links make public pages that need no sign-in (`/s/:token`). They stay off, with no Share buttons and every link answering 404, unless `mcp-share-links` is on (for example `mcp-share-links:internal`); no other flag turns them on.

Each member can set their own picture under Settings › Account (Change photo, Remove photo) and it shows wherever the app shows their initials; nobody can set another member's. The browser crops the chosen photo to a square and shrinks it to 256 by 256 before uploading, and the server accepts only a JPEG, PNG or WebP of at most 64 KB that is square and no larger than 256 pixels, judged by the file's own bytes. Pictures live in Postgres (`member_avatars`), are served to signed-in members of the same household at `/avatars/<user id>` with `nosniff` and a policy that never renders them as a page, and are removed with the member. They are not part of the data export.

The grocery, store and kitchen admin tools for AI agents (`list_stores`, `create_store`, `update_store`, `delete_store`, `reorder_stores`, `set_store_sections`, `clear_grocery_list`, `move_grocery_lines`, `update_grocery_line`, `delete_grocery_lines`, `move_fridge_items`, `delete_fridge_items`, `remove_usual`) are always listed; the ones that change or remove data go through the guard described below.

## Agent changes and undo

Destructive MCP tools (the delete, clear, remove, discard, unplan and merge tools, and the admin tools above that change or remove data; not `list_stores`, `create_store` or `delete_account`) change data without asking the agent's user first. Foodable records each one and lets the household undo it:

- **Settings › AI connections** has an "Agents may make destructive changes" switch. It defaults to on and only the household owner can change it. When it is Off, agents can still read and add, but a destructive tool is refused with a message naming the setting, and nothing changes. It is stored in the household preferences, so it works the same with or without feature flags.
- **Agent activity**, on the same page, lists what agents changed (a sentence saying what, which connection, acting as whom, when). The owner, or the member the agent acted as, can undo an entry within 24 hours; Today shows a strip of recent changes they can undo. An undo restores only what the action changed; if a person has edited the same data since, it can stop with a conflict and change nothing.
- Each entry keeps a snapshot of the rows it changed for those 24 hours, then a sweep (every 15 minutes, on every instance) clears the snapshot. The entry stays as history. The snapshot is the only place deleted contents survive, so a database backup taken inside the window contains them.
- Migration `20261114000000_agent_actions.sql` adds the `agent_actions` table; it is additive.

## Client address (rate limits)

OAuth and failed `/mcp` auth share per-address buckets. The server reads `CLIENT_IP_SOURCE`, `TRUSTED_PROXY_HOPS`, and `CLOUDFLARE_ORIGIN_SECRET` once at boot (see `.env.example`).

**Railway** sets `RAILWAY_ENVIRONMENT_ID` and defaults to `x-real-ip`, which Railway’s edge overwrites with the connecting address. That is enough for the default `*.up.railway.app` URL.

**Cloudflare in front of Railway** — Railway’s peer is a Cloudflare egress address, and Cloudflare forwards `CF-Connecting-IP`, but any caller can reach Railway from a Cloudflare IP with a forged `CF-Connecting-IP`. To trust the visitor address, generate a shared secret (`openssl rand -hex 32`), set `CLOUDFLARE_ORIGIN_SECRET` on the server, and in the Cloudflare dashboard add a **Request Header Transform Rule** for your hostname: Rules → Transform Rules → Modify Request Header → set header `x-foodable-origin-secret` to that value. The server honours `CF-Connecting-IP` only when that header matches (constant-time compare), the address Railway put in `X-Real-IP` (the default source on Railway) is in a Cloudflare range, and the secret is configured. Without the rule, rate limits key on the Cloudflare edge address — safe but coarse. **Authenticated Origin Pulls** does not work on Railway because TLS terminates at Railway’s edge; the header secret is the supported mechanism.

**Docker** published directly without a reverse proxy should use `CLIENT_IP_SOURCE=socket` (the default when not on Railway).

**nginx** — the example below uses `$proxy_add_x_forwarded_for`, which **appends** the client address. Use `CLIENT_IP_SOURCE=x-forwarded-for` with `TRUSTED_PROXY_HOPS=1`, or add `proxy_set_header X-Real-IP $remote_addr;` and use `x-real-ip`. With `x-forwarded-for`, **too many** `TRUSTED_PROXY_HOPS` walks left into client-supplied entries and lets them choose their rate-limit key; **too few** keys everyone behind the proxy on one address (coarse but not spoofable). A header your proxy does not overwrite has the same spoofing effect as too many hops.

## Reverse proxy

Terminate TLS in front of the container or `bun` process. Set `PUBLIC_ORIGIN` to the origin clients actually type, then still pass forwarding headers for client IP (rate limits) and `X-Forwarded-Proto` (the Secure cookie flag). nginx:

```nginx
server {
    listen 443 ssl;
    server_name foodable.example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

With `PUBLIC_ORIGIN=https://foodable.example.com` the advertised OAuth `/authorize` base URL stays that origin even if a request forges `X-Forwarded-Host`. Docker is `Dockerfile` in the repo root (`bun --smol src/index.ts` on port 8080).

### Which AI clients can connect

MCP OAuth redirect URIs are allow-listed. These callbacks work without extra configuration:

- Claude (web, Desktop, mobile, Cowork): `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback`
- ChatGPT connectors: `https://chatgpt.com/connector/oauth/<callback_id>` and the legacy `https://chatgpt.com/connector_platform_oauth_redirect`
- Local clients (Claude Code, MCP Inspector, other loopback agents): `http://localhost`, `http://127.0.0.1`, or `http://[::1]` on any port and path

To allow another callback (for example a self-hosted bot), add its exact redirect URI to `ALLOWED_REDIRECT_URIS`.

## Railway

Deploy-day steps: [deploy-checklist.md](./deploy-checklist.md).

`.railway/railway.ts` is the service's Railway config. It builds from the `Dockerfile`, health-checks `GET /health` (timeout 60 s), restarts on failure, runs the pre-deploy command, and sets the region, the custom domain and waiting for CI before a deploy. Variables are left out on purpose: they stay in Railway. Committing or pushing the file changes nothing on Railway by itself. Create the project yourself with two services, a Postgres database and the app from the GitHub repo. Then, in a fork, edit the repo and region in the file and delete its `domains` line (`railway config plan` fails on a domain Railway does not know yet; see [Custom domain on Cloudflare](#custom-domain-on-cloudflare)). The `service("foodable")` name must match the app service's name on Railway, or apply creates a second app service. Run `railway config plan` to see what would change, and `railway config apply` to apply it; both need Node.js on `PATH` (22.6 or newer), which the CLI uses to evaluate the file. Without apply, set the same things by hand in the app service's settings: Dockerfile builder, health check `/health` with a 60 s timeout, restart on failure, and the pre-deploy command below.

**Postgres.** Add a database (New → Database → PostgreSQL). Turn on backups in its settings before the household has data in it. The app reaches it over Railway's private network, so the database needs no public TCP proxy; add one only while you run `pg_dump`, `db:dryrun --data` or `db:import-postgres` from your own machine, and remove it afterwards.

**Pre-deploy command.** `.railway/railway.ts` sets it to `bun run db:migrate` once you have run `railway config apply` (or set it by hand in the app service's deploy settings). Railway runs it in the new image before it switches traffic, and a failing migration stops the deploy while the old version keeps serving. That is what keeps schema and code in step: a migration and the code that needs it ship in the same commit, and the schema is always updated first.

Set the same variables as `.env.example` on the app service:

| Variable                | Required                | Purpose                                                                                     |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | yes                     | Reference the database service: `${{Postgres.DATABASE_URL}}` (private network)              |
| `DATABASE_APP_URL`      | recommended             | The private database URL with `foodable_app` and its password as the user                   |
| `OAUTH_CLIENT_ID`       | yes                     | MCP OAuth client id (`bun run generate-oauth-creds`)                                        |
| `OAUTH_CLIENT_SECRET`   | yes                     | MCP OAuth client secret                                                                     |
| `SESSION_SECRET`        | yes                     | Site cookie HMAC (min 32 chars; `generate-oauth-creds`). New value logs web users out once. |
| `OFF_USER_AGENT`        | for barcodes            | Open Food Facts User-Agent, `Foodable (you@example.com)`                                    |
| `PUBLIC_ORIGIN`         | after the domain exists | Generated Railway domain, `https://….up.railway.app`, no slash                              |
| `ALLOWED_REDIRECT_URIS` | no                      | Extra OAuth redirect URIs (comma-separated)                                                 |

Do **not** set `PORT`. Railway injects it, and the app reads it.

Generate a domain in the service's networking settings, set `PUBLIC_ORIGIN` to that `https://` origin with no trailing slash, then redeploy. If you add a custom domain later, change `PUBLIC_ORIGIN` to it.

## Custom domain on Cloudflare

Optional. The generated `*.up.railway.app` domain is enough to go live. Cloudflare here is DNS and the proxy in front of Railway, not where the process runs.

1. In the Railway service, open Networking and add a custom domain. Railway shows a CNAME target and a TXT record that proves you own the name.
2. In Cloudflare DNS, add both records. Proxy the CNAME (orange cloud). If you ever add a wildcard, its `_acme-challenge` record stays DNS-only (grey cloud).
3. Set SSL/TLS to **Full**. Flexible sends plain HTTP to Railway, and Railway redirects HTTP to HTTPS, so the browser loops. Full (strict) is also wrong for this setup: while Railway issues or renews the certificate it can briefly present the `*.up.railway.app` certificate, and strict mode answers 526. Full still encrypts the hop from Cloudflare to Railway. Source: [Railway's SSL troubleshooting](https://docs.railway.com/networking/troubleshooting/ssl).
4. If Railway stays on "Validating Challenges", turn the Cloudflare proxy off, wait until Railway shows the certificate as issued, then turn the proxy back on.
5. Set `PUBLIC_ORIGIN` to `https://your-domain` with no trailing slash, and redeploy. OAuth metadata and the MCP icon URL follow that value.
6. Optionally put `domains: [{ domain: "your-domain", port: 8080 }]` back in `.railway/railway.ts` so the file records the custom domain. `railway config plan` should then show no change.

Use a single-label name such as `food.example.com`. A deeper name (`app.food.example.com`) does not work through the orange cloud unless the zone has Cloudflare Advanced Certificate Manager. For that name, leave the record DNS-only.

## First-user flow

One deploy, one Postgres database. Sign-up policy is deploy config: set optional `FOODABLE_SIGNUP_POLICY` to `closed` (default), `invite`, or `open`. Unknown values log a warning and fall back to `closed`. With `closed`, the first user creates the household and further public sign-up stays closed. With `invite`, owners create single-use codes in Settings › Household › Invite codes; a new person enters the code once on the sign-in page and joins that household as a member. Codes are stored hashed, work once, and expire after 7 days; a sign-up that fails part way leaves the code unused and no account behind. On the sign-in page an existing account with a wrong password always gets "Wrong email, username or password.", a new email with no code is told a code is needed, and a new email with a bad, expired or used code is told so. With `open`, more than one household can exist: after sign-up a user without a household sees the create-household form. A person belongs to at most one household under every policy, and closed and invite deploys stay at exactly one household even when two creations race. `open` is experimental and must not be the default.

1. Open the site at `/` (or complete MCP OAuth at `/authorize`). There is no Google button. The first visit, while no user accounts exist, is email and password.
2. That first successful `/approve` **signs up** the first user. After any user exists, `/approve` only signs in. With `closed`, a second email is refused with "Wrong email, username or password."; a wrong password does not fall through to sign-up. If the database cannot answer (timeout, rate limit, outage) the page says to try again in a minute instead of blaming the password.
3. The first user is not in a household yet. `/` shows **Create household** (household name and your name) instead of the app. Submit it. That RPC creates the household and the caller as **owner**. Under `closed` and `invite` a second create fails.
4. Under `closed`, later people exist only when the owner adds them (under `invite` they can also join with a code). Members and the household bot token are managed only in **Settings › Household** (`/settings/household`) — add people there (email or username plus password). Members sign in with those credentials; a username member types just the username (it is stored as `<username>@household.invalid`). They cannot rotate the household token or add people unless the owner makes them an **admin**. Every member can edit their own allergens, dislikes and rules under **Rules**.
5. The owner can make a member an admin (or back), hand ownership to another member, or remove a person, from that person's **Manage** dialog in Settings › Household. An admin manages the household beside the owner: name, location, stores, store rules, everyone's rules, and adding people. Roles, removal, transfer and the bot token stay with the owner, who keeps ownership when they promote someone. Removing someone erases their login, tokens and personal nutrition history (the same path as `delete_account`); shared fridge, grocery, recipe and food data stays. If the owner deletes their account without handing over, an admin becomes owner, or else the member with the oldest account (trigger `household_members_promote_on_owner_leave`). An owner who is the last member leaves an empty household behind.
6. With the default `closed` policy, public registration stays closed after the founder exists. There is no invite link, no Google identity provider, and no auto-join if someone finds the URL. `POST /register` is MCP client registration, not a user sign-up path. Dynamic registration returns its own client id per registration, which is how a connected app is told apart in a member's connections; the deploy-wide `OAUTH_CLIENT_ID` is still accepted.

## Adding a usual

A usual is a plain food the household buys again and again (Eggs, Milk). Add one from the **+** on Kitchen › Usuals (the same round **+** sits on Fridge and Groceries; on a wide screen it is a labelled button). The **Add a usual** sheet has three ways in:

- **Scan:** point the camera at a barcode. Foodable looks the product up and asks **What is it?**: pick the plain food it belongs to, or name a new one (a new food needs a name). The product is filed under that food and becomes its usual product. A product with no brand and the name of a food you have is that food, and is added as it is.
- **Search:** pick a food already in the catalog. It is added as it is.
- **Type it:** for something with no product to scan. Give a name and calories, protein, carbs and fat per 100 g, per 100 ml or per serving (in g or ml). A barcode the lookup did not find is kept, so the next scan knows it.

A food added with a product stays a usual while it has a product: take the last product away and it leaves the list. A food added as it is (Search, Type it, or a scan of a plain food) stays until it is removed from Usuals; removing it clears its products and schedule from the list but keeps the food.

Connect an agent at `https://your-host/mcp` with the household account.
