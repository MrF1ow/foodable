# Deploy checklist

Use this on deploy day. Environment variables, how migrations run, and the first-user flow are in [self-hosting.md](./self-hosting.md).

Setting `SESSION_SECRET` on an existing deploy logs everyone out of the web app once (MCP tokens are unaffected).

## Before deploy day (local)

- [x] #61 (logo and accent) and #62 (add-member form, widget frame height, form spacing) are merged to `main` (`ed6b714`, `f273472`).
- [x] `docker build -t foodable:check .` succeeded on 2026-10-25 on the pinned `oven/bun:1.4.2` image. A container started with the local env answered `GET /health` with `ok` and served the login page.
- [ ] With the local server up, `bun run inspect` (MCP Inspector) completes OAuth through its loopback callback and lists 67 tools. Not run on 2026-10-25. Grok's `mcp doctor foodable` did pass that day: protocol `2026-07-28`, 67 tools, against the local server.

## Database (Railway Postgres)

- [ ] The Railway project has a **Postgres** service next to the app, with backups turned on.
- [ ] `DATABASE_URL` on the app service is the reference `${{Postgres.DATABASE_URL}}`, so it uses the private network.
- [ ] The app service's pre-deploy command is `bun run db:migrate`. The first deploy applies every migration in `db/migrations/` to the empty database.
- [ ] Moving data from an older database? Do it before anyone signs in, with a temporary TCP proxy on the Railway Postgres: `bun run db:import-postgres --from "$OLD_DATABASE_URL" --to "$RAILWAY_PROXY_URL" --check-only`, then the same without `--check-only`. Both databases must be at the same migration version and the target must be empty. Remove the proxy afterwards.
- [ ] Before each later deploy that adds a migration: `bun run db:dryrun`, and for real data, `bun run db:dryrun --data prod-data.sql --pending-from <version>` (see [self-hosting.md](./self-hosting.md#upgrading-an-existing-deploy)).
- [ ] No security-definer function in `public` is executable by a client role. Every row must be `f` / `f`:

    ```sql
    select p.proname,
           has_function_privilege('anon', p.oid, 'execute') as anon,
           has_function_privilege('authenticated', p.oid, 'execute') as authenticated
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef order by 1;
    ```

## Railway

- [ ] New project → Deploy from GitHub repo → `MrF1ow/foodable` (renamed from `nutrition-mcp`), branch `main`. Region: US East.
- [ ] Variables (do **not** set `PORT`):
      `DATABASE_URL` (`${{Postgres.DATABASE_URL}}`), `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `SESSION_SECRET`
      (all fresh from `bun run generate-oauth-creds`), `OFF_USER_AGENT=Foodable (<email>)`.
- [ ] Networking → Generate Domain. Set `PUBLIC_ORIGIN=https://<domain>` (no trailing slash). Redeploy.
- [ ] Optional custom domain: [self-hosting.md](./self-hosting.md#custom-domain-on-cloudflare). Cloudflare SSL/TLS mode is **Full**. Then point `PUBLIC_ORIGIN` at that origin and redeploy.
- [ ] `curl https://<domain>/health` → `ok`. `/.well-known/oauth-authorization-server` shows `https://<domain>` URLs.
- [ ] Confirm who already exists in this database before anyone opens the URL. On 2026-10-05 one user signed up, created a household named "Flow", and logged two test meals. If that account is the owner, skip sign-up and use it. If you want a clean start, wipe `public.users` and the rest of `public` data first: a second email is refused, and a second household cannot be created.
- [ ] **Immediately** open `https://<domain>/` and sign in as the owner (or sign up, if you wiped data), and create the household if there is not one yet.
      While no user accounts exist, the first visitor becomes the owner. Do not share the URL before the owner exists.
- [ ] Confirm a second sign-up attempt at `/` gets "Wrong email, username or password." (only the first account can self-register).

## Members and bots

- [ ] Household › Members: add each person (name, email or username, password). Hand them the login yourself.
- [ ] Each person: Claude.ai → Settings → Connectors → Add custom connector → `https://<domain>/mcp`, then sign in.
      Same URL in ChatGPT and Claude Code. Confirm `tools/list` loads. Remove any old nutrition-mcp connector.
- [ ] Grok CLI: point the `foodable` MCP server at `https://<domain>/mcp` and sign in again (`/mcps` → foodable → `i`). The local session on `http://localhost:8080/mcp` does not carry over.
- [ ] A username member signs in by typing just the username.
- [ ] As a member (not the owner), adding a person and rotating the token in Household › Members are both refused.
- [ ] Optional: as the owner, hand ownership to a member and back (Household › Members → Manage).
- [ ] As the owner, make a member an admin: they can add a person but cannot rotate the token, and you stay the owner. As a plain member, add and remove one of your own rules.
- [ ] Bots: Household › Members → rotate the token, copy it once, then configure
      `Authorization: Bearer nt_hh_…` against `https://<domain>/mcp`. The bot passes `user_id` for the person it acts for.

## Walk

Run this on the live site with two members.

- [ ] **Foods.** On `/household/items`, save **Eggs** with grams per each and calories per 100 g. Save **Toast** the same way.
- [ ] **Food-backed meal.** On `/`, set Meal type to Breakfast. Add Eggs: amount 2, unit each. Use **Add another food** for Toast: amount 1, unit each. Submit **Log meal**. Expect the meal total to equal the sum of the item snapshots.
- [ ] **Snapshot.** Change the egg calories on `/household/items`. Expect the logged breakfast to keep the old total.
- [ ] **Recipe to grocery.** On `/recipes`, save a recipe that uses eggs. Put a note on an ingredient and a tag on the recipe. Submit **Add to grocery**. Expect only what is not already stocked to be added.
- [ ] **Put away.** On `/grocery`, check that line and submit **Put away**. Expect `/fridge` to show the new stock. **Clear checked** does not stock the fridge.
- [ ] **Cook.** On the recipe, submit **Cooked it** with **Log meals** checked, for both members. Expect the fridge count to drop and two meals to appear, one per member. If stock is short, the shortfall is reported and the fridge does not go negative. With two lots of the same food, the earlier expiry is used first.
- [ ] **Eat and toss.** On `/fridge`, submit **Ate it** on one item and **Toss** on another. Expect **Ate it** to also log a meal.
- [ ] **Export.** Run `export_all_data`. Expect the ZIP to hold `meals.csv`, `meal_items.csv`, `water.csv`, `weight.csv`, `goals.csv`, `profile.csv`, and `README.txt`. `meal_items.csv` is keyed by `meal_id`, has a `timezone` column, and keeps its header with zero rows.
- [ ] **Agent surface.** `tools/list` returns 71 tools. `get_meals`, `get_water`, `get_weight`, `get_fridge`, `get_household_rules`, and `set_household_rules` exist. `list_grocery_lines` and `get_fridge` render their cards in a widget-capable client.
- [ ] **Barcode.** `lookup_barcode` on a real product returns data, which proves `OFF_USER_AGENT` is set.

Manual fridge add, edit, and delete write `adjust` movements, so after each step every item's stock should match its ledger.

## Retire the old deploy (confirm first)

- [ ] Shut down the old server.
- [ ] Delete the old database once the new one has run for a while and its backups are verified.
- [ ] Remove old connectors and DNS records.
