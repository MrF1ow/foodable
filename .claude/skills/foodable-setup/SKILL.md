---
name: foodable-setup
description: Walk a person through standing up their own Foodable deploy from nothing - accounts (GitHub, Railway, optional Cloudflare), Postgres, secrets, domain, owner sign-up, and connecting their AI agents. Use when someone asks to set up, install, deploy, or self-host Foodable.
---

# Set up Foodable

You are guiding one person from no accounts to a running Foodable deploy that their AI agents can reach. They may not be technical. Any agent can follow this, not only Claude Code. To start it, a person can say: _"Read `.claude/skills/foodable-setup/SKILL.md` and walk me through setting up Foodable."_

The facts behind each step live in [docs/self-hosting.md](docs/self-hosting.md) and [docs/deploy-checklist.md](docs/deploy-checklist.md). This file sets the order and the conversation. When the two disagree, the docs win, and tell the person.

## How to run this

- **One step at a time.** Say what the step is for, do it or tell them exactly what to click, then confirm it worked before moving on. Keep a visible checklist of the steps and tick them off.
- **Do what you can, hand over what you can't.** You can run the CLI commands. The person has to do anything that needs their identity: creating accounts, paying, approving OAuth screens in a browser, choosing their own password.
- **Secrets never pass through the chat.** Generate them on the machine and pipe them straight into Railway (step 4). Never ask the person to paste a password, token, or API key into the conversation, and never print one back. If they paste one anyway, tell them to rotate it once setup is done.
- **Ask before anything that costs money or is hard to undo:** creating the Railway project, buying a domain, changing a Cloudflare zone setting.
- **Stop when something fails.** Read the error, check the Troubleshooting table, and fix it before going on. Don't skip a step to get to the end.

## Step 0: Find out what they have

Ask these questions together, in one message:

1. Do you have a **GitHub** account? (Required. Railway deploys from your copy of the repo.)
2. Do you have a **Railway** account? (Required. It runs the app and the database. After the trial it needs a paid plan; send them to <https://railway.com/pricing> instead of quoting a price.)
3. Do you want your own **domain**, like `food.example.com`? If so, is it on **Cloudflare**? (Optional. Without one you get a free `something.up.railway.app` address, and that is enough to go live.)
4. Which **email** should go in the Open Food Facts contact string? (For barcode lookups. It is sent to Open Food Facts with each request, nowhere else.)
5. Which **AI apps** will connect: Claude, ChatGPT, Claude Code, Grok, a bot?
6. Is this **a new household**, or are you moving data from an older Foodable or nutrition-mcp database?

Then check the tools on this machine, and install any that are missing (ask first):

```bash
git --version
bun --version            # https://bun.sh
railway --version        # https://docs.railway.com/guides/cli
gh --version             # optional, makes forking one command
openssl version
```

Tell them what you found and what comes next before going on.

## Step 1: Their own copy of the code

Railway deploys from a GitHub repo they own, so updates are theirs to pull in.

```bash
gh repo fork MrF1ow/foodable --clone --remote
cd foodable
bun install
```

Without `gh`: they click **Fork** on <https://github.com/MrF1ow/foodable>, then you `git clone` their fork.

Deploy the latest release, not whatever is on upstream `main`. Releases mark points where the schema and the code that needs it have both landed:

```bash
git fetch upstream --tags
latest=$(gh release view --repo MrF1ow/foodable --json tagName --jq .tagName)
git reset --hard "$latest" && git push --force origin main
```

`gh repo fork --remote` already added the `upstream` remote; after a manual clone, add it with `git remote add upstream https://github.com/MrF1ow/foodable.git`. The fork is brand new, so resetting it loses nothing. If there is no release yet, stay on `main`. Tell them that later updates mean merging the next release tag ("Upgrading an existing deploy" in `docs/self-hosting.md`).

## Step 2: Railway access

1. `railway login`. A browser opens and they sign in or sign up. Use `railway login --browserless` only when this machine really has no browser (SSH, container). Then the command prints a code and waits: run it in the background and show them the URL and code right away, because the code expires in 10 minutes.
2. `railway whoami` confirms it.
3. Railway needs to be allowed to read their fork. In the Railway dashboard, under account settings, they connect GitHub and grant the Railway app access to the `foodable` repo. (Railway also asks for this the first time a project deploys from GitHub.)

If your harness has the Railway MCP server, you can use its tools instead of the CLI. The steps stay the same.

## Step 3: Project, database, app

Confirm before creating anything. Then:

```bash
railway init --name foodable --json
railway add --database postgres --json
railway add --service foodable --repo <github-user>/foodable --branch main --json
```

The first deploy may fail because the variables aren't set yet. That's expected; step 4 fixes it.

Two things are left. Walk them through both:

- **Railway config.** `.railway/railway.ts` sets the Dockerfile build, health check, restart policy, wait-for-CI, region, custom domain and the pre-deploy command `bun run db:migrate`, which applies the database schema before each new version goes live (if a migration fails, the old version keeps running). In their fork, edit it: the repo in `github(...)`, the region key in `replicas`, and delete the `domains` line (`railway config plan` fails on a domain Railway does not know yet; the file records the custom domain once it exists, see step 6). The `service("foodable")` name must match the service from step 3. Then `railway config plan`, read the result with them (nothing should be destroyed), and `railway config apply`. Committing the file changes nothing on Railway by itself. If apply is not possible, set the same things by hand under Settings: Dockerfile builder, health check `/health` with a 60 s timeout, restart on failure, and pre-deploy command `bun run db:migrate`.
- **Backups.** On the Postgres service, turn on backups now, before any household data exists.

The database needs no public address. The app reaches it over Railway's private network.

## Step 4: Variables and secrets

Set these on the `foodable` service. The secrets are generated and piped straight in, so they never appear in the chat or the terminal output:

```bash
railway variable set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' --service foodable --skip-deploys
openssl rand -hex 16 | tr -d '\n' | railway variable set OAUTH_CLIENT_ID --stdin --service foodable --skip-deploys
openssl rand -hex 32 | tr -d '\n' | railway variable set OAUTH_CLIENT_SECRET --stdin --service foodable --skip-deploys
openssl rand -hex 32 | tr -d '\n' | railway variable set SESSION_SECRET --stdin --service foodable --skip-deploys
railway variable set 'OFF_USER_AGENT=Foodable (<their email>)' --service foodable --skip-deploys
```

Keep `${{Postgres.DATABASE_URL}}` in single quotes so the shell leaves it alone. Railway fills it in. Do **not** set `PORT`: Railway sets it.

The secrets are stored in Railway, which is where they belong. Nobody needs a copy: if one is lost, set a new value. A new `SESSION_SECRET` signs everyone out of the web app once. MCP connections keep working.

Check the names (not the values) with `railway variable list --service foodable --json`.

## Step 5: Public address and first deploy

```bash
railway domain --service foodable --json
```

Take the generated `https://….up.railway.app` origin, with no trailing slash, and set it:

```bash
railway variable set 'PUBLIC_ORIGIN=https://<generated-domain>' --service foodable
```

Setting it without `--skip-deploys` starts a deploy. Watch it with `railway logs --service foodable`. Once it's live, check:

```bash
curl -s https://<domain>/health                                 # ok
curl -s https://<domain>/.well-known/oauth-authorization-server # URLs on https://<domain>
```

**Don't share the address yet.** Until an account exists, whoever opens the site first becomes the household owner. Go straight to step 7, or step 6 if they want a custom domain.

## Step 6 (optional): Custom domain on Cloudflare

Skip this if they're happy with the Railway address. It needs a domain they own. Cloudflare is DNS and a proxy in front of Railway here. The app does not run on Cloudflare.

1. `railway domain <food.example.com> --service foodable --json` prints a CNAME target and a TXT record.
2. In Cloudflare DNS, they add both records. The CNAME is proxied (orange cloud).
3. Cloudflare SSL/TLS mode: **Full**. Not Flexible, which makes a redirect loop, and not Full (strict), which gives intermittent 526 errors while Railway renews its certificate. This setting is per zone, so ask first if other sites already use that domain.
4. If Railway stays on "Validating Challenges", turn the orange cloud off until the certificate is issued, then turn it back on. Check with `railway domain status <domain> --service foodable --json`.
5. `railway variable set 'PUBLIC_ORIGIN=https://<custom-domain>' --service foodable`, then repeat the step 5 checks against the new domain.
6. Optional: put `domains: [{ domain: "<custom-domain>", port: 8080 }]` back in `.railway/railway.ts` so the file records it. `railway config plan` should then show no change.

Use a single-level name like `food.example.com`. A deeper one, like `app.food.example.com`, only works through the proxy with Cloudflare's paid Advanced Certificate Manager.

You can make the DNS changes yourself only if they create a Cloudflare API token scoped to **Zone, DNS, Edit** on that one zone, and only if it reaches you without passing through the chat (an environment variable they set). Otherwise, read out the exact records and they click.

## Step 7: Claim the household

The person does this in their own browser. You never see the password.

1. Open `https://<domain>/` and sign up with an email and a password. The first account becomes the owner. After that, sign-up is closed.
2. On **Create household**, enter a household name and their own name.
3. Check that it's closed: in a private window, try signing up with a different email. It should say "Wrong email, username or password."

Moving data from an older database? That happens **before** step 7, with a database that has no accounts in it yet. Follow "Moving data between databases" in [self-hosting.md](docs/self-hosting.md#moving-data-between-databases), using a temporary TCP proxy on the Railway Postgres, and remove the proxy afterwards.

## Step 8: Connect their agents

The MCP address is `https://<domain>/mcp`. Each app signs in through the Foodable login page, with the person's own household account.

- **Claude (web, desktop, mobile):** Customize, then Connectors, then **+**, then Add custom connector. Name it Foodable, paste the URL, Connect, sign in.
- **ChatGPT:** add it as a custom connector with the same URL.
- **Claude Code:** `claude mcp add --transport http foodable https://<domain>/mcp`, then run the /mcp command inside Claude Code to sign in.
- **Grok CLI and other local agents:** add an HTTP MCP server with the same URL. Loopback OAuth callbacks are already allowed.
- **A bot or another server:** the owner rotates the household token in Settings, then Household, copies it once, and gives the bot `Authorization: Bearer nt_hh_…`. If the bot uses OAuth instead, its callback URL goes in `ALLOWED_REDIRECT_URIS`.

To test it, ask the agent to "show my fridge" or "log a glass of water". If it finds 67 Foodable tools, it worked.

## Step 9: Add people and wrap up

- Other household members are added by the owner in **Settings, then Household**, with an email or a plain username and a password. There are no invite links. The owner hands over the logins.
- Give the person a short summary: the site URL, the MCP URL, the Railway project name, that backups are on, and that secrets live only in Railway.
- **Updates:** when the upstream repo (MrF1ow/foodable) gets new commits, they sync their fork on GitHub, and Railway redeploys on its own, running migrations first.
- **Their own backup:** the `export_all_data` tool downloads a ZIP of their data whenever they like.

## Troubleshooting

| Symptom                                               | Likely cause and fix                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy fails right after step 3                       | Variables aren't set yet. Finish step 4, then `railway redeploy --service foodable`.                                                  |
| Deploy fails at pre-deploy                            | A migration failed and the old version is still serving. Read it with `railway logs --service foodable`. Never edit a migration file. |
| App can't reach the database                          | `DATABASE_URL` was set to a literal URL or a typo. It should be exactly `${{Postgres.DATABASE_URL}}`.                                 |
| Agent's OAuth screen shows the wrong host             | `PUBLIC_ORIGIN` is missing, has a trailing slash, or still points at the old domain.                                                  |
| "Too many redirects" on the custom domain             | Cloudflare SSL/TLS is on Flexible. Set it to Full.                                                                                    |
| Error 526 on the custom domain                        | SSL/TLS is on Full (strict). Set it to Full.                                                                                          |
| Second person can't sign up                           | Working as intended. The owner adds them in Settings, then Household.                                                                 |
| Barcode lookups fail                                  | `OFF_USER_AGENT` is missing or isn't in the form `Foodable (email)`.                                                                  |
| Meal widget shows an empty "Foodable" card            | No nutrition goals are set yet. Set goals first.                                                                                      |
| `railway login --browserless` link never showed up    | It ran in the foreground and the code expired. Rerun it in the background and show the URL right away.                                |
