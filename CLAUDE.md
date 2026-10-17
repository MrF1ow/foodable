# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Foodable is a self-hosted MCP platform for one household, built with Bun and TypeScript. Entry point is `src/index.ts`. It is a fork of `akutishevsky/nutrition-mcp`; the GitHub repo remains [https://github.com/MrF1ow/nutrition-mcp](https://github.com/MrF1ow/nutrition-mcp). It is not a public hosted service. Version is `0.1.0` in two places: `package.json` and `src/mcp/server.ts` (the `McpServer` constructor).

It runs on MCP TypeScript SDK **v2** (`@modelcontextprotocol/server` at runtime, `@modelcontextprotocol/client` only in tests) with Zod 4 as an explicit dependency; `@modelcontextprotocol/sdk` v1 is gone, so import `McpServer`, `InMemoryTransport`, `createMcpHandler` from `@modelcontextprotocol/server`. Every `inputSchema` / `outputSchema` here is a schema object (`z.object({…})`), never a raw shape: v2 still auto-wraps raw Zod 4 shapes via a deprecated overload, but the explicit form is the supported path, and it lets the exported `*_OUTPUT_SCHEMA` constants be `.parse()`d directly in tests. `/mcp` is a dual-era endpoint built on `createMcpHandler` (`src/mcp/server.ts`): it serves the `2026-07-28` revision (per-request `_meta` envelope, `server/discover`, no protocol-level sessions, `Mcp-Method` / `Mcp-Name` routing headers validated against the body) and, through the default `legacy: "stateless"` fallback, still answers `2025-11-25` clients with the same per-request `initialize` idiom the old hand-rolled transport used — one server factory backs both eras. The factory gets no Hono context: the authenticated actor travels in `authInfo.extra.auth` (`AuthContext`) from `handleMcp`, and the public origin (for the icon URL) is read from `ctx.requestInfo`. When `PUBLIC_ORIGIN` is set, `getBaseUrl` in `src/url.ts` returns it and ignores `X-Forwarded-*`; when unset, the request Host / forwarded headers still win. The "/mcp over HTTP" section of `src/mcp.test.ts` drives both eras in-process by pointing a v2 `Client`'s `fetch` at the Hono route — there is no in-memory transport for the modern era, so that is the only way to test it. It lives inside `mcp.test.ts` deliberately: `mock.module` is process-wide, and a separate file with its own mock/restore of the same db module broke `middleware.test.ts`'s mock on Linux CI (not reproducible on macOS). Two rules follow: stub `./db/*.js` from an existing mock window rather than opening another, and restore from a snapshot taken **before** `mock.module` — Bun patches the namespace in place, so restoring from the live import is a no-op. `listChanged` is advertised `false` on purpose: the endpoint is stateless and refuses GET, so no channel exists to deliver a list-changed notification. Two v2 wire facts worth knowing: advertised schemas are JSON Schema 2020-12 (v1 stamped draft-07), and a POST whose `Content-Type` is not `application/json` is answered `415` before the body is read. The server advertises `public/favicon.ico` plus the light and dark tile SVGs (`/brand/icon-light.svg`, `/brand/icon-dark.svg`, with the icon `theme` field). Tool call analytics (duration, success/failure, error category) are tracked via `src/analytics.ts` and persisted to a `tool_analytics` Supabase table.

**Registered tool set.** `src/mcp/server.ts` holds the server factory and `SERVER_INSTRUCTIONS`, and calls one `registerXTools(server, ctx)` per domain module in `src/mcp/tools/` (`nutrition`, `nutrition-insights`, `water`, `weight`, `goals`, `profile`, `food`, `fridge`, `grocery`, `recipes`, `rules`, `household`). `src/mcp/shared.ts` holds `withAnalytics`, actor resolution, `uiMeta` and the shared schemas and formatters. `src/mcp.ts` is a temporary re-export barrel for older imports. There are 67 tools; `src/mcp/tools-list.snapshot.json` pins the `tools/list` names and order and `src/mcp.test.ts` compares against it, so update the snapshot and `TOOLS` in the same PR as any tool change. `src/mcp.test.ts` asserts `TOOLS` names in `src/copy/tools.ts` match `tools/list` and that person-scoped catalog cards include optional `user_id`. Nutrition writes also accept optional `target_member` (MCP only). That file is an identity catalog (names, params, household/oauth splits), not a public `/tools` page.

## Architecture rules

These are the rules in `docs/handoff/foodable-architecture-plan.md`. Follow them for every change. Do not start a later phase from a PR that owns an earlier one.

- **Subtract before you add.** Phase 0 removes upstream leftovers before any feature work.
- **Moves before changes.** Phase 1 is pure file moves with zero behavior change. Feature diffs after it stay small and reviewable.
- **Expand, backfill, switch, contract.** Every schema change ships as additive columns or tables, then a backfill, then code reads the new shape, then a later migration drops the old shape. No migration is destructive and backfilling in the same step.
- **Keep the mature nutrition stack untouched.** Meals keep their denormalized totals (`calories`, `protein_g`, and the rest). Insights, widgets, goals, import, and export keep reading those columns. Food-backed meals compute the totals on write.
- **Pure functions plus thin adapters.** New logic (put-away, cook, eat, unit resolution) lives in pure modules with memory-store tests. `mcp.ts` and the routes only adapt. Domain modules in `src/domain/` (`fridge.ts`, `grocery.ts`, `recipes.ts`, `settings.ts`, `rules.ts`, `linking.ts`, `quantity.ts`) already follow that pattern: store interface, in-memory store, row mappers, pure functions. Keep it.
- **One household per deploy stays.** New tables still carry `household_id` and the same RLS shape, for consistency and for a future multi-household option.

Layout: `src/db/` is one Supabase adapter per domain, `src/domain/` the pure modules, `src/mcp/` the agent surface, and `src/web/` the household app (`shell.ts`, `loaders.ts`, `routes/` one Hono sub-app per tab, `pages/`, `components/`, `middleware.ts` for the site actor, `form.ts` for form parsing). `src/app/` is gone. Auth, OAuth, rate limiting and analytics still sit at the top of `src/`.

Host-agnostic config: optional `PUBLIC_ORIGIN` (see `.env.example` and `docs/self-hosting.md`). Docker keeps `--smol`. English only; do not restore locale switchers, `set_language`, or `src/copy/*.<locale>.ts`. There is one accent, the logo green `#28cf8b` (`BRAND_GREEN` in `src/brand.ts`, `--accent` in `public/widgets/src/shared/tokens.css`), the same in both themes, on the app, the login page, the widgets and the icons alike. Text on an accent fill uses `--on-accent`, never `--bg` or white.

**Brand icons.** `src/brand.ts` holds the logo as hand-built SVG geometry: the bare mark, a light tile (green on `#f1f1f1`), a dark tile (white on `#383838`) and an adaptive favicon that switches on `prefers-color-scheme`. `scripts/gen-icons.ts` (`bun run gen:icons`, needs `rsvg-convert` and ImageMagick) writes `public/brand/*.svg`, `public/favicon.ico` and `public/apple-touch-icon.png` from it; `src/brand.test.ts` fails when the committed SVGs drift from the module. `/brand/:file` serves the SVGs straight from the module. Do not hand-edit the generated files.

## Household data model

Every pillar points at one household `foods` row (`src/domain/foods.ts`). Fridge items, grocery lines, recipe ingredients and dislikes carry `food_id`. Barcodes and aliases hang off a food (`food_barcodes`, `food_aliases`). Manual names resolve through `normalizeFoodName`, so "Eggs", "eggs " and "EGGS" are one food, and `mergeFoods` repoints every reference when duplicates slip in. Supplies are foods with `kind = 'supply'`. `foods` holds nutrition **per 100 g**, and null means unknown, never zero. OFF values only reach those columns when OFF reported them per 100 g (`catalogNutritionFromOff`), because the `food_cache` payload is per serving whenever a product lists a serving size.

- **Contract is pending.** Writes still fill the old `identity` JSON beside `food_id`, derived from the food, and `households.fridge_locations` still exists. Both go in Phase 8. Do not read `identity` in new code.
- **Units.** Quantities keep their own unit. `toGrams` in `src/domain/food-quantity.ts` is the one conversion path. Volume needs `grams_per_ml` and `each` needs `grams_per_each`, and a missing factor returns null rather than a guess. That null makes a recipe "incomplete", with the missing factor named.
- **Food-backed meals.** `meal_items` rows are write-time snapshots (`buildMealFromItems` in `src/domain/meals.ts`). When a meal has items, the write path sets the `meals` totals to the null-aware sum of the snapshots, so every reader of `meals` is unchanged. Editing a food later never rewrites a logged meal. Free-text meals with no items still work exactly as before.
- **Stock ledger.** `fridge_items` is current state. `stock_movements` is the audit trail, written by `applyMovement` in `src/domain/stock.ts` for put-away, cook, eat and discard. Manual `add_fridge_item` / `update_fridge_item` / `delete_fridge_item` and the web forms behind them write an `adjust` movement through the same function (`addFridgeItemAdjust`, `updateFridgeItemQuantityAdjust`, `deleteFridgeItemAdjust`), so `ledgerMatchesStock` holds for every item. Decrements go oldest expiry first and never below zero: a shortfall is reported, not clamped. A decrement aimed at one `fridgeItemId` only touches that item. A movement never records the id of an item it just deleted: `fridge_item_id` is a foreign key, so it would be rejected.

### Migrations

Schema lives only in `supabase/migrations/`. Production applies them with `supabase db push`. Before pushing, run `bun run db:dryrun`. It starts a throwaway local Postgres (set `PG_BIN` if `initdb` is not on `PATH`) and stubs the parts of Supabase the migrations touch. It applies every migration older than `DEFAULT_PENDING_FROM` in `scripts/migration-dryrun.ts` as the baseline. Then it loads `scripts/migration-dryrun/seed.sql`, applies the pending migrations one transaction per file the way `db push` does, and asserts `check.sql` plus a re-run no-op. `--data <file>` swaps the fixture for a data-only production dump (`pg_dump "$DATABASE_URL" --data-only --schema=public -f prod-data.sql`), and then `--pending-from <version>` must name the first migration production has not applied. Leave `DEFAULT_PENDING_FROM` where it is: the fixture is written against the schema before it, and every later migration (including new ones) runs on top of the fixture. An unapplied migration may be edited in place; an applied one never is.

## Commands

- `bun run src/index.ts` - Run the server
- `bun --watch src/index.ts` - Run with watch mode (restarts on file changes)
- `bun test` - Run all tests
- `bun test src/path/to/file.test.ts` - Run a single test file
- `bun run format` - Format code with Prettier (4-space indentation)
- `bun run format:check` - Verify the tree is prettier-clean (CI runs this on every PR)
- `bun run db:dryrun` - Apply the pending migrations to a throwaway local Postgres and check the backfill (see "Migrations" below)
- `bun run typecheck` - Typecheck `src/` (CI runs this on every PR; it is scoped to `src/`, so a type error in a test file or under `scripts/` will not be caught)
- `bun run gen:tokens` - Write `public/widgets/src/shared/tokens.css` from `src/tokens.ts`

The committed tree is kept prettier-clean, so `bun run format` only rewrites files you actually edited. Generated output that must not be formatted goes in `.prettierignore`.

## Bun Runtime

Default to Bun for everything. Do not use Node.js equivalents.

- `bun <file>` instead of `node`/`ts-node`
- `bun install` instead of `npm install`
- `bun run <script>` instead of `npm run`
- `bunx <pkg>` instead of `npx`
- Bun auto-loads `.env` — don't use dotenv

### Preferred Bun APIs

- `Bun.serve()` for HTTP/WebSocket servers (not Express)
- `bun:sqlite` for SQLite (not better-sqlite3)
- `Bun.redis` for Redis (not ioredis)
- `Bun.sql` for Postgres (not pg/postgres.js)
- `Bun.file` for file I/O (not node:fs readFile/writeFile)
- `Bun.$\`cmd\`` for shell commands (not execa)
- Built-in `WebSocket` (not ws)

### Testing

```ts
import { test, expect } from "bun:test";
```

### Frontend (if needed)

Use HTML imports with `Bun.serve()` — not Vite. HTML files can directly import `.tsx`/`.jsx`/`.js` and Bun bundles automatically. Bun API docs: `node_modules/bun-types/docs/**.mdx`.

---

## Custom UI Widgets (MCP Apps)

In-chat UI uses **MCP Apps** (the official 2026-01-26 MCP extension), which renders across Claude, ChatGPT, VS Code, Goose, and MCP Inspector from one implementation. Widgets are **assembled from source partials at server startup** — not committed as built files. Sources live in `public/widgets/src/` (`shared/` partials + one `templates/*.html` per widget); `src/widgets.ts` inlines the partials (resolving `/*@include shared/…@*/` markers) into one self-contained HTML string per widget, cached and warmed at boot (`warmWidgets()` in `src/index.ts`). The tool modules in `src/mcp/tools/` serve each via `getWidgetHtml(key)`. Every in-chat widget is **one compact card**: a header line, the widget's own top matter (a chart, a range toggle, a weight line), then the shared macro strip — a calorie ring beside its figure, three macro bars, a "limits" row (sugar / alcohol / caffeine / fiber), and the water line. The shell lives in `shared/base.css` (`.wrap.tight`, `.panel`, `.phead`, `.psec`) and the strip in `shared/macros.*`. The widgets: the `get_nutrition_summary` dashboard, the `get_goal_progress` view, the meal-progress strip (`meal-logged`, which renders nothing when no goals are set), the `get_trends` view (interactive 7/14/30-day toggle), the `get_weight_trends` view (data-scaled weight-over-time chart with the same toggle), `import-meals` (the bulk-import flow — see "Bulk meal import" below), and the two household cards: `grocery-list` (returned by `list_grocery_lines`) and `fridge` (returned by `get_fridge`). `component-gallery` is dev-only: it is listed in `WIDGET_TEMPLATES` so it is assembled and test-covered, but no `ui://` resource or tool references it, so no client can reach it — view it with `bun run harness`. They share one design language and one host bridge — see `public/widgets/STYLE_GUIDE.md`. `bun test src/widgets.test.ts` guards assembly (no unresolved markers, valid inline JS, every partial inlined in full).

A second marker, `/*@inlinets src/domain/csv.ts@*/`, transpiles a TypeScript module from `src/` into the widget as plain JS. It exists so a widget can run **tested** server-side code instead of a hand-copied twin; it only works for modules with no runtime imports, and it strips module syntax because a bare `export` inside a `<script>` is a syntax error.

UI copy is English only. A third assembly marker, `/*@i18n@*/` (`src/widgets.ts`), inlines `WIDGET_STRINGS` (`src/copy/widgets.ts`) as a `JSON.stringify`'d `const` — plain data only. It sits once per template, immediately before `/*@include shared/i18n.js@*/`, because `src/widgets.test.ts` requires every `@include`d partial's full text to appear verbatim in the assembled HTML, and the assembler's marker regexes match plain text. `shared/i18n.js` still calls `pickLocale` / `setLocale`; the server always sends `structuredContent.locale` as `"en"` (`WIDGET_LOCALE` in `src/routes.ts`). There is no `set_language` tool.

**Every widget except `component-gallery` (dev-only, unreachable by any client) is fully wired end-to-end.** `nutrition-summary`, `goal-progress`, `meal-logged`, `trends`, `weight-trends`, and `import-meals` each call `setLocale(pickLocale(structuredContent.locale, hostContext.locale))` from `render()` (or, for `import-meals`, from the `initWidget` config's outer `render(data)` callback) and have their own `WidgetStrings` namespace (`goalProgress`, `mealLogged`, `trends`, `weightTrends`, `importMeals`) alongside `macros`/`nutritionSummary`. Two deliberate non-translations, not gaps: `import-meals`'s `diagnosticsBlock()` copy-paste diagnostics dump stays operator-facing English (it carries no support address since #51; a household deploy has no support inbox), and `api.updateModelContext`'s finished-import summary stays English (model-facing text like every tool's `content`, not UI).

**`bun run harness`** is the local host simulator (`scripts/widget-harness.ts`). It mimics a strict host — validates the `ui/initialize` shape, withholds the tool result until `ui/notifications/initialized`, starts the iframe at 130px, applies the sandbox CSP — and additionally answers app-initiated `tools/call`, sends host→app requests, and executes the real `bulk_import_meals` against an in-memory store. Query flags reproduce host behaviour: `?serverTools=0`, `?tools=0`, `?delay=3000`, `?maxHeight=600`, `?fail=1`.

**Interactive widgets slice client-side.** `trends.html` has a 7/14/30-day toggle: rather than round-trip to re-call the tool, `get_trends` sends up to 30 days of daily series and the widget slices/re-averages/re-renders locally, so switching ranges is instant and needs no host tool-call support. Prefer this pattern (send a superset, filter in the widget) for range/filter toggles.

**One widget can back several tools.** `meal-logged.html` is linked by **both** `log_meal` and `update_meal`: both declare `outputSchema: MEAL_PROGRESS_OUTPUT_SCHEMA` and build their `structuredContent` through the shared `buildMealProgress()` helper, so the payload shape is identical; the `action` field (`"logged"` / `"updated"`) only changes the widget's header. To reuse a widget across tools, point each tool's `_meta.ui.resourceUri` at the same `ui://` URI and keep their structuredContent shapes identical.

**Server wiring (`src/mcp/tools/<domain>.ts`):**

- Register the widget HTML as a resource with a `ui://` URI and mimeType **`text/html;profile=mcp-app`** (see the `SUMMARY_WIDGET_URI` / `APP_UI_MIME_TYPE` constants). Serve it via `getWidgetHtml("<key>")` (from `src/widgets.ts`), which returns the assembled, fully-inlined document. To add a widget: create `public/widgets/src/templates/<key>.html` (reuse `@include shared/…` partials + call `initWidget({…})`), add the key to `WIDGET_TEMPLATES` in `src/widgets.ts`, and register the resource here.
- Link it on the tool config: `_meta: { ui: { resourceUri: "ui://..." } }`. The SDK supports `_meta` and `outputSchema` on `registerTool`.
- The tool must return `structuredContent` (declare an `outputSchema` and return it on **every** path — this then emits structuredContent for all clients, not just UI ones). The widget renders from `structuredContent`; `content` remains the model-facing text.

**The assembled widget is a single self-contained HTML** — inline CSS + JS, zero network requests. The iframe CSP **defaults** to deny-all (`default-src 'none'`): no CDN/external scripts, and `eval`/`new Function` are blocked. It is a default, not a hard limit — the apps spec defines `_meta.ui.csp` / `hostCapabilities.sandbox.csp` with `connectDomains`, `resourceDomains`, `frameDomains` and `baseUriDomains` — but nothing here needs relaxing it, and self-contained is still the right default. Worth knowing what the CSP does _not_ cover: `<input type="file">` and `FileReader` work fine under it, because reading a local file is not a network fetch (tested under `sandbox="allow-scripts"` plus `default-src 'none'`) — which is what makes the in-browser CSV parse in `import-meals` possible.

Because external scripts and stylesheets are out, reuse happens inline-at-build-time (the `@include` assembler) rather than through a linkable stylesheet or `<script src>`. To use a chart library, inline it the same way; we use hand-built SVG instead (0 KB, follows CSS light/dark vars natively via `currentColor` / `var(--…)`).

**Styling — reuse the shared design language.** All widgets share one look (neutral surfaces, accent tokens, one compact card per widget, a donut gauge, thin metric bars, SVG trend charts). Layout inside the strip is driven by each `MACROS` entry's `role` in `shared/macros.js` (`cal` / `macro` / `limit` / `bar`) — never by a hardcoded key list, so a new nutrient appears exactly where its role says and nowhere else. The tokens and component CSS live as source partials in `public/widgets/src/shared/` and are inlined via `@include`; **`public/widgets/STYLE_GUIDE.md`** is the spec for those partials. Edit a partial once and every widget picks it up on next assembly — do **not** re-inline or fork a shared block into a template. Keep the JS host handshake in `shared/bridge.js` (`initWidget(config)`); a template supplies `{ name, loading, coerce, render, sample }`, plus an optional `onReady(api)` when it needs to call the server. `api` exposes `callTool(name, args, opts)`, `canCallTools` (whether the host advertised `hostCapabilities.serverTools`), `hostContext`, `hostInfo`, and `updateModelContext(text)`. Form controls and the preview table live in `shared/form.css` and `shared/table.css`; `.card` is the shared surface in `shared/base.css`.

Two bridge invariants that are easy to break: a message is only treated as a response to our request when it has **no** `method` and carries `result`/`error` (the host sends its own requests, with its own id counter — the spec's `ui/resource-teardown` example uses `id: 1`, which is why our ids are namespaced `app-N`), and inbound messages are rejected unless `event.source === host` (`window.parent.frames` is reachable cross-origin, so a sibling iframe could otherwise forge a tool result and repaint a widget).

**The iframe→host handshake must be exact.** Strict hosts (MCP Inspector) validate the request shape and silently drop malformed ones — symptom: widget stuck on "Loading…" while the tool succeeds server-side. Sequence over plain `window.postMessage(msg, "*")` to `window.parent`:

1. App → host: `ui/initialize` request. Params use **`appInfo`** and **`appCapabilities`** — NOT the MCP-core `clientInfo` / `capabilities` (this exact mix-up was the original bug): `{ protocolVersion: "2026-01-26", appInfo: {name, version}, appCapabilities: {} }`.
2. host → app: JSON-RPC response (host context incl. theme at `result.hostContext.theme`).
3. App → host: `ui/notifications/initialized` notification (no params). Required — without it strict hosts never send the result.
4. host → app: `ui/notifications/tool-result` notification with `params.structuredContent` → render. Only show the built-in sample fallback when there is no host (`window.parent === window`), never inside one.

**The widget MUST report its height, or the host clips it.** The host gives the iframe a small default height and only grows it when the app sends `ui/notifications/size-changed` with `{ width, height }`. Without it the widget renders fine but is cut off after the first row (this was a shipped bug). Measure the natural height by temporarily setting `document.documentElement.style.height = "max-content"`, reading `getBoundingClientRect().height`, then restoring; width is `window.innerWidth`. Wire a `ResizeObserver` (debounced with `requestAnimationFrame`) on `documentElement` + `body` so it re-reports after the tool-result render and after any interactive re-render (e.g. a toggle). Do **not** rely on `body { min-height: 100vh }` for sizing — it fights content-based measurement; let the body size to its content. **Test with a host-harness that starts the iframe SHORT (~130px) and grows it on `size-changed`** — a fixed-tall test iframe hides this bug entirely.

**Ground truth when in doubt:** the reference SDK `@modelcontextprotocol/ext-apps` — `src/app.ts` `connect()` shows the exact initialize request; `dist/src/generated/schema.json` lists all `ui/*` method names. Spec: <https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/>, repo: <https://github.com/modelcontextprotocol/ext-apps>. Alternative to hand-rolling: bundle that package's `App` class inline (~100 KB, but tracks the spec). Verify without a real client using a local host-harness HTML that embeds the widget in a `sandbox="allow-scripts"` iframe, mimics the strict host, and pushes distinct data via `postMessage`.

---

## Bulk meal import

Two entry points, one write path.

- **`start_meal_import`** returns the `import-meals` widget. Prefer it whenever the user has an actual file: the widget parses and maps the export **in the browser**, so rows never pass through the model and cannot be mistranscribed. Its `outputSchema` is load-bearing — with no `structuredContent` the bridge never paints and the iframe sits on its loading state — and it carries `tz` so the widget's preview matches what the server will store.
- **`bulk_import_meals`** is the universal fallback, callable by the model _and_ by the widget (default `_meta.ui.visibility` is `["model", "app"]`, so one tool serves both; `["app"]` would hide it from the model and break users who have widgets disabled).

`src/domain/import.ts` holds the logic, free of Supabase so it unit-tests with fixtures; `src/mcp/tools/nutrition.ts` is a thin adapter supplying `insert` and `existingKeys`. `src/domain/csv.ts` is the parser, inlined into the widget via `@inlinets`.

Non-obvious invariants, each of which was a real bug or nearly one:

- **Rows carry an explicit `import:<digest>:<ordinal>` idempotency key.** `insertMeal` derives a content hash when none is given, and that hash includes `logged_at` — but date-only rows all anchor at local noon, so two genuinely separate identical rows hashed alike and the second was silently swallowed as `deduplicated` while the control total still reconciled. The ordinal counts preceding identical rows in the same call, so replaying a file is still a perfect no-op. It is the ordinal and **not** `source_line`, so re-exporting a file with lines added still dedupes. Never split a calendar date across calls — the ordinal is per call.
- **Our own export re-imports by `id`, not by content.** The content digest structurally cannot recognize a meal coming back in: `log_meal` writes `auto:<digest>` keys and the importer writes `import:…` ones, and the two hash different renderings of `logged_at` (the export emits second-precision local wall time, which the importer then re-resolves). So every row carries an optional `source_id` — the `id` column of the `meals.csv` our own export writes — and a row naming a meal the user still has is reported `deduplicated` without an insert, on the dry-run path and the real one alike. Rows whose meal was since deleted key on `import:src:<uuid>:<ordinal>` so a second replay is still a no-op. Only uuid-shaped values count: a foreign app's `id` column is dropped rather than rejected, and passing a non-uuid to the uuid-typed `in ("id", …)` lookup would fail the whole batch on a cast error rather than simply not matching. The export's `timezone` column closes the other half of that gap: a row whose meal was since deleted — the actual "restore my data" case — still gets written fresh rather than deduplicated by id, so it also carries an optional `timezone` field (mapped by the widget from the export's own `timezone` column), which `resolveLoggedAt` uses in place of the account's current timezone when present and valid — otherwise an offset-less wall clock silently re-resolves against whatever timezone the account has now, moving the meal to a different local day (#97).

- **The tool never sets `isError`.** Failure is `status: "failed"` inside the `outputSchema`. `isError` short-circuits the SDK's output validation and hosts commonly surface only `content`, which would drop the per-row report that is the whole product. Consequence: `withAnalytics` needs its `outcome` callback, or failed imports log as successes.
- **`.nullable()` is not optional.** Nullable fields are emitted as _required_ with an `anyOf[type, null]` value, so every result row must be built from a complete literal with explicit `null`s. `src/domain/import.test.ts` validates the serializer against the schema — the only guard, since `bun run typecheck` covers `src/` but not the shape a handler actually returns at runtime.
- **Bounds live in the handler, not in Zod.** A schema-level rejection happens before the handler runs, discarding the structured report, the warnings and the analytics row — for what will be the caller's most common mistake. Numbers use `z.coerce` like `log_meal`.
- **Timestamps accept a bare date (→ local noon), an offset-less local time (resolved in the profile timezone), or full ISO with an offset.** Offset-less is accepted deliberately: no fitness export carries an offset, so requiring one forces the caller to compute historical DST per row. Every resolved date asserts the `dateInTz` round trip, which turns never-existed local dates (`Pacific/Apia 2011-12-30`) into explicit errors. An unconfigured timezone silently means UTC, so the tool warns — a missing `profiles` row is the only reliable "never set" signal.

- **Every write path resolves `logged_at` through the same `parseLoggedAt` in `src/domain/tz.ts`** — the importer via `resolveLoggedAt` (`src/domain/import.ts`), the five manual tools (`log_meal`, `update_meal`, `log_water`, `log_weight`, `update_weight`) via `resolveWriteLoggedAt` and the `resolveWriteTimestamp` adapter in `src/mcp/shared.ts`. Handing an offset-less string to the `timestamptz` column instead reads it in the DB session zone (UTC), which filed a Kyiv user's 21:00 meal at 00:00 the next day while the tool's own progress line reported the later date (issue #68). The two callers differ **only** in bounds: the importer is backfilling and takes 20 years back to 48 hours ahead; a manual entry has no past bound and a 5-minute future one, except a bare date, whose local-noon anchor is a placeholder for an unknown time and so is judged by calendar day. This is not about cross-route dedupe — the importer stamps `import:` keys and never reaches the `auto:` digest — it is about both routes filing the same string on the same local day, since every read path buckets by `dateInTz`.

---

## Data export

**One tool, `export_all_data`, is the only way out.** It writes a ZIP — `meals.csv`, `meal_items.csv`, `water.csv`, `weight.csv`, `goals.csv`, `profile.csv` and a `README.txt` — to `exports/<userId>/foodable-export.zip` and returns a 60-minute signed link. A meals-only `export_meals` used to sit beside it and was removed rather than kept: two overlapping export tools made "export my data" ambiguous for the model, and the meal history is `meals.csv` inside the archive. The fixed per-user path means each export overwrites the last, and `sweepStaleExports` ages files out on the same horizon as the link, so nothing outlives its URL by more than one sweep.

`src/zip.ts` is a hand-rolled store-only (method 0) ZIP writer — Bun has gzip and zstd but no archive builder, and seven small CSVs do not justify a dependency. Two things in it are load-bearing: every size and offset is a **byte** length from `TextEncoder` (a multi-byte character in a meal description otherwise desyncs every following offset), and the DOS date/time is read in **UTC**, or the same `Date` emits different bytes on different machines and the determinism the tests rest on evaporates.

Invariants worth keeping:

- **Every CSV pairs each timestamp with a `timezone` column** naming the zone it is rendered in, exactly as the meal export always has. An offset-less wall clock with nothing beside it silently re-resolves against whatever timezone the account has later — that was #97.
- **Every builder emits its header even with zero rows**, and `goals.csv` / `profile.csv` are header-only when the record is null. A file that vanishes when a table is empty makes the archive shape unpredictable for anything reading it.
- **`meals.csv` is byte-identical to `buildMealsCsv`**, whose headers are the importer's column aliases. It is the only file with a way back in; renaming a column there for looks breaks a re-import silently.
- **Alcohol is not gated on `alcohol_tracking_enabled`.** The opt-in governs display, not the export — the archive is meant to be a complete copy of what was logged, and withholding rows the user later hid would break that. It looks like a missing check, so the code says why.
- **`exportAllData` derives tz and weight unit from one `getProfile` row.** The `getUserTimezone` / `getPreferredWeightUnit` wrappers are each their own `select * from profiles`, so chaining them multiplies one query by the number of preferences read.
- **`getAllMeals` / `getAllWater` / `getAllWeight` reconcile against an exact count and throw when short.** PostgREST caps rows at 1000 by default, which truncated an export once already (#66); a loud failure beats a quiet partial backup.

---

## Login HTML and the household app

Generated public HTML is the OAuth login template: `public/login.html`, written by `scripts/gen-login.ts` from `src/copy/login.ts`. English only. `GET /` without a site session is that login page. `GET /authorize` with a valid OAuth query is the same template. Signed-in `/` is the household web app (nutrition, fridge, grocery, recipes, settings). Do not add marketing routes, and do not restore `gen-index.ts`, `gen-tools.ts`, `gen-legal.ts`, `gen-alternatives.ts`, or `gen-sitemap.ts`.

`package.json` `gen:pages` still runs only `gen-login.ts`. `gen:all` runs `gen:tokens` then `gen:pages`. `src/public-site.test.ts` fails if the marketing generators come back or if marketing paths return HTML.

### Chrome and assets

Login is a single card styled by `/app.css`, the household app's stylesheet. It follows the OS theme and has no header or theme toggle. It uses the app's self-hosted fonts and brand layer (see "Household app styling"). Consent `{terms}` / `{privacy}` render as plain text, not anchors.

Static assets served: `/app.css` (assembled, see "Household app styling"), `/favicon.ico`, `/apple-touch-icon.png`, `/brand/*.svg`, `/fonts/:file` (allowlisted in `APP_FONTS`), `/robots.txt`. `public/styles.css`, `public/site.js` and the old marketing font path stay gone; `src/public-site.test.ts` fails if they come back.

`src/copy/tools.ts` `TOOLS` is the MCP catalog for `mcp.test.ts`, not a page.

Re-run `bun run gen:all` after editing login copy, `site-partials.ts` or `gen-login.ts`. The generated file is still a template: `{{SESSION_ID}}` and `{{ERROR}}` are filled per request.

The first-user / closed-household flow is documented in `docs/self-hosting.md` ("First-user flow"). Deploy-day steps are in `docs/deploy-checklist.md`.

---

## Household app styling

One shared base, one app brand layer. Colours, type sizes (`--fs-*`) and radii (`--r-*`) live in `src/tokens.ts`; `bun run gen:tokens` writes `public/widgets/src/shared/tokens.css` (the NEUTRAL base) and `public/app/brand.css` (the APP palette and the self-hosted Geist / Bricolage Grotesque fonts). `src/tokens.test.ts` fails if either committed file drifts. The widget partials in `public/widgets/src/shared/` (`tokens.css`, `base.css`, `form.css`, `table.css`, `seg.css`) are the base for the in-chat widgets, the household app and the login page. `public/app/app.css` `@include`s them, then the app-only brand layer: `public/app/brand.css`, pill controls, the page glow, the frosted nav and the login hero. Chat widgets never include the brand layer: they render inside someone else's product, so they keep the neutral look, and `src/app-brand.test.ts` fails if a brand marker reaches one. The widgets the app embeds get the brand layer through `public/app/embed.css`, which `withWidgetData` injects as the frame's last `<style>` when given a `skin` (`getEmbedCss()`). `getAppCss()` and `getEmbedCss()` in `src/widgets.ts` assemble with the widget resolver (app-only partials are `../../app/…`), cache, and warm at boot. Editing a shared partial changes the widgets and the app together; check both (`bun run harness`, `bun run preview:app --shots`). Brand changes go in `brand.css` or `app.css`, never in a shared partial.

- **Plain markup inside `.native`.** App pages render inside `<main class="app-main native">`. `form.css` styles native `input` / `select` / `textarea` / `button` there through `:where(.native …)`, which has zero specificity, so a component class on the same element always wins. Never add a bare `.native button` rule: it outranks `.btn-primary`. App-layer rules in `app.css` follow the same convention.
- **The vocabulary.** Sections are `.panel` (sub-blocks `.psec`). Lists are `ul.list` of rows: `.row` holding `.row-title` and a right-aligned `.row-meta`, then `.row-actions` (each action is its own POST form, `display: contents`). Secondary forms (edit, add, filter) go behind `<details class="more"><summary>…</summary>`. Buttons: plain = neutral, `.btn-primary` = the one main action, `.btn-danger` = destructive, `.btn-sm` = in-row. Two-column fields: `.field-grid` with `<label>Text<input></label>`. Label + control + button on one line: `.inline-form`. Picker tabs are `.seg` / `.seg-btn` with `aria-selected`.
- **One accent, three themes.** The accent is `--accent` from `tokens.css` and nothing overrides it: no swatch picker and no inline accent. `profiles.theme` is `light`, `dark` or null (System). Explicit themes stamp `data-theme` on `<html>` (`htmlOpen` in `src/web/shell.ts`); System leaves it off so the media query decides. Embedded widgets get the same treatment (`withWidgetData`). The brand layer changes surfaces and type only; it never redefines `--accent` or a nutrient colour. `profiles.accent_swatch` is unused, pending a contract migration.
- **`[hidden]` is `display: none !important`** in `app.css`. Component `display` rules used to override the attribute.
- **Embedded widgets.** `.widget-frame` is pulled out by the widget's own 12–14px gutter so cards line up with page panels, and `bridge.js` skips its chat-only footer when `window.__WIDGET_DATA__` seeded the paint.
- **Test-pinned class names.** Some classes are asserted exactly by tests (see `src/web/components/shared-import.test.ts`, `src/domain/*.test.ts`). Style those by name in `app.css` rather than appending classes in markup.

---

# Claude Code Operating Instructions

## Core Philosophy

Default to **parallel execution** and **web-verified information**. Sequential execution and offline assumptions are fallback modes, not defaults. When in doubt: parallelize, then search.

---

## 1. Parallelization Protocol

### Default Behavior: Parallel-First

**Before starting any multi-step task:**

1. Decompose the full task into atomic subtasks
2. Build a dependency graph — identify which subtasks have no prerequisite outputs
3. Dispatch ALL dependency-free subtasks simultaneously using parallel tool calls
4. Only after their completion, dispatch the next wave of now-unblocked subtasks
5. Repeat until task is complete

**Rule:** If two tasks do not share an input/output dependency, they MUST run in parallel. Sequential execution of independent tasks is a performance violation.

### Parallel Tool Call Patterns

Prefer batching tool calls in a single response turn rather than sequential turns:

```
# CORRECT — dispatch independent reads simultaneously
- Read file A
- Read file B
- Search web for library version
(all in one turn)

# WRONG — needless sequencing
- Read file A → wait → Read file B → wait → Search web
```

### Sub-Agent Parallelization (Task Tool)

When using the `Task` tool to spawn sub-agents:

- Spawn all independent sub-agents in a single dispatch batch
- Maximum **5 concurrent sub-agents** at any time to avoid context exhaustion
- Each sub-agent must have a clearly scoped, non-overlapping responsibility
- Define explicit output contracts for each agent before spawning
- After all agents complete, explicitly synthesize their outputs — do not present raw agent outputs as the final answer

### TodoWrite Protocol

When managing complex tasks with `TodoWrite`:

- Mark tasks as `in_progress` before starting a parallel batch
- Track each parallel thread separately
- Never mark a parent task `completed` until all parallel children resolve
- Flag dependency chains explicitly in todo descriptions

### When Sequential Execution Is Permitted

Sequential execution is only justified when:

- Task B requires Task A's output as direct input
- Tasks write to the same file or resource (race condition risk)
- A previous parallel batch returned an error that changes downstream logic
- User explicitly requests step-by-step confirmation

In all other cases: **parallelize**.

---

## 2. Web Search Mandate

### Search-First Triggers

**Always perform a web search before proceeding** when the task involves any of the following:

| Category                     | Examples                                                  |
| ---------------------------- | --------------------------------------------------------- |
| Library / framework versions | "What's the latest stable version of X?"                  |
| API behavior and signatures  | Any external SDK, REST API, or CLI tool                   |
| Security advisories          | CVEs, deprecated patterns, breaking changes               |
| Best practices               | Architecture patterns, language idioms updated post-2024  |
| Configuration options        | Tool flags, environment variables, cloud service settings |
| Error messages               | Unfamiliar stack traces, runtime errors                   |
| Compatibility questions      | Node/Python/Rust version support, browser APIs            |
| Pricing or limits            | Cloud service quotas, rate limits, SLA details            |

### Search Behavior Rules

1. **Search before assuming.** Do not rely on training knowledge for anything that changes over time. External information has a shelf life; always verify.

2. **Prefer official sources.** When web results conflict, prioritize: official docs > GitHub releases > well-known technical blogs > forums.

3. **Deduplicate within session.** If you have already searched for a query in this session and the result was unambiguous, do not re-search the same query. Cache the result mentally and reference it.

4. **Surface what you found.** When you use web search to inform a decision, briefly state the source and key fact. Do not silently use search results without attribution.

5. **Parallelize searches.** When multiple independent facts need to be looked up, dispatch all web searches simultaneously, not sequentially.

6. **Do not search for:** Internal project details, proprietary architecture, code that exists in the repository (read the file instead), or subjective style decisions.

### When Web Search Results Conflict with the Codebase

If web search returns guidance that contradicts patterns already established in the repo:

1. Note the conflict explicitly
2. Present both the current repo pattern and the web-sourced alternative
3. Do not silently override existing code with web-sourced patterns without user confirmation

---

## 3. Session Start Checklist

At the beginning of every new task or session, run the following in parallel:

- [ ] Read `CLAUDE.md` (this file) to confirm operating rules are loaded
- [ ] Identify the task's scope and decompose into subtasks
- [ ] Flag any subtasks that require web verification
- [ ] Check for existing relevant files in the repo before searching externally
- [ ] Dispatch first parallel batch

---

## 4. Quality and Safety Rules

- **No unverified version pinning.** Never write a dependency version (`package.json`, `pyproject.toml`, `Cargo.toml`, etc.) without confirming via web search that it is current and non-deprecated.
- **No silent failures in parallel batches.** If one parallel subtask fails, halt dependent tasks immediately and report the failure before proceeding.
- **Conflict resolution in parallel file edits.** If two parallel sub-agents are asked to modify the same file, serialize those specific edits. All other work continues in parallel.
- **Do not hallucinate tool flags or API parameters.** If unsure whether a CLI flag exists, search first.

---

## 5. Communication Standards

- When executing a parallel batch, briefly state what is running in parallel and why
- When web search informs a decision, cite source and date if available
- When sequential execution is chosen over parallel, briefly state the dependency that forced it
- Keep explanations concise — action over narration
