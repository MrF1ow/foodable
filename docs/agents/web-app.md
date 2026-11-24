# Login page, routes and Turbo

Read this before touching `src/web/route-map.ts`, the login template or its generators, static asset routes, `src/web/client/shell.js`, or any form's response codes or `data-turbo` opt-outs. Styling is in `docs/agents/app-styling.md`.

## Routes

Canonical app paths live in `src/web/route-map.ts` (`APP_PATHS`). Old paths (`/fridge`, `/grocery`, `/household`, `/household/usual-products`, `/settings/foods`) redirect via app middleware: GET/HEAD → 301, other methods → 308, query string preserved.

Generated public HTML is the OAuth login template: `public/login.html`, written by `scripts/gen-login.ts` from `src/copy/login.ts`. `GET /` without a site session is that login page, and `GET /authorize` with a valid OAuth query is the same template. Signed-in `/` is Today in the household web app (Today, Kitchen, Recipes, Trends, Settings).

Do not add marketing routes, and do not restore `gen-index.ts`, `gen-tools.ts`, `gen-legal.ts`, `gen-alternatives.ts` or `gen-sitemap.ts`. `package.json` `gen:pages` still runs only `gen-login.ts`; `gen:all` runs `gen:tokens` then `gen:pages`. `src/public-site.test.ts` fails if the marketing generators come back or if marketing paths return HTML.

## Login chrome and assets

Login is a single card styled by `/app.css`, the household app's base stylesheet. It follows the OS theme and has no header or theme toggle. It uses the app's self-hosted fonts and brand layer. Consent `{terms}` / `{privacy}` render as plain text, not anchors.

Static assets served: `/app.css` and `/app-v2.css` (assembled, see `docs/agents/app-styling.md`), `/app.js` and `/app-v2.js` (the client bundles from `src/web/client/` and `client/v2/`), `/favicon.ico`, `/apple-touch-icon.png`, `/brand/*.svg`, `/fonts/:file` (allowlisted in `APP_FONTS`), `/robots.txt`. `public/styles.css`, `public/site.js` and the old marketing font path stay gone; `src/public-site.test.ts` fails if they come back.

Re-run `bun run gen:all` after editing login copy, `site-partials.ts` or `gen-login.ts`. The generated file is still a template: `{{SESSION_ID}}` and `{{ERROR}}` are filled per request.

The first-user / closed-household flow is documented in `docs/self-hosting.md` ("First-user flow"). Deploy-day steps are in `docs/deploy-checklist.md`.

## Turbo (in-app navigation)

Hotwire Turbo 8 is bundled into `/app.js` (not a CDN). The shell advertises morph page refreshes and scroll preservation. `/app.css`, `/app.js`, `/app-v2.css` and `/app-v2.js` are content-hashed (`?v=…`) and use `data-turbo-track="reload"`. Client modules register through `FoodableApp.onLoad` in `shell.js`, which re-runs on `turbo:load` and `turbo:morph` with per-module `WeakSet` idempotency.

Response codes:

- Form POST success redirects use **303**.
- Validation errors render **4xx** HTML in place (modals reopen via `data-modal-open-on-load`).
- Expired-session login on POST is **401** (GET stays **200**), so Turbo renders the login page instead of dropping the response.

Flows that opt out of Turbo (each answers with something Turbo cannot render as a page, or must be a real load):

- the login `/approve` form;
- the rotate-household-token confirm form (owner only, on Settings › Household; one-time secret on a 200 page);
- the invite-create form (Settings › Household › Invites; the one-time code on a 200 page);
- the Share sheet form (`share-sheet.ts`, the one-time link on a 200 page);
- Export data on Settings home (the 303 goes to a download link, not a page);
- the logout link, on the Account page and the gate app bar;
- the Settings forms still waiting for their page to switch: AI connections (it drops its opt-out with its page).

Everything else in Settings is Turbo: the sidebar item, the account row and chip, every Settings back link, the account forms (name, time zone, photo) and the Display control on Settings home. iOS Safari's toolbar tint is synced in place on the visit (see Theme sync below), so a theme change no longer needs a full load; the tint on a real iPhone is what the user's audit checks.

Goals, Product score and Settings › Notifications autosave (`client/v2/autosave.js`), and so do the Display control and the time zone list, so they keep Turbo.

Entrance fade: `html.fx` (animations on) and `html.fx-enter` (the fade of `.app-main`) are set by the inline script in `<head>` (`ENTRANCE_FX_SCRIPT` in `src/web/shell.ts`) before the first paint, unless the person asked for reduced motion, so a full load paints once and fades in from blank. `client/shell.js` removes `fx-enter` after a second and before any Turbo visit or refresh renders: a page Turbo swaps in is never faded. `scripts/flicker-check.ts` is the check (see the foodable-test skill).

The login template adds `<meta name="turbo-visit-control" content="reload">`, and `shell.js` forces a full reload if login HTML would morph into app chrome.

Theme sync: Turbo merges provisional `<head>` nodes (including `meta[name=foodable-theme]`) on visits and morph refreshes, but never copies `data-theme` onto `<html>`. So `shell.js` syncs `document.documentElement` and the server-rendered `meta[name=theme-color]` tags in place (content/media only, never remove/recreate) from that meta on `turbo:before-render` (after the head merge, before body paint), and only when the preference differs. The shell, login and bare pages all emit page chrome (`THEME_COLOR`, the page background); the nav surface colour (`THEME_NAV_COLOR`) is no longer a chrome colour.
