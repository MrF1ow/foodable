# Layout move: Settings behind a gear, Household as a tab

Status: proposed 2026-11-05. PR 1 of [usual products](./usual-products-plan.md#layout-change-ships-first-its-own-pr). A pure move under the "moves before changes" rule: pages change address and place, nothing changes behaviour. It ships on its own, before the usual-products PRs. Only the usual-products web UI (that plan's PR 5) depends on it.

## Before and after

|                                                | Today                                                                 | After                                                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Top bar, right                                 | Log out icon (`/logout`) on every page                                | Settings gear (`/settings`) on tabbed pages                                                                       |
| Bottom tab 5                                   | **Settings** (gear icon), `/settings`                                 | **Household** (house icon), `/household`                                                                          |
| `/settings`                                    | tabbed page: Account, with sub-nav Account · Household · Foods · Help | bare page (no bottom nav) with a back button: Account, with sub-nav Account · Help, and **Log out** at the bottom |
| `/settings/help`                               | tabbed page                                                           | bare page, same as `/settings`                                                                                    |
| Household card, members, grocery stores, rules | `/settings/household`                                                 | `/household` (**Members**)                                                                                        |
| Foods and supplies catalog                     | `/settings/foods`, titled "Foods"                                     | `/household/items` (**Items**)                                                                                    |
| Household sub-nav                              | none                                                                  | Members · Items (Usual products is added in usual-products PR 5)                                                  |

Grocery stores stay on the Members page for now. Whether they move to the Groceries tab is still open.

## Routes

- **New file `src/web/routes/household.ts`** (`householdRoutes`). Every household and foods route moves out of `src/web/routes/settings.ts` unchanged, except for the path:
    - `/settings/household` → `/household`;
    - `/settings/household/…` → `/household/…`, for example `/household/name`, `/household/members/:userId/role`, `/household/stores/:id/rules`, `/household/rotate-token`;
    - `/settings/foods` → `/household/items`;
    - `/settings/foods/merge` → `/household/items/merge`, and `/settings/foods/:id` → `/household/items/:id`.

    The middleware on each route (`requireSiteUser`, `requireMember`, `requireManager`) stays as it is. It is mounted in `src/index.ts` beside the other tab sub-apps.

- **`src/web/routes/settings.ts`** keeps `/settings` (GET, POST), `/settings/help` and `/create-household`.
- **Every form action, redirect and link** to the old paths is updated:
    - `redirectWithToast` targets;
    - the form actions in `src/web/pages/household.ts` and `src/web/pages/foods.ts`;
    - `data-fill-action` on the foods page;
    - the "Household settings" link in `src/web/pages/grocery.ts`.
- **Old addresses keep working.** One small middleware rewrites the prefixes:
    - `/settings/household` and everything under it → `/household…`;
    - `/settings/foods` and everything under it → `/household/items…`.

    It preserves the rest of the path and the query string. GET and HEAD get **301**. Any other method gets **308**, which keeps the method and body, so a form left open across a deploy still posts. The rewrite is a pure function, `legacyHouseholdPath(path)`, with its own test. The middleware is a few lines in `src/web/routes/household.ts`.

## Shell and chrome (`src/web/shell.ts`)

- **`APP_TABS`:** `{ id: "settings", href: "/settings", label: "Settings" }` becomes `{ id: "household", href: "/household", label: "Household" }`. `AppTabId` follows. In `bottom-nav.ts`, the gear icon moves to the top bar, and the Household tab gets Lucide's `house` icon, inlined like the others.
- **`appBar(variant)`** has three variants:
    - `"app"` (tabbed pages): the gear, `<a class="btn-icon app-bar-action" href="/settings" aria-label="Settings" title="Settings">`.
    - `"settings"` (the Settings pages): no right-hand action, since the page has its own back button and Log out.
    - `"gate"` (create-household and forbidden): keeps today's Log out icon. Those pages are for someone who is signed in but not a member. `/settings` needs membership, so the gear would lead them to a 403 page with no way out. Log out has to stay reachable there.

    The CSS class `.app-bar-logout` is renamed `.app-bar-action` in `public/app/app.css`, and both icons share it.

- **`renderSettingsPage({ title, theme, backHref, body })`:** a new bare-page renderer for `/settings` and `/settings/help`. It uses `appBar("settings")`, has no bottom nav, and uses page theme chrome (`--bg`), like the other bare pages. The page header starts with a back link (`‹ Back`, `.settings-back`) to `backHref`.
- **`renderBarePage`** (create-household, forbidden) passes `"gate"`. Nothing else about it changes.

### Where "Back" goes

A pure function, `settingsBackHref({ from, referer, origin })`, with tests:

1. **Use `from`** (a query parameter) when it is a safe app path:
    - it starts with a single `/`;
    - it is not `/settings…`, `/logout`, `/login`, `/authorize`, `/approve` or `/exports/…`;
    - it is at most 512 characters.
2. **Otherwise use the `Referer` header,** when it is same-origin and its path passes the same rules. Compare against `getBaseUrl`, so `PUBLIC_ORIGIN` is respected.
3. **Otherwise use `/`.**

The gear link stays a plain `/settings`, so Referer usually answers. Once on the Settings pages, `from` keeps the original page:

- the Account · Help sub-nav links carry `?from=`;
- the account and nutrition forms send it as a hidden `from` field;
- `POST /settings` redirects to `/settings?from=…` with its toast.

So Settings → Help → Account → Back still returns to the tab you came from.

## Pages

- **`src/web/components/settings-nav.ts`** becomes a generic `subnav({ label, sections, active, query })`. It's called by:
    - `renderSettingsNav`: Account · Help, with `aria-label="Settings sections"`;
    - a new `renderHouseholdNav`: Members · Items, with `aria-label="Household sections"`.

    Same `.subnav` markup and styles as today.

- **`src/web/pages/settings.ts` (Account):**
    - renders through `renderSettingsPage`;
    - drops the Household and Foods sub-nav entries;
    - adds a final panel with a plain **Log out** link (`href="/logout"`, `data-turbo="false"`).
    - The account form keeps `data-turbo="false"` (the iOS toolbar tint).
- **`src/web/pages/settings-help.ts`:** renders through `renderSettingsPage`. Its glossary text stays.
- **`src/web/pages/household.ts`:** `active: "household"`, `renderHouseholdNav("members")`. The title stays "Household".
- **`src/web/pages/foods.ts`:** `active: "household"`, `renderHouseholdNav("items")`, and the title becomes **Items**. The "Add food" / "Add household item" actions and the merge flow are unchanged.

## Copy that names the old place

| Where                                            | Today                                                                                 | After                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `SERVER_INSTRUCTIONS` (`src/mcp/server.ts`)      | "…settings (members, stores, preferences)… in the web app at Settings → Household"    | "…household (members, stores, items)… in the web app under Household › Members"                  |
| `src/copy/login.ts` comment                      | "Settings → Household"                                                                | "Household › Members"                                                                            |
| `createHouseholdFormHtml` (`src/web/loaders.ts`) | "Everyone else is added from Settings."                                               | "Everyone else is added from Household."                                                         |
| `src/web/pages/grocery.ts` empty state           | "Add a grocery store in Settings, then add a line." plus a `/settings/household` link | "Add a grocery store under Household, then add a line." plus a `/household` link                 |
| `src/web/pages/recipes.ts`                       | "Add a grocery store in Settings, then add this recipe to the list."                  | "…under Household…"                                                                              |
| `docs/self-hosting.md`                           | "Settings → Household"                                                                | "Household › Members"                                                                            |
| `docs/deploy-checklist.md`                       | `/settings/foods`                                                                     | `/household/items`                                                                               |
| `CLAUDE.md` (household app sections)             | "(nutrition, fridge, grocery, recipes, settings)", Settings › Help                    | "(nutrition, fridge, grocery, recipes, household)"; Settings › Help stays, reached from the gear |
| `docs/usual-products-plan.md`                    | the "Layout change" section                                                           | points to this plan                                                                              |

`src/mcp/tools-list.snapshot.json` is unaffected: no tool changes.

## Tests and checks

**Updated** (they pin today's paths, tab ids or markup):

- `src/web/shell.test.ts`: `APP_TABS` ids and hrefs, and the app bar per variant.
- `src/web/components/settings-nav.test.ts`.
- `src/domain/settings.test.ts`, `src/domain/foods-settings.test.ts`, `src/domain/household-settings.test.ts`, `src/domain/settings-help.test.ts`.
- `src/app-js.test.ts`: `data-fill-action` now `/household/items/f1`.
- `src/public-site.test.ts`: the list of app paths.
- `src/web/turbo-forms.test.ts`, `src/web/components/ui.test.ts`, `src/app-css.test.ts`, `src/db/household-stores.contract.test.ts`, and any other file the full suite shows pinning `/settings/household` or `/settings/foods`.
- `src/mcp.test.ts`, if it pins the `SERVER_INSTRUCTIONS` text.

**New:**

- `legacyHouseholdPath`: prefixes, deeper paths and query strings, plus non-matches (`/settings`, `/settings/help`, `/settings/householdx`). Through the Hono app: 301 for GET and 308 for POST to the right place.
- `settingsBackHref`:
    - `from` wins;
    - unsafe values are refused: `//evil.example`, `https://…`, `/settings/help`, `/logout`;
    - a Referer from another origin is ignored;
    - the fallback is `/`.
- The Account page has a Log out link with `data-turbo="false"`, and the Settings pages have no bottom nav and use page theme chrome.
- Create-household and forbidden pages still show Log out in the app bar.

**Scripts:**

- **`scripts/nav-check.ts`**, the theme regression run:
    - visit Settings through the top-bar gear (`a.app-bar-action[href="/settings"]`) instead of `nav.bottom-nav a[href="/settings"]`;
    - expect page theme colours (`THEME_COLOR`) on `/settings` and nav colours (`THEME_NAV_COLOR`) after **Back** to a tab;
    - repoint the `/settings/foods` and `/settings/household` steps at the new paths;
    - add one step proving the old `/settings/foods` address lands on `/household/items`.

    `bun run check:nav` must pass.

- **`scripts/nav-check-fixture.ts`** and **`scripts/app-preview.ts`:** new paths, plus shots of the bare Settings page and the Household › Items page in both themes. Run `bun run preview:app --shots` and look at the shots before review.

**Gates:** `bun run format:check`, `bun run typecheck`, `bun test`, `bun run check:nav`, `bun run pr:check`.

## Order of work inside the PR

Each step is a commit that passes the tests:

1. Move the routes to `src/web/routes/household.ts` with the new paths, add the legacy redirect, and update every action, redirect and link.
2. `APP_TABS`, the bottom-nav icon, `appBar(variant)`, and the `.app-bar-action` rename.
3. `renderSettingsPage`, `settingsBackHref`, the `from` plumbing, the sub-navs, and Log out on the Account page.
4. Copy, docs, `CLAUDE.md`, `SERVER_INSTRUCTIONS`.
5. `nav-check` and `app-preview` updates, then the screenshots.

PR title: `refactor(web): move settings behind a top-bar gear and add a household tab` (subjects are all lowercase). Branch: `refactor/web-household-tab`. Check both against `scripts/conventions/` before opening.

## Out of scope

- The Usual products section (usual-products PR 5).
- Moving grocery stores to the Groceries tab (still open).
- Renaming loader functions such as `renderHouseholdSettingsRoute`. They work as they are, and renaming them would only add noise to a move.
- Any change to who may see or do what. The middleware moves with each route unchanged.
