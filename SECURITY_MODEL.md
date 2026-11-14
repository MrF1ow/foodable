# Foodable threat model

_Repository: MrF1ow/foodable. Built from the code and from `SECURITY.md` (disclosure policy and scope). There is no separate infrastructure repository: deploy config is `Dockerfile`, `.railway/railway.ts` and `docker-compose.yml` in the repo, and Railway/Cloudflare are configured by hand (`docs/self-hosting.md`)._

**Provenance:** unless a line is marked _(user)_ or _(SECURITY.md)_, it is inferred from the code and is a draft assumption, not something the user has confirmed.

## System overview

A self-hosted MCP server and web app for **one household per deploy** (Bun + Hono, `src/index.ts`) backed by one Postgres database (`DATABASE_URL`, optional `DATABASE_APP_URL`; `Bun.sql` via `src/db/sql.ts`). People use it two ways: AI agents (Claude, ChatGPT, local MCP clients) call 97 MCP tools on `/mcp` when every feature flag is on (`src/mcp/tools-list.snapshot.json`); some of those tools are registered only behind flags via `gatedTool` in `src/mcp/gated.ts` (for example `rate_product`, `get_household_digest`, and the grocery, store and kitchen admin tools behind `mcp-household-admin`), so the default `tools/list` omits them while those flags are off. Household members use the server-rendered web app. The usual deploy is Railway (Docker image, `bun --smol`, port 8080) with Railway Postgres on the private network, optionally behind a Cloudflare proxy. TLS ends at Railway or Cloudflare. Production is being switched to a separate app database role (`DATABASE_APP_URL`); until that variable is set on an instance, member traffic still uses the owner connection and row level security is not enforced at runtime.

### Trust boundaries

1. **Internet → app.** Every route is publicly reachable. The only gates are app-level auth and IP rate limits (`checkAuthRateLimit`, `noteAuthFailure` in `src/rate-limit.ts`; bucket and ban state in Postgres via `src/db/rate-limits.ts`, shared across instances).
2. **Unauthenticated → authenticated.** Three kinds of credential:
    - OAuth 2.1 access tokens for MCP users (`src/oauth.ts`: `/register`, `/authorize`, `/approve`, `/token`, PKCE S256 required, redirect allowlist in `src/oauth-redirect.ts` plus `ALLOWED_REDIRECT_URIS`).
    - The **household bot token** `nt_hh_…` (`src/household-token.ts`, stored as a SHA-256 hash). It authenticates as the household, not a person, and acts as any member passed in `user_id` (`createToolContext` in `src/mcp/shared.ts`).
    - The site session cookie (`src/site-session.ts`: HMAC with `SESSION_SECRET`, HttpOnly, SameSite=Lax, Secure behind HTTPS).
3. **Member → admin → owner.** Roles are enforced in the app (`src/household.ts` `requireManager` / `requireOwner`, `src/web/middleware.ts`, `callerManagerHouseholdId` in `src/mcp/shared.ts`). Owner-only: roles, removal, ownership transfer, invite codes, the bot token, and the agent destructive-changes switch.
4. **Member → other member's personal data.** Nutrition, weight, goals and profile are per user. Peer reads are allowed inside the household, but writes must match the signed-in user unless `target_member` is used (`resolveActorUserId` / `writeUserId`).
5. **App → Postgres.** Two connection pools in `src/db/sql.ts`: `DATABASE_APP_URL` (role `foodable_app`, created in `db/migrations/20261109210000_foodable_app_role.sql`) for user and household work, and `DATABASE_URL` (the table owner) for migrations and system work. Every `run()` in `src/db/sql.ts` sets `request.jwt.claim.sub` and `app.household_id` from an async actor (`withActor` / `actorForRun` in `src/db/actor.ts`). Background and pre-auth paths use `runAsSystem` (allowlisted in `src/db/actor-allowlist.test.ts`). Per-table RLS policies for `foodable_app` ship in later migrations (for example `db/migrations/20261109220100_app_policies_shared.sql`, `db/migrations/20261109230000_app_policies_personal.sql`). When `DATABASE_APP_URL` is set, RLS is the runtime household boundary on the app pool. When it is unset, both pools use `DATABASE_URL`, the owner bypasses RLS, and authorization rests on app code alone.
6. **Untrusted content → agent / browser.** Text from Open Food Facts (`src/foods.ts`, fixed `world.openfoodfacts.org` URLs), CSV imports (`src/domain/csv.ts`, `src/domain/import.ts`), recipe text and recipe pages fetched from member-supplied URLs (`src/domain/recipe-import.ts` via `src/fetch-safe.ts`, an outbound request boundary), and member-entered names flows back into MCP tool results, MCP App widgets (`public/widgets/src/`, served as `ui://` resources and rendered by the host in its own sandboxed iframe) and server-rendered pages (`src/html.ts`).

## Components

| Component            | Code it covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth**             | `src/oauth.ts`, `src/oauth-redirect.ts`, `src/oauth-login-sessions.ts`, `src/discovery.ts`, `src/site-session.ts`, `src/household-token.ts`, `src/tokens.ts`, `src/db/tokens.ts`, `src/db/users.ts`, `src/db/login-sessions.ts`, `src/db/invites.ts`, `src/db/rate-limits.ts`, `src/db/actor.ts`, `src/domain/auth.ts`, `src/domain/signup.ts`, `src/middleware.ts`, `src/rate-limit.ts`, `src/url.ts`, `src/net.ts`, `public/login.html`, `scripts/gen-login.ts`, `src/copy/login.ts` |
| **MCP API**          | `src/mcp/**`, `src/mcp.ts`, `src/auth-context.ts`, `src/analytics.ts`, `src/copy/tools.ts`                                                                                                                                                                                                                                                                                                                                                                                             |
| **Web App**          | `src/web/**`, `src/routes.ts`, `src/html.ts`, `src/index.ts` (headers, CORS, static routes)                                                                                                                                                                                                                                                                                                                                                                                            |
| **Widgets**          | `public/widgets/**`, `src/widgets.ts`, `src/brand.ts`, `public/*` static assets                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Feature flags**    | `src/flags.ts`, `src/flag-pins.ts`, `src/domain/flag-pins.ts`, `src/db/flag-pins.ts`, `flags/rollout.yml`, `scripts/flags-apply.ts`, `.github/workflows/flags.yml`                                                                                                                                                                                                                                                                                                                     |
| **Domain & Data**    | `src/domain/**`, `src/db/**` (except `migrate.ts`), `src/household.ts`, `src/foods.ts`, `src/food-search.ts`, `src/exports-route.ts`, `src/zip.ts`, `src/fetch-safe.ts` (recipe URL fetcher)                                                                                                                                                                                                                                                                                           |
| **Database Schema**  | `db/migrations/**`, `db/bootstrap.sql`, `src/db/migrate.ts`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Deploy & Tooling** | `Dockerfile`, `.railway/railway.ts`, `docker-compose.yml`, `scripts/**`, `.github/workflows/**`, `.env.example`                                                                                                                                                                                                                                                                                                                                                                        |

## Entry points and who can reach them

| Entry point                                                                                                                                            | Reachable by                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `GET /authorize`, `POST /approve` (login; sign-up when `canSignUp` in `src/domain/signup.ts` allows it for `FOODABLE_SIGNUP_POLICY`, default `closed`) | Anyone on the internet                                                    |
| `POST /register` (dynamic MCP client registration), `POST /token`, `/.well-known/*`                                                                    | Anyone                                                                    |
| `GET /exports/:token` (signed, expiring export link)                                                                                                   | Anyone holding the link                                                   |
| `POST /mcp` (JSON-RPC, both protocol eras)                                                                                                             | Holders of an OAuth access token or the household bot token               |
| Web app routes (`src/web/routes/*`, about 55 POST handlers)                                                                                            | Holders of a site cookie. Member, manager and owner gates apply per route |
| `/app.js`, `/app.css`, `/app-v2.js`, `/app-v2.css`, `/brand/*`, `/fonts/*`, `/health`, `/robots.txt`                                                   | Anyone (static)                                                           |
| CLI scripts (`db:migrate`, `foods:merge-duplicates`, `db:import-postgres`)                                                                             | Operator with `DATABASE_URL` only                                         |

## Assets and data sensitivity

- **Credentials:** password hashes, OAuth client secret, access/refresh tokens, household bot token, `SESSION_SECRET`, `DATABASE_URL`, optional `DATABASE_APP_URL`. Highest sensitivity, because one leak gives access to every asset below.
- **Personal health data:** meals, weight, water, goals, allergens and dislikes, per member. Sensitive personal data.
- **Shared household data:** foods, fridge, groceries, recipes, stores, rules. Lower sensitivity, but integrity matters.
- **Export archives:** a ZIP of all of one user's data.
- **Availability:** a single small instance (`--smol`).
- **Feature-flag state:** rollout and kill-switch values in Railway, sticky pins and snapshots in Postgres (`src/db/flag-pins.ts`), source of truth in-repo at `flags/rollout.yml`.

_(user)_ All these assets matter roughly equally. None is ranked above the others.

## Attacker profiles

_(user)_ All four profiles below matter; none is ruled out.

1. **Anonymous internet attacker:** probes login (brute force, founder sign-up race when the policy allows the first user, invite guessing when `FOODABLE_SIGNUP_POLICY` is `invite`), OAuth (redirect manipulation, client registration abuse, code/PKCE flaws, forged `X-Forwarded-*` when `PUBLIC_ORIGIN` is unset), export links, and unauthenticated `/mcp`.
2. **Malicious or curious household member:** escalates role, reads or writes another member's personal data beyond the intended peer reads, or manages the bot token or invite codes.
3. **Holder of a leaked token:** the household bot token or an OAuth token, for example pasted into an agent config.
4. **Untrusted content:** OFF product data, CSV imports or recipe text crafted to cause XSS in the web app or widgets, or prompt injection that steers the agent into destructive tool calls. The guard does not stop an agent from making such a call while the switch is on; it bounds the damage with the log and a 24 hour undo.

## Existing controls

- PKCE S256 required, exact-match redirect allowlist, single-use auth codes (`src/oauth.ts`).
- IP auth rate limits and bans (`checkAuthRateLimit`, `noteAuthFailure`), per-user tool rate limits (`checkRateLimit`), persisted in Postgres (`src/db/rate-limits.ts`) so limits hold across instances; `rateLimitAuth` on `/exports/:token`.
- OAuth login/session state in Postgres (`src/db/login-sessions.ts`, `src/oauth-login-sessions.ts`), shared across instances.
- Site cookie: HMAC with timing-safe compare, UUID-validated user id, HttpOnly, SameSite=Lax, Secure.
- Constant 404 body for export token failures.
- Security headers: `X-Content-Type-Options`, `X-Frame-Options: DENY` (every response; no page of the app can be framed), a CSP that still allows `script-src 'unsafe-inline'` (see `src/index.ts`).
- Strict CORS allowlist (localhost plus `ALLOWED_ORIGINS`).
- `PUBLIC_ORIGIN` pins advertised OAuth URLs against forged forwarded headers.
- Sign-up gated by `FOODABLE_SIGNUP_POLICY` (`closed`, `invite`, or `open`; default `closed` in `.env.example`) via `canSignUp` in `src/domain/signup.ts`. In `invite` mode, owner-issued single-use codes are stored hashed (`hashInviteCode` in `src/db/invites.ts`); otherwise new members are added by the owner or an admin.
- Feature flags and kill switches (`src/flags.ts`, `src/flag-pins.ts`); `flags/rollout.yml` synced to Railway on merge via `.github/workflows/flags.yml` (uses the `RAILWAY_TOKEN` GitHub Actions secret on the canonical repo).
- **Destructive agent changes are guarded, recorded and undoable** (`src/domain/agent-actions.ts`, `runDestructive` in `src/mcp/shared.ts`, table `agent_actions`). The guarded tools are the ones that delete, remove, discard, clear, unplan or merge household data (`delete_meal`, `delete_water`, `delete_weight`, the fridge, grocery and recipe deletes, `unplan_recipe`, `merge_foods`) and the store, grocery and kitchen admin tools that change or remove data. Not guarded: `delete_account` (limited to the caller's own account, behind its own `confirm`), and the single-record edit tools such as `update_meal`, `update_weight`, `update_recipe` and `set_household_rules`, which change only what the person asked to edit; the switch does not stop them.
    - **Switch.** The household setting "Agents may make destructive changes" (Settings › AI connections, stored as `agents.destructive_allowed` in the household preferences) defaults to allowed. Only the **owner** can flip it (`requireOwner` on `POST /settings/ai-connections/destructive`). When it is Off, the guard refuses before the write: the tool returns an error that names the setting, nothing changes, and no entry is recorded. Reads, adds and the unguarded tools above are unaffected. It applies to OAuth tokens and the household bot token alike.
    - **Log.** Each allowed call writes one `agent_actions` row in the same transaction as the change: the household, the member the agent acted as (null for the bot token), the connection name, the tool, a plain sentence, and a snapshot of the rows as they were. Members see the list in Settings › AI connections, and a Today strip for changes they may undo.
    - **Undo.** Within 24 hours, the **owner** or the **member the agent acted as** can undo it (anyone else gets "not found"; the bot token's actions are the owner's to undo). The put-back replays the snapshot as the acting member under the same RLS the agent's call had, whoever clicked Undo, and is all or nothing. It restores only what the action changed and never overwrites what a person edited since: an updated row gets back only the columns the action changed, and only while they still hold what the write left. An undo that cannot proceed on that basis stops with a conflict and changes nothing. Rows another member owns that a policy hides from the acting session, and tables off `AGENT_TABLES` (for example `recipe_favourites`), are not restored; the entry's summary says so when a write can reach them.
    - **Retention.** A snapshot holds copies of household rows, including ones the agent deleted. `startAgentActionPurge` nulls snapshots past their 24 hours (first run a minute after boot, then every 15 minutes), so deleted contents are not kept longer. The entry itself stays as history. Deleting a user keeps their entries and forgets who.
- Migration lint (`scripts/migration-safety/`, `scripts/data-api-grants.ts`) requires RLS and `service_role` grants on new tables; `bun run db:dryrun` asserts `foodable_app` role coverage and policies in `scripts/migration-dryrun/check.sql`.

## Out of scope / accepted risk

- _(SECURITY.md)_ Third-party hosts (Railway, the Postgres provider), MCP client bugs, physical access, and long-lived credentials pasted into a public channel.
- _(SECURITY.md)_ Only the latest `main` is supported.
- _(user)_ Nothing beyond SECURITY.md is out of scope or accepted risk. Multi-household isolation, peer reads of nutrition, denial of service and deploy misconfiguration all stay in scope.

## Open questions

- None outstanding. _(user)_ Tags: Component only.
