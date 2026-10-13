# Deploy checklist

Use this on deploy day. The deployment-audit fixes (#55 to #58) are on `main`, and the #56 migration is already applied to `dapbxswqfiqvxutsobhr`. See `docs/handoff/foodable-launch-handoff.md` for step-by-step detail rather than duplicating it here.

Setting `SESSION_SECRET` on an existing deploy logs everyone out of the web app once (MCP tokens are unaffected).

## Before deploy day (local)

- [ ] #61 (logo and accent) and #62 (add-member form, widget frame height, form spacing) are merged to `main`. Without #62 no member can be added from Settings → Household.
- [ ] `docker build -t foodable .` succeeds on the pinned `oven/bun:1.4.2` image, and `docker run --env-file .env -p 8080:8080 foodable` answers `GET /health` with `ok`. Not yet run anywhere.
- [ ] With the local server up, `bun run inspect` (MCP Inspector) completes OAuth through its loopback callback and lists 67 tools.

## Supabase

- [ ] `PG_BIN=<postgres bin>/ bun run db:dryrun`, then `bunx supabase db push --dry-run`, then `bunx supabase db push`.
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
- [ ] `curl https://<domain>/health` → `ok`. `/.well-known/oauth-authorization-server` shows `https://<domain>` URLs.
- [ ] **Immediately** open `https://<domain>/`, sign up as the owner, and create the household.
      While Auth is empty, the first visitor becomes the owner. Do not share the URL before this.
- [ ] Supabase: turn "Allow new users to sign up" **off**. Confirm a new email at `/` gets "Wrong email, username or password."

## Members and bots

- [ ] Settings → Household: add each person (name, email or username, password). Hand them the login yourself.
- [ ] Each person: Claude.ai → Settings → Connectors → Add custom connector → `https://<domain>/mcp`, then sign in.
      Same URL in ChatGPT and Claude Code. Confirm `tools/list` loads. Remove any old nutrition-mcp connector.
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
