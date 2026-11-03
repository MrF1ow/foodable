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

## Database

Foodable talks to Postgres through `DATABASE_URL` and nothing else. Any Postgres works: Railway, Neon, RDS, a local `initdb` cluster, or the Docker Compose service below. The app owns its user accounts (`public.users`), so there is no separate auth service to run.

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

## Environment variables

| Variable                | Required     | Purpose                                                                                                                     |
| ----------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | yes          | Postgres connection string                                                                                                  |
| `OAUTH_CLIENT_ID`       | yes          | MCP OAuth client id (`bun run generate-oauth-creds`)                                                                        |
| `OAUTH_CLIENT_SECRET`   | yes          | MCP OAuth client secret                                                                                                     |
| `SESSION_SECRET`        | production   | Site cookie HMAC (min 32 chars; `generate-oauth-creds`). Setting it on a live deploy logs everyone out of the web app once. |
| `OFF_USER_AGENT`        | for barcodes | Open Food Facts User-Agent, `Foodable (you@example.com)`                                                                    |
| `PORT`                  | no           | Listen port, default `8080`                                                                                                 |
| `PUBLIC_ORIGIN`         | production   | Canonical public origin, `https://foodable.example.com`                                                                     |
| `ALLOWED_ORIGINS`       | no           | Extra CORS origins, comma-separated. Localhost is already allowed.                                                          |
| `ALLOWED_REDIRECT_URIS` | no           | Extra OAuth redirect URIs (comma-separated), exact match after URL normalization                                            |

`PUBLIC_ORIGIN` is how the server stays host-agnostic. When it is set, `getBaseUrl` in `src/url.ts` returns that origin and **ignores** `X-Forwarded-Host` / `X-Forwarded-Proto`. OAuth metadata (`/.well-known/oauth-authorization-server`), the `/authorize` URLs inside it, the 401 `resource_metadata` challenge, and the MCP icon URL all stay on your origin even if a client sends a different forwarded host.

Leave `PUBLIC_ORIGIN` unset on a laptop. Then the request `Host` and `X-Forwarded-*` still win, which is what local dev and a trusted reverse proxy in front of localhost need.

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

`railway.toml` at the repo root builds from the `Dockerfile` (`builder = "DOCKERFILE"`, `dockerfilePath = "Dockerfile"`) and health-checks `GET /health` (`healthcheckTimeout` 60, `restartPolicyType` `ON_FAILURE`). Committing it creates nothing on Railway. Create the project yourself with two services: a Postgres database, and the app from the GitHub repo. Railway then picks the file up on every deploy.

**Postgres.** Add a database (New → Database → PostgreSQL). Turn on backups in its settings before the household has data in it. The app reaches it over Railway's private network, so the database needs no public TCP proxy; add one only while you run `pg_dump`, `db:dryrun --data` or `db:import-postgres` from your own machine, and remove it afterwards.

**Pre-deploy command.** In the app service's deploy settings, set the pre-deploy command to `bun run db:migrate`. Railway runs it in the new image before it switches traffic, and a failing migration stops the deploy while the old version keeps serving. That is what keeps schema and code in step: a migration and the code that needs it ship in the same commit, and the schema is always updated first.

Set the same variables as `.env.example` on the app service:

| Variable                | Required                | Purpose                                                                                     |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | yes                     | Reference the database service: `${{Postgres.DATABASE_URL}}` (private network)              |
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

Use a single-label name such as `food.example.com`. A deeper name (`app.food.example.com`) does not work through the orange cloud unless the zone has Cloudflare Advanced Certificate Manager. For that name, leave the record DNS-only.

## First-user flow

One deploy, one Postgres database, one household.

1. Open the site at `/` (or complete MCP OAuth at `/authorize`). There is no Google button. The first visit, while no user accounts exist, is email and password.
2. That first successful `/approve` **signs up** the first user. After any user exists, `/approve` only signs in. A second email is refused with "Wrong email, username or password."; a wrong password does not fall through to sign-up. If the database cannot answer (timeout, rate limit, outage) the page says to try again in a minute instead of blaming the password.
3. The first user is not in a household yet. `/` shows **Create household** (household name and your name) instead of the app. Submit it. That RPC creates the singleton household and the caller as **owner**. A second create fails.
4. Later people exist only when the owner adds them. Members and the household bot token are managed only in **Settings → Household** (`/settings/household`) — add people there (email or username plus password). Members sign in with those credentials; a username member types just the username (it is stored as `<username>@household.invalid`). They cannot rotate the household token or add people unless the owner makes them an **admin**. Every member can edit their own allergens, dislikes and rules under **Rules**.
5. The owner can make a member an admin (or back), hand ownership to another member, or remove a person, from that person's **Manage** dialog in Settings → Household. An admin manages the household beside the owner: name, location, stores, store rules, everyone's rules, and adding people. Roles, removal, transfer and the bot token stay with the owner, who keeps ownership when they promote someone. Removing someone erases their login, tokens and personal nutrition history (the same path as `delete_account`); shared fridge, grocery, recipe and food data stays. If the owner deletes their account without handing over, an admin becomes owner, or else the member with the oldest account (trigger `household_members_promote_on_owner_leave`). An owner who is the last member leaves an empty household behind.
6. Public registration stays closed. There is no invite link, no Google identity provider, and no auto-join if someone finds the URL. `POST /register` is MCP client registration, not a user sign-up path.

Connect an agent at `https://your-host/mcp` with the household account.
