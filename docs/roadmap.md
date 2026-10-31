# Foodable roadmap

What comes after go-live, in rough order. Each item names the rules it has to keep (`CLAUDE.md`, "Architecture rules"). The go-live steps are in [deploy-checklist.md](./deploy-checklist.md), not here.

## Now: live

- **Hosted on Railway, database on Supabase cloud** (project `dapbxswqfiqvxutsobhr`). The deploy steps are in [deploy-checklist.md](./deploy-checklist.md).
- **Optional custom domain through Cloudflare DNS** in front of the Railway service ([self-hosting.md](./self-hosting.md#custom-domain-on-cloudflare)).

## Next: after the deploy has run for a while

1. **Phase 8, contract.** Two steps, because old code reads the columns and new code no longer writes them, so no single deploy order works.
    - **Step 1 (done):** the code stops reading and writing the legacy columns, and `20261031120000_relax_legacy_identity` lets `identity` be null. Push that migration before the deploy. Then exercise every write path once in production (fridge, grocery, put-away, recipe ingredients, cook, household config) and check that new rows have a null `identity` and a non-null `food_id`.
    - **Step 2:** after that soak, take a backup and ship the contract below as one PR with its code cleanup. The dry-run harness needs changes too (`check.sql` asserts on `bootstrap_household`, and the re-run step replays a backfill that reads `identity`), and those files are behind the Gate check. Every destructive statement carries `-- foodable:contract <reason>`.
    - Drop `fridge_items.identity`, `grocery_lines.identity`, `recipe_ingredients.identity`, `recipe_ingredients.nutrition`, and `member_dislikes.identity`.
    - Set `fridge_items.food_id`, `grocery_lines.food_id`, and `recipe_ingredients.food_id` to `not null`.
    - Drop `households.fridge_locations`. `fridgeLocations` still sits on the household config type and mapper in `src/household.ts`. It is not exposed through MCP or the web, and it goes with the column.
    - Delete `ManualRef` and `householdManualId` from `src/domain/food-identity.ts`, the `identity` fallback in `sameFood` (`src/domain/linking.ts`), and the `identity` and `nutrition` fields left on the domain types.
    - Drop `bootstrap_household`. Nothing in `src/` calls it.
    - Drop `profiles.accent_swatch`, and the field from the `Profile` type and `upsertProfile` in `src/db/profiles.ts`.
    - Remove `comingSoonPage` in `src/web/shell.ts`. Tests are the only callers.
2. **Weekly household digest (optional).** One tool across the pillars: what expires, what ran out, nutrition against goals per member, and suggested grocery lines from the stock ledger. Today's weekly digest covers nutrition only.

Still open, and not features:

- `groupMealVariations` in `src/search.ts` still groups by meal text, not by the `food_id` set.
- `package.json` `homepage` and `repository` still say `MrF1ow/nutrition-mcp`. The old URL redirects.
- Renaming Grocery to "Shopping list" stays deferred: copy only, and the table names stay.

## Later: planned features

### Sidebar navigation on larger screens

The web app uses the phone layout everywhere: a sticky, frosted, icon-only bottom nav (`bottomNav` in `src/web/components/bottom-nav.ts`, `.bottom-nav` in `public/app/app.css`). On a tablet or desktop that leaves the tabs at the bottom edge of a wide screen.

- From a breakpoint (the app already uses `768px`), swap the bottom nav for a sidebar on the left: the same `APP_TABS` and icons, with the tab labels shown beside them. Phones keep the bottom nav unchanged.
- Render one nav and switch its layout with CSS, rather than emitting two navs, so there is still one `aria-current` link and one landmark. If two navs turn out simpler, hide the inactive one from assistive tech.
- `has-bottom-nav`, the `--nav-chrome` overscroll shadow, the bottom-nav `theme-color` (`THEME_NAV_COLOR`) and the toast position (bottom-centre above the nav on phones) all assume the nav is at the bottom. Each needs a wide-screen rule.
- Keep it inside the brand layer (`app.css`), and cover it in `bun run check:nav` and `bun run preview:app --shots` at both widths. Turbo morphs must keep the sidebar in place without re-animating it.

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

### Local Postgres instead of Supabase

Run Foodable against plain Postgres (a container next to the app, or a managed Postgres) with no Supabase services. Supabase cloud stays the default and stays supported.

What the app uses Supabase for today, and what replaces it:

| Supabase piece | Used for                                                                                                                | Replacement                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PostgREST      | about 125 `.from(…)` queries in the `src/db/` adapters and the `create_household` / `transfer_household_ownership` RPCs | A second adapter per domain on `Bun.sql`. The domain modules already sit behind store interfaces, so only `src/db/` changes.                                             |
| GoTrue (Auth)  | sign-up, sign-in, admin create, delete and list users                                                                   | A local `users` table with `Bun.password` (argon2id) hashes, behind one `AuthStore` interface with a Supabase and a Postgres implementation.                             |
| Storage        | the `exports` bucket and its signed download link                                                                       | Write the ZIP to a volume and serve it from a signed, expiring `/exports/:token` route, or skip storage and stream the ZIP in that response.                             |
| `auth` schema  | 17 migrations reference `auth.users` or `auth.uid()`                                                                    | A small `auth` shim schema (`auth.users`, `auth.uid()`) created before the migrations. `scripts/migration-dryrun.ts` already stubs exactly these pieces, so start there. |

Plan:

1. Add the store interfaces at the seams that are still Supabase-shaped (auth and export storage), with Supabase as the only implementation. No behavior change.
2. Add the Postgres implementations behind `DATABASE_URL`: if it is set, Bun.sql; otherwise `SUPABASE_URL`. Run the existing tests against both.
3. Ship a `docker-compose.yml` with Postgres and the app, plus a `docs/self-hosting.md` section. Migrations run from `supabase/migrations/` with the auth shim, so there is one schema history for both backends.
4. Document moving from Supabase to Postgres: `export_all_data` per member, or `pg_dump` of `public` plus a script that copies `auth.users` ids and emails. Password hashes do not carry over, so members set new passwords.

Rules it keeps: one schema history, row level security stays on (Postgres enforces it the same way), and no migration is edited after it is on `main`.

## Not planned

Multi-tenant hosting, public sign-up, a marketing site, translations, and per-user theming beyond the one accent (see `CONTRIBUTING.md`, "Out of scope").
