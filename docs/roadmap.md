# Foodable roadmap

What comes after go-live, in rough order. Each item names the rules it has to keep (`CLAUDE.md`, "Architecture rules"). The go-live steps are in [deploy-checklist.md](./deploy-checklist.md), not here.

## Now: live

- **Hosted on Railway, database on Railway Postgres.** Migrations run as the pre-deploy command. The deploy steps are in [deploy-checklist.md](./deploy-checklist.md).
- **Optional custom domain through Cloudflare DNS** in front of the Railway service ([self-hosting.md](./self-hosting.md#custom-domain-on-cloudflare)).

## Next: after the deploy has run for a while

1. **Nutrition calendar with per-day goals.** The Nutrition tab only shows today. Add a calendar view: a month grid where each day shows its calories against that day's goal, opening a day view with the day's meals, totals and macros, where meals can be added and edited for that day. The data is already per day (every meal, water and weight row has `logged_at`, read paths bucket by `dateInTz`, and `get_meals` takes `date` or `from`/`to`), so the view itself needs no schema change.
    - **Per-day goals.** `nutrition_goals` is one row per user today. Add the new shape first: a `nutrition_goal_days` table (`household_id`, `user_id`, `date`, the same `daily_*` columns, null meaning "use the default") with row level security and `service_role` grants in the same migration. The existing row stays the default; no backfill is needed because "no override" already means "use the default". A weekday pattern (say, a training-day target every Monday, Wednesday and Friday) can come later as a second table if per-date overrides prove tedious.
    - **One resolver.** A pure `goalsForDate(defaults, overrides, date)` in `src/domain/` with memory-store tests. Every reader that compares a day against goals goes through it: `get_goal_progress`, the meal-progress strip, `get_nutrition_summary`, `get_trends`, the dashboard data, insights and the weekly digest. A range read (trends, the calendar month) resolves each day separately, so averages compare against that day's own target, not today's.
    - **Surfaces.** Web: the calendar under the Nutrition tab, and a "goal for this day" form in the day view. MCP: let the goals tool take an optional `date` (or `from`/`to`) to set or clear a day's override, and include overrides in `export_all_data` (`goals.csv` or a new `goal_days.csv`, header-only when empty). Tool changes update `src/mcp/tools-list.snapshot.json` and `TOOLS` in the same PR.
    - Meals keep their denormalized totals; nothing about how meals are written changes.
2. **Weekly household digest (optional).** One tool across the pillars: what expires, what ran out, nutrition against goals per member, and suggested grocery lines from the stock ledger. Today's weekly digest covers nutrition only.

Still open, and not features:

- `groupMealVariations` in `src/search.ts` still groups by meal text, not by the `food_id` set.
- `package.json` `homepage` and `repository` still say `MrF1ow/nutrition-mcp`. The old URL redirects.
- Renaming Grocery to "Shopping list" stays deferred: copy only, and the table names stay.
- `profiles.locale` is unread (English only) and can go in a later contract migration, with the field on the `Profile` type.

## Later: planned features

### Camera barcode scanning

Scan a barcode with the phone camera in the web app instead of typing the digits. The lookup side already exists: `lookupBarcode` / `normalizeBarcode` (Open Food Facts) behind the web food picker (`runBarcodeLookupAction` in `src/web/components/food-picker.ts`), and the `lookup_barcode` MCP tool, which takes digits typed by the user or read from a photo of the package.

- Add a Scan button beside the barcode field that opens the camera, decodes EAN/UPC, and fills the field. Pick the decoder after checking the current options: the browser's native `BarcodeDetector` where it exists, with a bundled library as the fallback. Bundle it into `/app.js`. No CDN.
- Camera access needs HTTPS (or localhost). The production deploy has it; the tailnet `:8080` dev deploy may not.
- MCP agents already have `lookup_barcode`. Check whether they need more, for example a tool that adds a scanned product straight to the fridge or grocery list as a food with its barcode attached.

### Sharing

Two kinds of sharing. Neither opens sign-up or adds people to the household. The household stays closed, and a share grants nothing beyond the one object shared.

**Public read-only links.** A member shares a recipe or the grocery list as a link anyone can open without signing in.

- New table `share_links`: `household_id`, `kind` (`recipe` | `grocery_list`), `target_id` (null for the grocery list), `token_hash`, `created_by`, `created_at`, `expires_at` (nullable), `revoked_at`. Row level security enabled in the same migration, same shape as the other household tables. The raw token is shown once and only its hash is stored, like the household bot token.
- `GET /s/:token` renders a bare read-only page (`renderBarePage`, no bottom nav). It shows only the shared object: no member names, no nutrition history, no fridge contents beyond what a grocery line already says. Unknown, expired and revoked tokens all get the same 404.
- Create and revoke from the web app (a Share action on the recipe and on the grocery list, with a list of active links in Settings) and from MCP (`create_share_link`, `list_share_links`, `revoke_share_link`). Adding tools means updating `src/mcp/tools-list.snapshot.json` and `TOOLS` in the same PR.
- Rate-limit `/s/*` like the other public routes, and send `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`.
- Pure logic (token minting, expiry, what a share exposes) goes in `src/domain/sharing.ts` with an in-memory store and tests. The route and tools only adapt.

**Share with another household.** Each deploy is one household, so "another household" means another Foodable deploy. Recipes travel as a portable document rather than through a shared database.

- `GET /s/:token.json` returns the shared recipe as a versioned document: name, portions, instructions, tags, and ingredients by food name, amount and unit, plus each food's per-100 g nutrition and unit factors (`grams_per_ml`, `grams_per_each`). It never includes household ids, food ids or member data.
- The receiving deploy has an **Import recipe** action (web, plus an `import_shared_recipe` tool) that takes a share URL or the pasted JSON. Each ingredient resolves through `normalizeFoodName`: it matches an existing food or creates one with the shipped nutrition, never overwriting a food the household already has. A missing unit factor stays null, so the recipe shows as incomplete instead of guessing.
- Imported recipes are copies. Later edits on either side do not sync.
- The importer fetches only `https` URLs whose path matches `/s/<token>.json`, with a timeout and a size cap, so the import endpoint cannot be used to make the server request arbitrary URLs (SSRF).

### Own Postgres and auth

v1 is done: Foodable runs on plain Postgres through one `DATABASE_URL`, with its own user accounts. v2 makes row level security the real tenant boundary so a multi-household option stays possible. Phases, decisions and risks are in [postgres-plan.md](./postgres-plan.md).

## Not planned

Public sign-up, billing, a marketing site, translations, and per-user theming beyond the one accent (see `CONTRIBUTING.md`, "Out of scope").

In-app photo meal estimation is not planned either. Logging a plated meal from a photo already works through the household's own chat agents: `log_meal` tells the agent how to identify each dish, estimate portions, check `search_meals` for hidden ingredients, and confirm with the user before logging. A server-side vision call would add an API key, a per-photo cost, and image storage for something the agents already do. Improvements to that flow go in the `log_meal` / `search_meals` tool descriptions. Multi-household hosting is not planned either, but [postgres-plan.md](./postgres-plan.md) v2 keeps it possible.
