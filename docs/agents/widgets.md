# Chat widgets (MCP Apps)

Read this before touching `public/widgets/`, `src/widgets.ts`, `scripts/widget-harness.ts` or a tool's `_meta.ui` / `outputSchema`. `public/widgets/STYLE_GUIDE.md` is the spec for the shared partials.

In-chat UI uses **MCP Apps** (the official 2026-01-26 MCP extension), which renders across Claude, ChatGPT, VS Code, Goose and MCP Inspector from one implementation.

## Assembly

Widgets are **assembled from source partials at server startup**, not committed as built files. Sources live in `public/widgets/src/`: `shared/` and `shared/v2/` partials plus one `templates/v2/*.html` per widget. `src/widgets.ts` inlines the partials (resolving `/*@include shared/…@*/` markers) into one self-contained HTML string per widget, cached and warmed at boot (`warmWidgets()` in `src/index.ts`). The tool modules in `src/mcp/tools/` serve each via `getWidgetHtml(key)`. `bun test src/widgets.test.ts` guards assembly: no unresolved markers, valid inline JS, every partial inlined in full.

A second marker, `/*@inlinets src/domain/csv.ts@*/`, transpiles a TypeScript module from `src/` into the widget as plain JS. It lets a widget run **tested** server-side code instead of a hand-copied twin. It only works for modules with no runtime imports, and it strips module syntax because a bare `export` in a `<script>` is a syntax error.

## The card and the widget list

Every in-chat widget is **one compact card**: a header line, the widget's own top matter (a chart, a range toggle, a weight line), then the shared macro strip — a calorie ring beside its figure, three macro bars, a "limits" row (sugar / alcohol / caffeine / fiber), and the water line. The shell lives in `shared/v2/base.css` and `components.css` (`.card`, `.hd`, `.rule`), and the strip in `shared/v2/macros.js`, which reuses `shared/macros.js` for the data logic.

The widgets:

- the `get_nutrition_summary` dashboard and the `get_goal_progress` view;
- the meal-progress strip (`meal-logged`), which its three tools only link when the caller has goals, since it is a progress strip with nothing to show without them;
- the `get_trends` view, and the `get_weight_trends` view (data-scaled weight-over-time chart with the 7/14/30-day toggle);
- `import-meals`, the bulk-import flow (see `docs/agents/meal-import.md`);
- the household cards `grocery-list` (`list_grocery_lines`, ticking off) and `fridge` (`get_fridge`);
- `attention` (`list_notices`), `use-soon` (`list_expiring`), `recipe-card` (`get_recipe`), `product-score` (`rate_product`), `restock-nudge` (`list_usuals`) and `week-plan` (`get_week_plan`).

Every widget is a v2 template in `templates/v2/` served at `ui://widget/v2/<file>`; the v1 templates and their `ui://widget/<file>` URIs are retired. `component-gallery` is dev-only: assembled and test-covered via `WIDGET_TEMPLATES`, but no `ui://` resource or tool references it, so no client reaches it. View it with `bun run harness`.

## Copy

UI copy is English only. Each template carries a small `const T = { … }` with only the strings that widget uses; shared partials embed their own copy (`MACRO_COPY` in `shared/macros.js`, `CHART_COPY` in `shared/trend-chart.js`, `MONTHS` in `shared/date.js`). `shared/util.js` supplies `tpl()` and `plural()` for count-sensitive phrases.

Two texts are deliberately not UI copy: `import-meals`'s `diagnosticsBlock()` dump (operator-facing) and `api.updateModelContext`'s finished-import summary (model-facing).

## The harness

**`bun run harness`** is the local host simulator (`scripts/widget-harness.ts`). It mimics a strict host: it validates the `ui/initialize` shape, withholds the tool result until `ui/notifications/initialized`, starts the iframe at 130px, and applies the sandbox CSP. It also answers app-initiated `tools/call`, sends host→app requests, and executes the real `bulk_import_meals` against an in-memory store. Query flags reproduce hosts: `?serverTools=0`, `?tools=0`, `?delay=3000`, `?maxHeight=600`, `?fail=1`.

## Patterns

**Interactive widgets slice client-side.** `trends.html` has a 7/14/30-day toggle: `get_trends` sends up to 30 days of daily series and the widget slices, re-averages and re-renders locally, so switching ranges is instant and needs no host tool-call support. Prefer this pattern (send a superset, filter in the widget) for range/filter toggles.

**One widget can back several tools.** `meal-logged.html` is linked by **both** `log_meal` and `update_meal`: both declare `outputSchema: MEAL_PROGRESS_OUTPUT_SCHEMA` and build their `structuredContent` through the shared `buildMealProgress()` helper; the `action` field (`"logged"` / `"updated"`) only changes the widget's header. To reuse a widget, point each tool's `_meta.ui.resourceUri` at the same `ui://` URI and keep their structuredContent shapes identical.

## Server wiring (`src/mcp/tools/<domain>.ts`)

- Register the widget HTML as a resource with a `ui://` URI and mimeType **`text/html;profile=mcp-app`** (see the `SUMMARY_WIDGET_URI` / `APP_UI_MIME_TYPE` constants). Serve it via `getWidgetHtml("<key>")` (from `src/widgets.ts`), which returns the assembled, fully-inlined document. To add a widget: create `public/widgets/src/templates/<key>.html` (reuse `@include shared/…` partials and call `initWidget({…})`), add the key to `WIDGET_TEMPLATES` in `src/widgets.ts`, and register the resource here.
- Link it on the tool config: `_meta: { ui: { resourceUri: "ui://..." } }`. The SDK supports `_meta` and `outputSchema` on `registerTool`.
- The tool must return `structuredContent`: declare an `outputSchema` and return it on **every** path. This then emits structuredContent for all clients, not just UI ones. The widget renders from `structuredContent`; `content` remains the model-facing text.

## Self-contained, under a deny-all CSP

**The assembled widget is one self-contained HTML**: inline CSS and JS, no network requests. The iframe CSP **defaults** to deny-all (`default-src 'none'`): no CDN or external scripts, and `eval` / `new Function` are blocked. It is a default, not a hard limit — the apps spec defines `_meta.ui.csp` / `hostCapabilities.sandbox.csp` with `connectDomains`, `resourceDomains`, `frameDomains` and `baseUriDomains` — but nothing here needs relaxing it, and self-contained is still the right default.

Not covered by the CSP: `<input type="file">` and `FileReader` work fine under it, because reading a local file is not a network fetch (tested under `sandbox="allow-scripts"` plus `default-src 'none'`). That is what makes the in-browser CSV parse in `import-meals` possible.

With external scripts and stylesheets out, reuse happens inline at build time (the `@include` assembler), not through a linkable stylesheet or `<script src>`. A chart library would be inlined the same way; we use hand-built SVG instead (0 KB, follows the CSS light/dark vars via `currentColor` / `var(--…)`).

## Styling

Reuse the shared design language. Widget partials live under `public/widgets/src/shared/v2/`, starting with the generated Theme tokens (`shared/v2/tokens.css` from `src/tokens.ts`, system font, host `data-theme`). No widget loads web fonts.

Layout inside the strip is driven by each `MACROS` entry's `role` in `shared/macros.js` (`cal` / `macro` / `limit` / `bar`), never by a hardcoded key list, so a new nutrient appears exactly where its role says and nowhere else.

The tokens and component CSS live as source partials in `public/widgets/src/shared/` and are inlined via `@include`; **`public/widgets/STYLE_GUIDE.md`** is the spec for those partials. Edit a partial once and every widget picks it up on next assembly. Never re-inline or fork a shared block into a template.

## The host bridge

Keep the JS host handshake in `shared/bridge.js` (`initWidget(config)`). A template supplies `{ name, loading, coerce, render, sample }`, plus an optional `onReady(api)` when it needs to call the server. `api` exposes `callTool(name, args, opts)`, `canCallTools` (whether the host advertised `hostCapabilities.serverTools`), `hostContext`, `hostInfo` and `updateModelContext(text)`.

Two bridge invariants that are easy to break:

- A message is only treated as a response to our request when it has **no** `method` and carries `result` / `error`. The host sends its own requests with its own id counter (the spec's `ui/resource-teardown` example uses `id: 1`), which is why our ids are namespaced `app-N`.
- Inbound messages are rejected unless `event.source === host`. `window.parent.frames` is reachable cross-origin, so a sibling iframe could otherwise forge a tool result and repaint a widget.

### The handshake must be exact

Strict hosts (MCP Inspector) validate the request shape and silently drop malformed ones. Symptom: the widget is stuck on "Loading…" while the tool succeeds. The sequence, over plain `window.postMessage(msg, "*")` to `window.parent`:

1. App → host: `ui/initialize` request. Params use **`appInfo`** and **`appCapabilities`**, NOT the MCP-core `clientInfo` / `capabilities`: `{ protocolVersion: "2026-01-26", appInfo: {name, version}, appCapabilities: {} }`.
2. Host → app: JSON-RPC response (host context, including the theme at `result.hostContext.theme`).
3. App → host: `ui/notifications/initialized` notification (no params). Required: without it strict hosts never send the result.
4. Host → app: `ui/notifications/tool-result` notification with `params.structuredContent` → render. Only show the built-in sample fallback when there is no host (`window.parent === window`), never inside one.

### The widget MUST report its height, or the host clips it

The host gives the iframe a small default height and only grows it when the app sends `ui/notifications/size-changed` with `{ width, height }`. Without it the widget renders but is cut off after the first row.

- Measure the natural height by temporarily setting `document.documentElement.style.height = "max-content"`, reading `getBoundingClientRect().height`, then restoring. Width is `window.innerWidth`.
- Wire a `ResizeObserver` (debounced with `requestAnimationFrame`) on `documentElement` and `body`, so it re-reports after the tool-result render and any interactive re-render (a toggle, say).
- Do **not** use `body { min-height: 100vh }` for sizing. It fights content-based measurement; let the body size to its content.
- **Test with a host harness that starts the iframe SHORT (~130px) and grows it on `size-changed`.** A fixed-tall test iframe hides this bug entirely.

## Ground truth

When in doubt, read the reference SDK `@modelcontextprotocol/ext-apps`: `src/app.ts` `connect()` shows the exact initialize request, and `dist/src/generated/schema.json` lists every `ui/*` method name. Spec: <https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/>; repo: <https://github.com/modelcontextprotocol/ext-apps>. The alternative to hand-rolling is bundling that package's `App` class inline (~100 KB, tracks the spec). To verify without a real client, use a local host-harness HTML that embeds the widget in a `sandbox="allow-scripts"` iframe, mimics the strict host and pushes distinct data via `postMessage`.
