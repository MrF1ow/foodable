# Redesign of the household app: plan

Status: proposed 2026-11-08. Planner project: [UI](../planner/redesign/). Chat widgets are a separate track: [chat-widgets-plan.md](./chat-widgets-plan.md). Flags: [staging-plan.md](./staging-plan.md#feature-flags).

A mobile-first redesign of the household web app, with a desktop layout at one breakpoint. It ships behind feature flags, page by page, while the current app stays untouched until the new one has replaced it everywhere. Much of what the design shows needs functionality that does not exist yet; each of those pieces is its own item and its own flag.

## The design

`~/Documents/Foodable/Foodable Design.figcraft`, opened in the FigCraft app. It is the source of truth for the design.

**Read-only.** Read it with the FigCraft MCP tools (`inspect_document`, `get_node`, `screenshot`, and read-only `run_command`s such as `variable.list`, `component.list` and `text.loadFont`). Never edit or save it, not even to fix a mismatch. When the code and the design disagree, the code changes, or the design owner changes the design.

| Page                             | What it holds                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Tokens                           | Two variable collections. **Theme**: 24 colours with Dark and Light modes. **Tokens**: radii, spacing and the two font names. |
| Components                       | Status bar, home indicator, sheet grabber, nav bar with one variant per active tab.                                           |
| Screens · Dark / Screens · Light | 33 phone screens at 390 wide: Start and Today, logging, Trends, Kitchen, Recipes, Settings.                                   |
| Desktop                          | Today, Trends, Kitchen, Recipes, Settings at 1440 wide, in both themes.                                                       |
| Chat widgets                     | The MCP widgets in host-light and host-dark, at chat width. See [chat-widgets-plan.md](./chat-widgets-plan.md).               |

Fonts (Geist, Bricolage Grotesque) load per FigCraft session from `~/Documents/Foodable/fonts/`.

## Decided

- **Mobile first.** Swipe on rows (right: repeat, tick off, "ate some"; left: delete, toss, remove). Swipe the week strip between weeks. Secondary actions live in sheets.
- **No logo or app title inside the app.**
- **Navigation.** Four tabs: Today, Kitchen (Fridge, Groceries, Usuals as text tabs), Recipes, Trends. A green search button in the middle of a floating nav opens all logging. Settings opens from the account initials. Household moves into Settings. Needs-attention items show in place, not as a badge.
- **Desktop at 1024 px and up**: a left sidebar instead of the bottom nav, and a top bar with search (⌘K), scan and "Log food". The same pages, routes and tokens; one breakpoint, not a separate app. Content shown in place on the phone becomes cards in a right-hand column.
- **Colours.** The existing green-tinted APP palette in both themes. The logo green is a highlight, never a wash. Light / Dark / Auto is `profiles.theme`.
- **Usual products and usual stores stay.** Kitchen › Usuals lists one row per food (product or "Any brand", store, amount, restock schedule); the old Restock tab is gone and its schedule moves onto each usual. Groceries is grouped by store, then by that store's sections in walking order.
- **No images.** Nothing stores recipe or food photos. "Photo of meal" is not built (see ROADMAP, Not planned).
- **Product score** appears on a Product screen (from the scanner and search), as a badge in search results and Groceries, and in Settings › Product score. Plan: [product-score-plan.md](./product-score-plan.md).

## How it ships

1. **Foundations, no flags** (STG and UI foundation items): the flag adapter and its tables, staging, route moves, design tokens that match the FigCraft variables exactly, the new shell beside the old one, and the shared building blocks.
2. **Pages on today's backend**, each behind its own flag, inside the new shell (`ui-v2`).
3. **New behaviour**, each behind its own flag, each starting with its migration (migrations are never flagged).
4. **Retire the old app** once every page flag is on for everyone and removed: the old shell, pages, marketing layer, card arranging and embedded widgets go in one series.

Rules that hold throughout:

- **The old app is untouched while `ui-v2` is off.** The route moves (item UI-1) are the only change it gets before retirement.
- **Absent code needs no flag.** A control whose backend has not merged is simply not rendered; nothing appears disabled. A flag is for merged code that must stay dark.
- **Writes are never gated and keep the whole record.** Data saved by a member with a flag (score weights, usual schedules) survives edits by a member without it.
- **Household data uses household flags.** Anything that acts on shared data (the restock runner, store choice when adding to the list, the week plan) is targeted by household, so a household moves together.

## The new shell beside the old one

- `renderAppShell(chrome)` branches on `chrome.flags.uiV2`; `flags` joins `AppChromeBase`, built in `viewerChromeWithAttention` (`src/web/attention.ts`), which every tabbed page already uses.
- New assets `/app-v2.css` and `/app-v2.js`, content-hashed like `appStylesheetHref` (`src/widgets.ts`). Both shells mark their assets `data-turbo-track="reload"`, so a member whose shell changes gets one full reload, never a morph from old markup into new.
- A page without a redesigned body yet renders its current body inside the new shell (the old `app.css` loads alongside; new components use the `fd-` prefix). Deleted at retirement.
- One `sheet()` component on a native `<dialog>`: a bottom sheet with drag-to-dismiss on the phone; on desktop a right-hand panel (editing an item from a list) or a centred dialog (confirmations, short forms).
- Swipe rows only under `(pointer: coarse)`; under `(hover: hover) and (pointer: fine)` the same actions appear on hover or focus. The item's sheet always has them too.

## Design tokens

`src/tokens.ts` is the single source and must match the FigCraft variables exactly. A committed export of the two collections (`design/figcraft-variables.json`, from FigCraft `variable.list`) is compared by a test: same names, hex, alpha and numbers. Known differences today: light text, secondary and line are `oklch` rather than the design's hex; dark line is 10% white (design about 8%); dark accent text is `#3ddc9a` (design `#28cf8b`); `accent-soft` is not in the design; `surface/raised`, `text/tertiary`, `overlay/glass`, `overlay/scrim`, `overlay/shadow`, the radii (12, 16, 20, 28, pill) and spacing (20, 24, 11, 8) are missing. The new shell gets its own generated `public/app/v2/tokens.css`; `brand.css` and the widgets' `tokens.css` stay as they are until their own tracks change them. Type sizes and the breakpoint are not in the design's variables, so they stay code-defined.

## Flags

Temporary flags fall back to off; every temporary flag is sticky per subject (see [staging-plan.md](./staging-plan.md#feature-flags)). U = per user, H = per household.

| Flag                | Unit | Item             | Gates                                                         |
| ------------------- | ---- | ---------------- | ------------------------------------------------------------- |
| `ui-v2`             | U    | UI-3             | The new shell                                                 |
| `ui-v2-today`       | U    | UI-9             | The Today page                                                |
| `log-sheet`         | U    | UI-10            | Search / log sheet, amount sheet, desktop top search          |
| `quick-add`         | U    | UI-10            | Quick calories, water, weigh-in with a time                   |
| `ui-v2-kitchen`     | U    | UI-11            | Fridge / Overview, Groceries by store, batch put-away         |
| `usuals-tab`        | U    | UI-12            | Kitchen › Usuals and the edit-usual sheet                     |
| `ui-v2-recipes`     | U    | UI-13            | Recipe list and page                                          |
| `ui-v2-trends`      | U    | UI-14            | Trends                                                        |
| `ui-v2-settings`    | U    | UI-15            | Settings pages                                                |
| `repeat-meals`      | U    | UI-16            | Again, recents, copy yesterday                                |
| `stores-settings`   | H    | UI-17            | Store management and the switch in `pickGroceryStore`         |
| `usual-schedules`   | H    | UI-18            | Restock schedules, "add when it runs low", the runner switch  |
| `slot-suggestions`  | U    | UI-19            | Empty-slot hints and Use soon recipes                         |
| `cook-preview`      | U    | UI-20            | "Takes from your kitchen" in the cook sheet                   |
| `week-plan`         | H    | UI-21            | Planning recipes on days                                      |
| `recipe-favourites` | U    | UI-22            | Favourites                                                    |
| `notices-v2`        | H    | UI-23            | New notice kinds (also in `list_notices`)                     |
| `goals-editor`      | U    | UI-24            | Editing goals in the app                                      |
| `ai-connections`    | U    | UI-25            | Settings › AI connections                                     |
| `barcode-camera`    | U    | BAR-2            | The camera scanner; kept afterwards as a kill switch          |
| `product-score`     | U    | SCORE-5, SCORE-3 | Score on the Product screen, badges, Settings › Product score |

Kill switches (permanent, fall back to on): `off-lookups`, `recipe-link-reader`, `barcode-camera`, `restock-runner`.

## Where the code funnels

- **Open Food Facts**: `lookupBarcode` and the search URL in `src/foods.ts`, `searchFoodsByName` in `src/food-search.ts`. The `off-lookups` kill switch sits in those two functions, not in their callers.
- **Recipe links**: `recipeImportFetcher()` in `src/recipe-url-fetcher.ts`, used by the web import route and `import_recipe_from_url`.
- **Restock runner**: `runRestockCheck(liveRestockCheckDeps())` in `src/restock-runner.ts` loops over households; an `isEnabled` dependency checks household flags there.
- **MCP**: `buildMcpServer` in `src/mcp/server.ts` loads the profile per request; flags load in the same `Promise.all`. All tools register unconditionally today in a fixed order pinned by the tools-list snapshot.
- **OAuth tokens** carry no client: `oauth_tokens` has `token`, `expires_at`, `created_at`, `user_id`. AI connections (UI-25) adds `client_id` and `last_used_at`. Until then flags target accounts, never a particular AI app.

## Existing items folded in

| Item                           | Now                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| BAR-1, BAR-2                   | The scanner in the log sheet and the desktop top bar, landing on the Product screen (UI-26).           |
| SCORE-2 to SCORE-7             | The Product screen, badges and Settings › Product score. SCORE-8 adds saturated fat for the breakdown. |
| CAL-3                          | Dropped: the month view is the November card on Trends (UI-14).                                        |
| CAL-4                          | Unchanged (per-day goals in MCP and the export).                                                       |
| CLN-8                          | Answered by the design: "Saved foods & recipes" in Settings (UI-15).                                   |
| CLN-10                         | Before Use soon and the slot hints (UI-19), which name days.                                           |
| GEN-6                          | Dropped: the design keeps "Groceries".                                                                 |
| Inbox: grocery store placement | Answered: Settings › Household › Stores (UI-17).                                                       |

## Open questions

Tracked as decision items UI-28 to UI-30. In short: whether a Today row is a meal or a food; configurable meals of the day; what "low" means for a usual; whether the expiring-food restock stays beside usual schedules; a per-store shopping day; deleting a store with lines on it; hidden sections and store rules; the calories-by-day "near goal" margin; favourites per member or per household; where Display lives in desktop Settings. Flag questions (pin lifetime, the self-hoster override, beta opt-in) are STG-11.
