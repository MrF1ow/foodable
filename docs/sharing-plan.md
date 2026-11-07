# Sharing: plan

Status: proposed. Moved out of [ROADMAP.md](../ROADMAP.md) on 2026-11-07, unchanged.

Two kinds of sharing. Neither opens sign-up or adds people to the household. The household stays closed, and a share grants nothing beyond the one object shared.

## Public read-only links

A member shares a recipe or the grocery list as a link anyone can open without signing in.

- New table `share_links`: `household_id`, `kind` (`recipe` | `grocery_list`), `target_id` (null for the grocery list), `token_hash`, `created_by`, `created_at`, `expires_at` (nullable), `revoked_at`. Row level security enabled in the same migration, same shape as the other household tables. The raw token is shown once and only its hash is stored, like the household bot token.
- `GET /s/:token` renders a bare read-only page (`renderBarePage`, no bottom nav). It shows only the shared object: no member names, no nutrition history, no fridge contents beyond what a grocery line already says. Unknown, expired and revoked tokens all get the same 404.
- Create and revoke from the web app (a Share action on the recipe and on the grocery list, with a list of active links in Settings) and from MCP (`create_share_link`, `list_share_links`, `revoke_share_link`). Adding tools means updating `src/mcp/tools-list.snapshot.json` and `TOOLS` in the same PR.
- Rate-limit `/s/*` like the other public routes, and send `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`.
- Pure logic (token minting, expiry, what a share exposes) goes in `src/domain/sharing.ts` with an in-memory store and tests. The route and tools only adapt.

## Share with another household

Each deploy is one household, so "another household" means another Foodable deploy. Recipes travel as a portable document rather than through a shared database.

- `GET /s/:token.json` returns the shared recipe as a versioned document: name, portions, instructions, tags, and ingredients by food name, amount and unit, plus each food's per-100 g nutrition and unit factors (`grams_per_ml`, `grams_per_each`). It never includes household ids, food ids or member data.
- The receiving deploy has an **Import recipe** action (web, plus an `import_shared_recipe` tool) that takes a share URL or the pasted JSON. Each ingredient resolves through `normalizeFoodName`: it matches an existing food or creates one with the shipped nutrition, never overwriting a food the household already has. A missing unit factor stays null, so the recipe shows as incomplete instead of guessing.
- Imported recipes are copies. Later edits on either side do not sync.
- The importer fetches only `https` URLs whose path matches `/s/<token>.json`, with a timeout and a size cap, so the import endpoint cannot be used to make the server request arbitrary URLs (SSRF).
