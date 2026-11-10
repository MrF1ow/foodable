# Foodable

Foodable is a self-hosted MCP platform for one household. People use it through their AI agents and a small web app. It is personal and open source. It is not a public hosted service.

The goal is one cohesive system. Buying, storing, cooking, and eating are steps of one loop, not four separate trackers.

## Five pillars

| Pillar        | What it is                                                                 |
| ------------- | -------------------------------------------------------------------------- |
| **Fridge**    | What is in the house, by location, with quantity                           |
| **Groceries** | The shopping list, already-have against the fridge, store and person rules |
| **Nutrition** | Meals, water, weight, goals, trends, and CSV import from other apps        |
| **Recipes**   | Household recipes, portions, and remainder lines onto the grocery list     |
| **Settings**  | Household members, appearance, timezone, and shared preferences            |

Every pillar is meant to refer to the same foods. That shared catalog is the household `foods` table: fridge items, grocery lines, recipe ingredients and food-backed meals all point at it, and the stock ledger ties putting groceries away, cooking and eating back to the fridge.

## Self-hosting

Easiest path: open this repo in your AI agent and say _"Read `.claude/skills/foodable-setup/SKILL.md` and walk me through setting up Foodable."_ It asks what accounts you have (GitHub, Railway, optionally Cloudflare), runs the commands it can, and tells you what to click for the rest.

This is a single-household deploy. Clone the repo, copy `.env.example` to `.env`, point `DATABASE_URL` at any Postgres, apply the migrations in `db/migrations/`, and run the server.

```bash
git clone https://github.com/MrF1ow/foodable.git
cd foodable
bun install
bun run db:dev init    # optional: local Postgres on :54330, prints DATABASE_URL
cp .env.example .env   # fill in DATABASE_URL and OAuth values
bun run db:migrate     # applies db/migrations/
bun src/index.ts       # http://localhost:8080
```

`bun run generate-oauth-creds` prints `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, and `SESSION_SECRET` (site cookie signing). Open Food Facts barcode lookup needs `OFF_USER_AGENT` in the form `Foodable (you@example.com)`.

The app is set up to run on [Railway](docs/self-hosting.md#railway) with Railway Postgres; `bun run db:migrate` runs as the pre-deploy command. Go-live steps are in [docs/deploy-checklist.md](docs/deploy-checklist.md).

## Docs

| Doc                                                  | What it is                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [docs/self-hosting.md](docs/self-hosting.md)         | Environment, Postgres and migrations, Railway, Cloudflare, and the first-user flow |
| [docs/deploy-checklist.md](docs/deploy-checklist.md) | Ordered go-live list                                                               |
| [CONTRIBUTING.md](CONTRIBUTING.md)                   | What fits in the repo, and how to open a pull request                              |

## Connecting an agent

Point any MCP client at your own `/mcp` URL, for example `https://your-host/mcp`.

On Claude.ai: Customize → Connectors → + → Add custom connector → name it Foodable → paste the URL → Connect. Sign in with the household account. Data stays on your deploy.

The login page is the OAuth screen at `/authorize` (and `/` when you are signed out). There is no public marketing site.

```bash
bun run dev             # regenerates login HTML, then watches src/
bun test                # test suite
bun run check:changed   # the CI checks for what you changed (--all for everything)
bun run typecheck       # typecheck the whole project, tests and scripts included
bun run lint            # oxlint with the repo's own rules
bun run format          # Prettier, 4-space indent
```

Login templates under `public/login.html` are generated. After editing `src/copy/login.ts` or `scripts/site-partials.ts`, run `bun run gen:all`.

## Forked from nutrition-mcp

Foodable is a fork of [akutishevsky/nutrition-mcp](https://github.com/akutishevsky/nutrition-mcp). The original is a hosted nutrition MCP server. This fork keeps that nutrition work and is turning it into a household food platform.

## License

[MIT](LICENSE)
