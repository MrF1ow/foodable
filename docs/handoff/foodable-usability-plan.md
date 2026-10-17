# Foodable usability plan: actions up top, modals instead of disclosures

Status: P7 done. Written 2026-10-17 against `main` at `d5b91ef`. This is the owner-input phase U10 of `docs/handoff/foodable-ui-plan.md`. It touches the household app only; the in-chat widgets stay byte-identical to `main`.

Read `CLAUDE.md` in full first. Every rule there holds: Bun only, prettier-clean tree, test-pinned class names stay, expand-only migrations, every PR passes `bun run gen:all`, `bun run format:check`, `bun run typecheck` and `bun test`.

## What the owner asked for, grouped

| Theme                             | Asks                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary actions are at the bottom | Fridge: Add food / Add supply per location, Add location. Grocery: Add store, Clear checked. Recipes: New recipe.                                             |
| Disclosures for every action      | Every add / edit / delete is a `<details class="more">`. Replace with a modal: centered on desktop, a bottom sheet on mobile with swipe-down to dismiss.      |
| State is hard to scan             | Fridge "Expiring soon" needs a count and must collapse (default closed). Items need low / medium / high expiry levels. "Clear checked" must look destructive. |
| Small hit targets                 | The whole recipe row opens the recipe, not just the title.                                                                                                    |
| No guidance                       | Food vs supply is unexplained.                                                                                                                                |
| Fixed layout                      | The Nutrition cards can be reordered.                                                                                                                         |

## Decisions (owner, 2026-10-17)

| #   | Decision                                                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **Modal scope.** Every add / edit / delete form opens in a modal. Destructive one-click actions (Remove location, Clear checked, Delete item, Remove ingredient, …) get a confirm modal. The Recipes **Filter** and the Nutrition **log forms** stay inline. Read-only collapsibles (Expiring soon) stay `<details>`. |
| A2  | **Nutrition order is per user, in the DB.** An additive migration adds a nullable `profiles.nutrition_layout`. Reordering happens in an "Arrange" modal with up / down buttons. No drag and drop.                                                                                                                     |
| A3  | **Expiry levels.** High: expired or ≤ 1 day (expired shows "Expired"). Medium: 2–3 days. Low: 4–7 days. More than 7 days or no date: no badge. "Expiring soon" lists High + Medium (the current 3-day window) and shows the count in its summary.                                                                     |
| A4  | **Guidance.** Clearer labels ("Add household item" with the hint "foil, soap, batteries — things you stock but don't eat"), small (i) popovers on jargon, and a short Settings › Help page. The Foodable Site can link to it later.                                                                                   |

## Technical approach

### The modal primitive (P1)

- **Native `<dialog>` opened through Invoker Commands, so nothing needs JS to open or close.** The trigger is `<button type="button" commandfor="ID" command="show-modal">`. The close button is `command="close"`. Invoker Commands are Baseline across Chrome 135, Firefox 144 and Safari 26.2. The forms inside are the same plain POST forms as today, with the same class names and routes, so the server tests that pin those classes keep passing.
- **`src/web/components/ui.ts`** gets:
    - `modal({ id, title, body, size? })` → `<dialog class="modal" id aria-labelledby>` with a header (title + close button) and the body.
    - `modalTrigger({ target, label, className? })` → the invoker button.
    - `confirmModal({ id, title, message, action, confirmLabel, hiddenFields? })` → a modal whose body is a POST form with a `.btn-danger` submit and a Cancel (`command="close"`).
    - `disclosure()` stays for read-only collapsibles and the inline filter / log forms.
- **CSS in `public/app/app.css`** (app brand layer only, never a shared widget partial):
    - Desktop: centered, `max-width: min(560px, 100vw - 32px)`, panel surface, `::backdrop` dimmed.
    - `@media (max-width: 640px)`: a bottom sheet pinned to the bottom edge, full width, top radius, a grab handle, `max-height: 90dvh`, scrolls inside, `padding-bottom: env(safe-area-inset-bottom)`.
    - Open animation uses only `opacity` and `transform`, behind `html.fx`, and is disabled under `prefers-reduced-motion`.
- **`src/web/client/modal.js`**, added to `APP_JS_SOURCES`. It only enhances:
    - Clicking the backdrop closes the modal.
    - On a bottom sheet, dragging the grab handle or header down past ~80 px, or flicking it down, closes the sheet. The drag uses `transform` only and snaps back when released short of the threshold.
    - Focus goes to the first field when the modal opens.
    - If the server re-renders a page with an error that belongs to a modal, the modal reopens: `data-modal-open-on-load` on the dialog → `showModal()`.

### Expiry levels (P2)

- A pure `expiryLevel(expiresOn, today): "expired" | "high" | "medium" | "low" | null` in `src/domain/stock.ts`, beside `listExpiring`, with the same UTC-day arithmetic, plus unit tests. `listExpiring` keeps its 3-day window, which equals High + Medium.
- The row gets `data-expiry="high|medium|low|expired"` and a pill: High / Expired in `--over`, Medium in `--warn`, Low muted. These are existing tokens; `--accent` stays as it is.

### Nutrition layout (P5)

- Migration `supabase/migrations/<ts>_profile_nutrition_layout.sql`: `alter table profiles add column if not exists nutrition_layout text[]`, nullable, with no backfill (null means default order). Run `bun run db:dryrun`.
- A pure module `src/domain/layout.ts`: `NUTRITION_CARDS = ["log", "nutrition-summary", "goal-progress", "trends", "weight-trends"]` and `orderCards(saved)`. The latter drops unknown keys, appends missing ones in default order and dedupes. It has unit tests.
- `src/db/profiles.ts` reads and writes the column. `POST /nutrition/layout` takes `order` (each key with an up / down action) and redirects back.
- The page renders the cards in the viewer's own order, including when the viewer looks at a peer. A header action "Arrange" opens a modal listing the cards with ↑ / ↓ buttons (POST forms, so no JS).

## Phases

Each phase is one branch stacked on the previous one, so a phase only starts after the previous one passes review and the gates. Sub-tasks within a phase are not parallelized because they all touch `app.css` and `ui.ts`.

| Phase  | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1** | The modal primitive: `modal` / `modalTrigger` / `confirmModal`, CSS, `modal.js`, tests in `src/web/components/ui.test.ts`. Update the "vocabulary" bullet in `CLAUDE.md`: secondary forms open in a modal, and `details.more` is for read-only collapsibles and inline filters. No page changes yet.                                                                                                                                                                                                                                                                                                                                    |
| **P2** | Fridge. Header action **Add location** (modal). Each location's head row: **Add food**, **Add household item** (modals) and **Remove** (confirm modal). Item **Edit** becomes a modal, and its **Delete** gets a confirm. "Expiring soon" becomes a closed `<details>` whose summary reads `Expiring soon <span class="count">N</span>`. Expiry level badges on every row. An (i) popover on "household item".                                                                                                                                                                                                                          |
| **P3** | Grocery. Header actions **Add store** (owner only, modal) and **Clear checked** (`.btn-danger`, confirm modal). Each store's head row gets **Add food** (modal). Put-away stays inline.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **P4** | Recipes. The whole row is clickable: `.recipe-card { position: relative }` plus `a.row-title::after { content: ""; position: absolute; inset: 0 }`, keeping the one real `<a>`, and the row gets hover and focus-within states. Header action **New recipe** (modal). Every disclosure on the recipe detail page becomes a modal, with confirms on removes. Filter stays inline.                                                                                                                                                                                                                                                        |
| **P5** | Nutrition layout (above).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **P6** | The rest: the disclosures in `household.ts` and `foods.ts` become modals or confirms. Settings › Help (`/settings/help`, added to `renderSettingsNav`): a short glossary covering food vs household item, locations, stores and sections, expiry levels, put away, ate it vs toss, and recipe portions. Reuse the (i) popover helper (`infoTip()` in `ui.ts`, built on the native `popover` attribute) wherever the same jargon appears. Mark U10 Done in `docs/handoff/foodable-ui-plan.md`.                                                                                                                                           |
| **P7** | Owner polish from iPhone testing: neutral blurred modal backdrop (not `--over` red); scroll lock behind open modals (CSS + `modal.js` body fix for iOS); sticky top bar with safe-area padding, solid `--bg`, glow moved off `body` onto `.app-bar::after`, `viewport-fit=cover`; fridge row actions become icon buttons (edit / eat / delete) via `src/web/components/icons.ts`; remove all page `infoTip()` usage and delete the helper/CSS; Nutrition Arrange reorders client-side with Save (`arrange.js`) and `POST /nutrition/layout` accepts a full `order` list or legacy `card`+`direction`. Settings › Help glossary updated. |

## Verification per phase

- `bun run gen:all && bun run format:check && bun run typecheck && bun test`.
- Widgets are byte-identical: `git diff main -- public/widgets` is empty.
- Render the changed pages with `bun run preview:app --shots` at desktop width and at 390 px wide, in both themes. Check that the modal opens centered on desktop and as a bottom sheet on mobile, and that a server-side validation error reopens the modal.
