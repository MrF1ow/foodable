# Foodable threat model

_Repository: MrF1ow/foodable. Built from the code and from `SECURITY.md` (disclosure policy and scope). There is no separate infrastructure repository: deploy config is `Dockerfile`, `railway.toml` and `docker-compose.yml` in the repo, and Railway/Cloudflare are configured by hand (`docs/self-hosting.md`)._

**Provenance:** unless a line is marked _(user)_ or _(SECURITY.md)_, it is inferred from the code and is a draft assumption, not something the user has confirmed.

## System overview

A self-hosted MCP server and web app for **one household per deploy** (Bun + Hono, `src/index.ts`) backed by one Postgres database (`DATABASE_URL`, `Bun.sql` via `src/db/sql.ts`). People use it two ways: AI agents (Claude, ChatGPT, local MCP clients) call 71 tools on `/mcp`, and household members use the server-rendered web app. The usual deploy is Railway (Docker image, `bun --smol`, port 8080) with Railway Postgres on the private network, optionally behind a Cloudflare proxy. TLS ends at Railway or Cloudflare.

### Trust boundaries

1. **Internet → app.** Every route is publicly reachable. The only gates are app-level auth and the IP rate limits in `src/rate-limit.ts`.
2. **Unauthenticated → authenticated.** Three kinds of credential:
    - OAuth 2.1 access tokens for MCP users (`src/oauth.ts`: `/register`, `/authorize`, `/approve`, `/token`, PKCE S256 required, redirect allowlist in `src/oauth-redirect.ts` plus `ALLOWED_REDIRECT_URIS`).
    - The **household bot token** `nt_hh_…` (`src/household-token.ts`, stored as a SHA-256 hash). It authenticates as the household, not a person, and acts as any member passed in `user_id` (`createToolContext` in `src/mcp/shared.ts`).
    - The site session cookie (`src/site-session.ts`: HMAC with `SESSION_SECRET`, HttpOnly, SameSite=Lax, Secure behind HTTPS).
3. **Member → admin → owner.** Roles are enforced in the app (`src/household.ts` `requireManager` / `requireOwner`, `src/web/middleware.ts`, `callerManagerHouseholdId` in `src/mcp/shared.ts`). Owner-only: roles, removal, ownership transfer, and the bot token.
4. **Member → other member's personal data.** Nutrition, weight, goals and profile are per user. Peer reads are allowed inside the household, but writes must match the signed-in user unless `target_member` is used (`resolveActorUserId` / `writeUserId`).
5. **App → Postgres.** The app connects with the `DATABASE_URL` role, which owns the tables, so RLS policies in `db/migrations/` are **not** a runtime boundary today. `docs/roadmap.md` lists RLS as v2 work. Authorization rests entirely on app code.
6. **Untrusted content → agent / browser.** Text from Open Food Facts (`src/foods.ts`, fixed `world.openfoodfacts.org` URLs), CSV imports (`src/domain/csv.ts`, `src/domain/import.ts`), recipe text and recipe pages fetched from member-supplied URLs (`src/domain/recipe-import.ts` via `src/fetch-safe.ts`, an outbound request boundary), and member-entered names flows back into MCP tool results, MCP App widgets (`public/widgets/src/`, served at `/app/widgets/:key` with `frame-ancestors 'self'`) and server-rendered pages (`src/html.ts`).

## Components

| Component            | Code it covers                                                                                                                                                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth**             | `src/oauth.ts`, `src/oauth-redirect.ts`, `src/discovery.ts`, `src/site-session.ts`, `src/household-token.ts`, `src/tokens.ts`, `src/db/tokens.ts`, `src/db/users.ts`, `src/domain/auth.ts`, `src/middleware.ts`, `src/rate-limit.ts`, `src/url.ts`, `src/net.ts`, `public/login*.html`, `src/copy/login.ts` |
| **MCP API**          | `src/mcp/**`, `src/mcp.ts`, `src/auth-context.ts`, `src/analytics.ts`, `src/copy/tools.ts`                                                                                                                                                                                                                  |
| **Web App**          | `src/web/**`, `src/routes.ts`, `src/html.ts`, `src/dashboard-data.ts`, `src/index.ts` (headers, CORS, static routes)                                                                                                                                                                                        |
| **Widgets**          | `public/widgets/**`, `src/widgets.ts`, `src/brand.ts`, `public/*` static assets                                                                                                                                                                                                                             |
| **Domain & Data**    | `src/domain/**`, `src/db/**` (except `migrate.ts`), `src/household.ts`, `src/foods.ts`, `src/food-search.ts`, `src/exports-route.ts`, `src/zip.ts`, `src/fetch-safe.ts` (recipe URL fetcher)                                                                                                                |
| **Database Schema**  | `db/migrations/**`, `db/bootstrap.sql`, `src/db/migrate.ts`                                                                                                                                                                                                                                                 |
| **Deploy & Tooling** | `Dockerfile`, `railway.toml`, `docker-compose.yml`, `scripts/**`, `.github/workflows/**`, `.env.example`                                                                                                                                                                                                    |

## Entry points and who can reach them

| Entry point                                                                                  | Reachable by                                                              |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `GET /authorize`, `POST /approve` (login, and first-user sign-up while no users exist)       | Anyone on the internet                                                    |
| `POST /register` (dynamic MCP client registration), `POST /token`, `/.well-known/*`          | Anyone                                                                    |
| `GET /exports/:token` (signed, expiring export link)                                         | Anyone holding the link                                                   |
| `POST /mcp` (JSON-RPC, both protocol eras)                                                   | Holders of an OAuth access token or the household bot token               |
| Web app routes (`src/web/routes/*`, about 55 POST handlers)                                  | Holders of a site cookie. Member, manager and owner gates apply per route |
| `/app/widgets/:key`, `/app.js`, `/app.css`, `/brand/*`, `/fonts/*`, `/health`, `/robots.txt` | Anyone (static)                                                           |
| CLI scripts (`db:migrate`, `foods:merge-duplicates`, `db:import-postgres`)                   | Operator with `DATABASE_URL` only                                         |

## Assets and data sensitivity

- **Credentials:** password hashes, OAuth client secret, access/refresh tokens, household bot token, `SESSION_SECRET`, `DATABASE_URL`. Highest sensitivity, because one leak gives access to every asset below.
- **Personal health data:** meals, weight, water, goals, allergens and dislikes, per member. Sensitive personal data.
- **Shared household data:** foods, fridge, groceries, recipes, stores, rules. Lower sensitivity, but integrity matters.
- **Export archives:** a ZIP of all of one user's data.
- **Availability:** a single small instance (`--smol`).

_(user)_ All these assets matter roughly equally. None is ranked above the others.

## Attacker profiles

_(user)_ All four profiles below matter; none is ruled out.

1. **Anonymous internet attacker:** probes login (brute force, first-user sign-up race), OAuth (redirect manipulation, client registration abuse, code/PKCE flaws, forged `X-Forwarded-*` when `PUBLIC_ORIGIN` is unset), export links, and unauthenticated `/mcp`.
2. **Malicious or curious household member:** escalates role, reads or writes another member's personal data beyond the intended peer reads, or manages the bot token.
3. **Holder of a leaked token:** the household bot token or an OAuth token, for example pasted into an agent config.
4. **Untrusted content:** OFF product data, CSV imports or recipe text crafted to cause XSS in the web app or widgets, or prompt injection that steers the agent into destructive tool calls.

## Existing controls

- PKCE S256 required, exact-match redirect allowlist, single-use auth codes (`src/oauth.ts`).
- IP auth rate limits and bans (`checkAuthRateLimit`, `noteAuthFailure`), per-user tool rate limits (`checkRateLimit`). `rateLimitAuth` on `/exports/:token`.
- Site cookie: HMAC with timing-safe compare, UUID-validated user id, HttpOnly, SameSite=Lax, Secure.
- Constant 404 body for export token failures.
- Security headers: `X-Content-Type-Options`, `X-Frame-Options: DENY` (SAMEORIGIN only for widget frames), a CSP that still allows `script-src 'unsafe-inline'` (see `src/index.ts`).
- Strict CORS allowlist (localhost plus `ALLOWED_ORIGINS`).
- `PUBLIC_ORIGIN` pins advertised OAuth URLs against forged forwarded headers.
- Public registration closed after the first user; members are added only by the owner or an admin.
- Migration lint (`scripts/migration-safety/`) requires RLS plus `service_role` grants on new tables.

## Out of scope / accepted risk

- _(SECURITY.md)_ Third-party hosts (Railway, the Postgres provider), MCP client bugs, physical access, and long-lived credentials pasted into a public channel.
- _(SECURITY.md)_ Only the latest `main` is supported.
- _(user)_ Nothing beyond SECURITY.md is out of scope or accepted risk. Multi-household isolation, peer reads of nutrition, denial of service and deploy misconfiguration all stay in scope.

## Open questions

- None outstanding. _(user)_ Tags: Component only.
