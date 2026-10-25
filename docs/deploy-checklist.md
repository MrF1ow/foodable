# Deploy checklist

Use this on deploy day. The deployment-audit fixes (#55 to #58) are on `main`, and the #56 migration is already applied to `dapbxswqfiqvxutsobhr`. See `docs/handoff/foodable-launch-handoff.md` for step-by-step detail rather than duplicating it here.

Setting `SESSION_SECRET` on an existing deploy logs everyone out of the web app once (MCP tokens are unaffected).

## Before deploy day (local)

- [x] #61 (logo and accent) and #62 (add-member form, widget frame height, form spacing) are merged to `main` (`ed6b714`, `f273472`).
- [x] `docker build -t foodable:check .` succeeded on 2026-10-25 on the pinned `oven/bun:1.4.2` image. A container started with the local env answered `GET /health` with `ok` and served the login page.
- [ ] With the local server up, `bun run inspect` (MCP Inspector) completes OAuth through its loopback callback and lists 67 tools. Not run on 2026-10-25. Grok's `mcp doctor foodable` did pass that day: protocol `2026-07-28`, 67 tools, against the local server.

## Supabase

- [x] All 43 migrations are applied on `dapbxswqfiqvxutsobhr` as of 2026-10-25 (`supabase migration list --linked`, local and remote in step), including `20261022180000_explicit_data_api_grants` (#95). That grant migration needs to be on the project before Supabase stops auto-granting table privileges on 2026-10-30. It is. A later migration still goes through `bun run db:dryrun`, then `bunx supabase db push --dry-run`, then `bunx supabase db push`.
- [ ] Authentication → Sign In / Providers: email + password on, "Confirm email" off.
- [ ] Leave "Allow new users to sign up" **on** until the owner has signed up (step under Railway). Then turn it **off**.
      Members are created with the admin API, which ignores this toggle.
- [ ] SQL editor: no security-definer function in `public` is executable by a client role. Every row must be `f` / `f`:

    ```sql
    select p.proname,
           has_function_privilege('anon', p.oid, 'execute') as anon,
           has_function_privilege('authenticated', p.oid, 'execute') as authenticated
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef order by 1;
    ```

- [ ] Optional: Pro plan, so the project never pauses (free projects pause after 7 days idle).

## Railway

- [ ] New project → Deploy from GitHub repo → `MrF1ow/foodable` (renamed from `nutrition-mcp`), branch `main`. Region: US East.
- [ ] Variables (do **not** set `PORT`):
      `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (service role), `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `SESSION_SECRET`
      (all fresh from `bun run generate-oauth-creds`), `OFF_USER_AGENT=Foodable (<email>)`.
- [ ] Networking → Generate Domain. Set `PUBLIC_ORIGIN=https://<domain>` (no trailing slash). Redeploy.
- [ ] Optional custom domain: [self-hosting.md](./self-hosting.md#custom-domain-on-cloudflare). Cloudflare SSL/TLS mode is **Full**. Then point `PUBLIC_ORIGIN` at that origin and redeploy.
- [ ] `curl https://<domain>/health` → `ok`. `/.well-known/oauth-authorization-server` shows `https://<domain>` URLs.
- [ ] Confirm who already exists in this Supabase project before anyone opens the URL. On 2026-10-05 one Auth user signed up, created a household named "Flow", and logged two test meals. If that account is the owner, skip sign-up and use it. If you want a clean start, wipe Auth and the `public` data first: a second email is refused, and a second household cannot be created.
- [ ] **Immediately** open `https://<domain>/` and sign in as the owner (or sign up, if you wiped Auth), and create the household if there is not one yet.
      While Auth is empty, the first visitor becomes the owner. Do not share the URL before the owner exists.
- [ ] Supabase: turn "Allow new users to sign up" **off**. Confirm a new email at `/` gets "Wrong email, username or password."

## Members and bots

- [ ] Settings → Household: add each person (name, email or username, password). Hand them the login yourself.
- [ ] Each person: Claude.ai → Settings → Connectors → Add custom connector → `https://<domain>/mcp`, then sign in.
      Same URL in ChatGPT and Claude Code. Confirm `tools/list` loads. Remove any old nutrition-mcp connector.
- [ ] Grok CLI: point the `foodable` MCP server at `https://<domain>/mcp` and sign in again (`/mcps` → foodable → `i`). The local session on `http://localhost:8080/mcp` does not carry over.
- [ ] A username member signs in by typing just the username.
- [ ] As a member (not the owner), adding a person and rotating the token in Settings → Household are both refused.
- [ ] Optional: as the owner, hand ownership to a member and back (Settings → Household → Manage).
- [ ] Bots: Settings → Household → rotate the token, copy it once, then configure
      `Authorization: Bearer nt_hh_…` against `https://<domain>/mcp`. The bot passes `user_id` for the person it acts for.
- [ ] Run the walk in `docs/handoff/foodable-launch-handoff.md`, step 5 (`tools/list` returns 67 tools).

## Retire the old deploy (confirm first)

- [ ] Shut down the old server.
- [ ] Delete the old Supabase project.
- [ ] Remove old connectors and DNS records.
