# Foodable UI plan: the site's look in the app, one source for everything

Status: not started. Written 2026-10-17 against `main` at `e0eebaf`; D4 and D5 approved the same day, so no phase is blocked on a decision. Every phase below is open. A reference implementation of most of it exists on the branch [`spike/magic-ui-fx`](https://github.com/MrF1ow/foodable/tree/spike/magic-ui-fx); see "Reference implementation" before writing code.

This plan is for an agent that has not seen the conversation it came from. Read `CLAUDE.md` in full first. Everything here assumes its rules (Bun only, prettier-clean tree, moves before changes, test-pinned class names). Where this plan changes a `CLAUDE.md` rule, the phase that does it says so and updates `CLAUDE.md` in the same PR.

## Goal

1. **The household app and the login page get the marketing site's look.** The site is `MrF1ow/foodable-site` (Next.js, Tailwind, Magic UI). The look comes mostly from type and colour, not from animation: Bricolage Grotesque headings, Geist body text, warm green-tinted neutrals, a soft green glow behind the page, pill controls, layered soft shadows, and a little restrained motion.
2. **The in-chat MCP widgets stay as they are.** They render inside Claude, ChatGPT, VS Code and Grok, so they keep the quiet neutral look. Every MCP tool, `ui://` resource and widget behaviour is unchanged.
3. **Nothing is defined in more than one place.** A colour, a font, a size, a piece of page chrome or a helper function lives in one file. Everything else reads it or is generated from it, and a test fails when a copy drifts.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Status                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| D1  | Keep MCP Apps widgets. The app gets the new look through an app-only brand layer on top of the shared partials. Dropping the widgets for app-only components was considered and rejected.                                                                                                                                                                                                                                                                                 | Approved 2026-10-17                                  |
| D2  | Self-host Geist (29 KB) and Bricolage Grotesque (41 KB), both SIL OFL 1.1, for the app and login only. This reverses the "no web fonts" outcome of #53. Widgets never load them.                                                                                                                                                                                                                                                                                          | Approved 2026-10-17 (owner approved the screenshots) |
| D3  | No React, Tailwind, `motion` or new runtime dependency. The Magic UI effects are rebuilt in CSS and a few lines of vanilla JS. Measurements are in "Evidence".                                                                                                                                                                                                                                                                                                            | Approved 2026-10-17                                  |
| D4  | Phases U5 and U8 may change the bytes of the assembled chat widgets, provided every widget renders pixel-identically (AE = 0, both themes) and the harness flows still work. "As they are today" means the same look and behaviour, not the same bytes. The unified `esc` (U8) renders a missing value blank instead of "null" and also escapes `'`; nothing that works today changes.                                                                                    | Approved 2026-10-17                                  |
| D5  | One `trendChart`: the `trends.html` version (the superset: takes `range` and `logged`; padding 8/8/6/4; dot radius 2.2) with nutrition-summary's dot rule, dots up to 10 days. Both copies draw on the same 480×54 canvas, so the differences are drift, not per-widget tuning. The trends widget stays pixel-identical (its 7/14/30 toggle shows dots on 7 either way). The only visible change is nutrition-summary's chart: 3 px more side padding and dots 2.6 → 2.2. | Approved 2026-10-17                                  |

## Invariants every phase keeps

- **Chat widgets are byte-identical to `main`** in every phase except U5, U8 and U9. Those may change bytes under D4 and D5, and must prove the rendering result instead. Check this with the widget hash script in "Verification toolkit".
- **The widget iframe CSP is deny-all by default.** There is no `font-src`, and `data:` fonts are blocked too (measured). Widgets never get fonts, `/app.css` or any app-only partial.
- **Widgets report their height** through `ui/notifications/size-changed` (`public/widgets/src/shared/bridge.js:155`). Nothing may animate layout properties (`width`, `height`, `margin`, `padding`, `top`, `left`, `inset`) or grow a list over time. Animate only `opacity`, `transform`, `filter` and registered custom properties.
- **Motion respects `prefers-reduced-motion`** everywhere. Entrance animations start only after a frame has actually ticked (the `html.fx` gate), so a renderer that never ticks shows the finished page instead of a blank one.
- **One accent,** `#28cf8b` (`BRAND_GREEN` in `src/brand.ts`). Text on an accent fill uses `--on-accent`. The brand layer never redefines `--accent`, `--on-accent` or any nutrient colour.
- **Test-pinned class names stay** (`src/web/components/shared-import.test.ts`, `src/domain/*.test.ts`, `src/web/dashboard.test.ts`, `src/web/components/settings-nav.test.ts`, `src/oauth.test.ts`, `src/mcp.test.ts`). Style them by name in CSS. Do not rename them.
- **Every PR leaves `main` deployable.** Railway deploys `main` (`.github/workflows/ci.yml`). Each PR passes `bun run gen:all`, `bun run format:check`, `bun run typecheck` and `bun test`, the same gates CI runs.
- **Bun only.** No Prettier config changes, no npm, no Vite. Do not add a dependency.

## Where things stand on `main` (2026-10-17)

The audit behind this plan found these duplications. File and line references are against `e0eebaf`.

| What                   | Copies today                                                                                                                                                                                                                                                                                                                                                                              | Fixed in |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Palette values         | Every value twice in `public/widgets/src/shared/tokens.css`: the media query block and the explicit `data-theme` block repeat each theme. The background is copied again in `THEME_COLOR` (`src/app/shell.ts:30`) and in the login head (`scripts/gen-login.ts:75-76`).                                                                                                                   | U2       |
| Logo green             | `BRAND_GREEN` (`src/brand.ts:11`) and `--accent` in `tokens.css`, typed separately                                                                                                                                                                                                                                                                                                        | U2       |
| Page `<head>`          | `appHead` (`src/app/shell.ts:69`) and a hand-written copy in `scripts/gen-login.ts:66-84`                                                                                                                                                                                                                                                                                                 | U2       |
| HTML escaping (server) | `src/app/shell.ts:36`, `src/oauth.ts:56`, `esc` in `scripts/site-partials.ts:7`                                                                                                                                                                                                                                                                                                           | U2       |
| Type sizes and radii   | 91 `font-size: Npx` and 28 `border-radius: Npx` literals across 9 CSS files; no scale tokens                                                                                                                                                                                                                                                                                              | U5       |
| Page chrome markup     | 10 hand-written `<h1>` page headers in 9 files. The error banner sits above the header on Nutrition (`src/app/nutrition.ts`) and below it everywhere else. `src/web/pages/settings.ts` writes the banner inline instead of `renderErrorBanner`. 16 `<details class="more">` disclosures in 7 files. 5 near-identical `renderEmpty*` functions (`src/web/components/page-markup.ts:7-24`). | U6       |
| Bare pages             | `renderBare` (`src/web/dashboard.ts:567`) builds create-household and forbidden with no top bar, and their log-out link is unstyled                                                                                                                                                                                                                                                       | U6       |
| App client JS          | Inline `<script>` strings in 4 modules: `src/app/shell.ts:90` (48 lines), `src/app/nutrition.ts` (51), `src/web/pages/grocery.ts` (20), `src/web/components/food-picker.ts` (95). The picker script is emitted once per instance: the Fridge page ships it twice. It also carries its own `esc`.                                                                                          | U7       |
| Widget JS helpers      | `esc` in all 9 templates in **3 different versions**, `fmt` ×5, `tpl` ×2, `setLocaleFrom` ×2                                                                                                                                                                                                                                                                                              | U8       |
| `trendChart`           | `nutrition-summary.html` and `trends.html`, **diverged**: padding 5 vs 8, dot radius 2.6 vs 2.2, dots shown up to 10 days vs 7                                                                                                                                                                                                                                                            | U9       |
| Folder layout          | Nutrition, the shell and Household settings live in `src/app/`; every other page is in `src/web/pages/`. `src/web/dashboard.ts` (579 lines) is the data loader for every tab under a misleading name. `src/web/components/bottom-nav.ts` and `src/app/shell.ts` re-export each other. 18 files import from `src/app/`.                                                                    | U1       |

The CSS is otherwise healthy. Colours already go through tokens, templates share only one local rule (`.qty` in fridge and grocery-list), and no app.css class is dead. Most of the 86 classes with no style rule are deliberate identifiers that tests pin. They get their look from the shared vocabulary (`.panel`, `.row`, `.list`).

## Target architecture

### Layers

```
src/tokens.ts ──(bun run gen:tokens)──▶ public/widgets/src/shared/tokens.css   NEUTRAL base (widgets + app)
       │                          └──▶ public/app/brand.css                 APP brand layer (app + login + embedded cards)
       ├── THEME_COLOR ──▶ appHead() ──▶ every app page and login
       └── APP_FONTS ──▶ /fonts/:file allowlist (src/index.ts)

public/widgets/src/shared/*.css ─┬─▶ each widget (getWidgetHtml)              unchanged look in chat
                                 └─▶ public/app/app.css ─▶ /app.css           + brand.css + motion.css + app rules
public/app/embed.css (= brand.css + transparent frame) ─▶ withWidgetData({ skin }) ─▶ widgets embedded in the app
src/web/client/*.js ─▶ getAppJs() ─▶ /app.js                                  all app client behaviour (U7)
```

Three CSS layers, in cascade order:

1. **Shared base.** `public/widgets/src/shared/` partials. The neutral look, used by widgets and inherited by the app. Never put brand rules here.
2. **App brand layer.** `public/app/brand.css` (generated: palette, fonts, font variables), `public/app/motion.css` (keyframes and the reduced-motion guard) and the brand section of `public/app/app.css` (controls, glow, nav, wordmark, login). App-only.
3. **Embed skin.** `public/app/embed.css` includes `brand.css` and adds a transparent background. `withWidgetData` injects it as the last `<style>` of a widget the app embeds. Chat hosts never receive it.

### Code structure after U7

```
src/
  brand.ts                 logo geometry, BRAND_GREEN (unchanged)
  tokens.ts                NEW U2: palettes, nutrient colours, ON_ACCENT, THEME_COLOR, APP_FONTS,
                           type and radius scales (U5), CSS emitters renderTokensCss/renderBrandCss
  html.ts                  NEW U2: escapeHtml, the one server-side escaper
  widgets.ts               assembler: getWidgetHtml, getAppCss, getEmbedCss (U3), getAppJs (U7),
                           withWidgetData(html, data, { theme, skin })
  index.ts                 + GET /fonts/:file (U3) and GET /app.js (U7)
  web/
    shell.ts               MOVED U1 from src/app/shell.ts: htmlOpen, appHead, renderAppShell,
                           renderBarePage (U6), APP_TABS
    loaders.ts             RENAMED U1 from src/web/dashboard.ts: per-tab data loading
    components/
      ui.ts                NEW U6: pageHeader, panel, disclosure, errorBanner, emptyState, row
      bottom-nav.ts        icons + nav markup (owns tabIcon; no re-export cycle)
      …existing components
    pages/
      nutrition.ts         MOVED U1 from src/app/nutrition.ts
      household.ts         MOVED U1 from src/app/settings/household.ts
      fridge.ts grocery.ts recipes.ts settings.ts foods.ts
    client/                NEW U7: plain browser JS, one file per behaviour
      shell.js             fx gate, panel spotlight, widget-frame sizing
      food-picker.js       one copy, wired by data attributes
      nutrition-log.js
      grocery.js
    routes/                unchanged
public/
  app/
    app.css                includes shared partials, then ../../app/brand.css and ../../app/motion.css
    brand.css              GENERATED U3 from src/tokens.ts
    embed.css              NEW U3
    motion.css             NEW U4
  fonts/                   NEW U3: geist-latin.woff2, bricolage-latin.woff2
  widgets/src/shared/
    tokens.css             GENERATED U2 from src/tokens.ts (byte-identical to today)
    util.js                NEW U8: esc, fmt, tpl, setLocaleFrom
    trend-chart.js         NEW U9
scripts/
  gen-tokens.ts            NEW U2
```

`src/app/` no longer exists after U1. Update the layout paragraph in `CLAUDE.md` in U1.

### Rules the structure enforces

- **A colour, font, size or radius changes in `src/tokens.ts` only.** `bun run gen:tokens` rewrites both stylesheets, and `src/tokens.test.ts` fails if a committed stylesheet differs from the generator's output.
- **App-only rules live in `public/app/`.** Shared rules live in `public/widgets/src/shared/`. `src/app-brand.test.ts` fails if a brand marker (`Geist`, `Bricolage`, `--accent-soft`, `/fonts/`) appears in any assembled widget.
- **Page chrome comes from `src/web/components/ui.ts`.** A page never hand-writes its header, error banner, empty state or disclosure. A change to page chrome is one edit.
- **App client JS lives in `src/web/client/`** and ships once, as `/app.js`. A page emits data attributes, not `<script>` blocks. Exception: the widget-frame sizing must still run in pages that embed widgets, and it moves to `shell.js`.
- **An app-only CSS partial is included from `app.css` as `../../app/<file>.css`.** The include resolver works relative to `public/widgets/src/` (`src/widgets.ts:96`). Nested includes inside a shared partial are not allowed: `src/widgets.test.ts` and `src/app-css.test.ts` require each included partial to appear verbatim in the output.

## Phases

Each phase is one PR, or a small stack of PRs, squash-merged with a `(#N)` subject like the rest of `main`. Do them in order. Each PR states which phase it is and links this file. Mark the phase done in the status table at the end of this file in the same PR.

| Phase | Theme                       | Changes look? | Changes widget bytes? | Depends on |
| ----- | --------------------------- | ------------- | --------------------- | ---------- |
| U1    | Moves: one place for pages  | No            | No                    | none       |
| U2    | Single sources              | No            | No                    | U1         |
| U3    | App brand layer (the look)  | App + login   | No                    | U2         |
| U4    | Motion                      | App + login   | No                    | U3         |
| U5    | Type and radius scale       | No            | Yes, pixel-identical  | U2         |
| U6    | Page chrome primitives      | App (small)   | No                    | U1, U3     |
| U7    | One client bundle `/app.js` | No            | No                    | U1, U4     |
| U8    | Widget helper partial       | No            | Yes, pixel-identical  | none       |
| U9    | One trend chart             | One widget    | Yes                   | none       |
| U10   | Layout and design polish    | App           | No                    | U6, owner  |

### U1. Moves: one place for pages (no behaviour change)

Pure file moves and renames. Zero output change.

- `git mv src/app/shell.ts src/web/shell.ts`, `src/app/nutrition.ts` to `src/web/pages/nutrition.ts`, and `src/app/settings/household.ts` to `src/web/pages/household.ts`. Move their tests the same way: `src/app/shell.test.ts`, `src/app/nutrition-log.test.ts` and `src/app/import-quantity.test.ts` go into `src/web/`, beside the code they test.
- `git mv src/web/dashboard.ts src/web/loaders.ts`, and `src/web/dashboard.test.ts` likewise. Keep every export name. Renaming exports (`renderDashboardPage` and friends) is optional and belongs to a later PR.
- Break the cycle: `src/web/components/bottom-nav.ts` currently re-exports `APP_TABS` and `bottomNav` from the shell, and the shell imports `tabIcon` from it. Make `bottom-nav.ts` own `bottomNav` and `tabIcon`, and have the shell import from it.
- Update all importers. That's 18 files that import from `src/app/`, plus `scripts/app-preview.ts`.
- `CLAUDE.md`: update the layout paragraph (`src/web/` holds the shell, pages, components, routes and loaders; `src/app/` is gone), and every `src/app/…` path it mentions (`htmlOpen in src/app/shell.ts` and others).
- Verify: rendered HTML is byte-identical. Run `bun run preview:app` on `main` and on the branch and `diff -r` the two `tmp/app-preview/` trees (HTML files only). The widget hash script is identical. All gates pass.

### U2. Single sources (no visual change)

Introduce the token source and remove the duplicated helpers. Rendering does not change, and widgets stay byte-identical.

- **`src/tokens.ts`.** Export `NEUTRAL` (light and dark surfaces), the nutrient colours, `ON_ACCENT`, `THEME_COLOR` and `renderTokensCss()`. `renderTokensCss()` must reproduce today's `public/widgets/src/shared/tokens.css` **exactly, byte for byte**, comments included. The reference implementation does this; diff the output against the file. `--accent` is emitted from `BRAND_GREEN`. In this phase `THEME_COLOR` is the neutral background (`#f5f5f7` / `#000000`), so nothing visible changes.
- **The emitter wraps long values the way the formatter does** (greedy packing of top-level comma parts to 80 columns), so generated files are format-clean without running Prettier. Copy `line()` and `topLevelParts()` from the reference.
- **`scripts/gen-tokens.ts`** writes `tokens.css`. Add `"gen:tokens": "bun run scripts/gen-tokens.ts"` and make `gen:all` = `bun run gen:tokens && bun run gen:pages`. Update the pin in `src/public-site.test.ts` (`gen:all is login-only…`, line 263): its point is "no marketing generators", and that still holds.
- **`src/tokens.test.ts`:** the committed `tokens.css` equals `renderTokensCss()`; `--accent` equals `BRAND_GREEN`; light and dark define the same keys.
- **`src/html.ts`** exports `escapeHtml`. The shell re-exports it for existing importers. `src/oauth.ts` imports it and drops its copy. `scripts/gen-login.ts` imports it in place of `esc`, and `esc` is removed from `scripts/site-partials.ts`.
- **Login head.** `scripts/gen-login.ts` builds its `<head>` with `appHead(rawTitle, "system")`, indented, plus its own `noindex` meta and comment. Pass the **unescaped** title: `appHead` escapes it. Regenerate `public/login.html`. The only expected diff is the `theme-color` lines moving up and the stylesheet link moving with the shared head.
- **`THEME_COLOR`** in the shell is imported from `src/tokens.ts`.
- `CLAUDE.md`: in "Household app styling", say that colours live in `src/tokens.ts` and the token CSS is generated. Add `gen:tokens` to "Commands".
- Verify: widget hash identical; `tokens.css` unchanged in `git diff`; app pages unchanged except the login `<head>` order; all gates pass.

### U3. App brand layer (the look)

The visible change. Chat widgets stay byte-identical.

- **Tokens.** Add `APP` (light and dark: `text`, `text-dim`, `bg`, `panel`, `panel-border`, `track`, `shadow`, `accent-soft`, `accent-ink`), `APP_FONTS` and `renderBrandCss()` to `src/tokens.ts`. `THEME_COLOR` becomes `APP.light.bg` / `APP.dark.bg` (`#fbfaf7` / `#0d0f0e`). The values are in the reference `src/tokens.ts`; they come from the site's `src/app/globals.css`. `gen-tokens` also writes `public/app/brand.css`, and the drift test covers both files.
- **Fonts.** Commit `public/fonts/geist-latin.woff2` and `public/fonts/bricolage-latin.woff2`. Take them from the official sources: Geist from `vercel/geist-font` releases, Bricolage Grotesque from `ateliertriay/bricolage` or Google Fonts, as latin-subset variable woff2. The spike copied the site's Next.js build output, which is fine for a spike but not for the repo. Add a `LICENSE`/`OFL.txt` beside them. Add `GET /fonts/:file` in `src/index.ts` beside the other static assets (line 211): serve only names in `APP_FONTS`, `Content-Type: font/woff2`, `Cache-Control: public, max-age=31536000, immutable`. The app CSP already allows `font-src 'self'` (`src/index.ts:68`).
- **`public/app/app.css`.** After the shared includes, add `/*@include ../../app/brand.css@*/`. Then add a brand section:
    - pill controls: `border-radius: 999px` on `.btn`, `:where(.native button)` and `.btn-sm`; 12px on fields; same selectors as `form.css`, so they win by order without raising specificity
    - a primary-button glow
    - a top-of-page green radial glow on `body`
    - headings in `var(--font-heading)` and section eyebrows (`h3`) in `var(--accent-ink)`
    - the wordmark as `.app-bar::before`, using `/brand/mark.svg`
    - a frosted `.bottom-nav` with `backdrop-filter`, the active tab on `--accent-soft`
    - the login hero: a dot texture plus glow on `body.auth`, a larger heading-font title, and a card shadow tinted with the accent
- **Embed skin.** Add `public/app/embed.css` (includes `brand.css`, then `html, body { background: transparent }`). Add `getEmbedCss()` to `src/widgets.ts`, assembled, cached and warmed in `warmWidgets` like `getAppCss`. Extend `WidgetViewerChrome` with `skin?: string`. `withWidgetData` injects `<style>${skin}</style>` before `</head>` **with a function replacement**, so a `$` in the CSS is not read as a pattern. `widgetCard` in the Nutrition page passes `skin: await getEmbedCss()`. Embedded frames inherit the app's CSP, so the fonts load inside them.
- **Tests.**
    - `src/app-brand.test.ts`: no brand marker in any assembled widget; `brand.css` appears in `/app.css` after `tokens.css`; `brand.css` defines no `--accent`, `--on-accent` or nutrient colour; the embed skin contains `brand.css` and a transparent background; the skin is injected last and only when asked, and `$&` survives.
    - In `src/public-site.test.ts` (line 123), keep "marketing stylesheet and old fonts gone", and add "the app serves its fonts from the allowlist; unknown and traversal names are not served".
    - Update the `theme-color` expectations in the shell test (`#000000` becomes `#0d0f0e`, `#f5f5f7` becomes `#fbfaf7`).
- **`CLAUDE.md`.** Rewrite the "One design system" paragraph as "one shared base, one app brand layer". Change the login line "no header, theme toggle or web fonts" to say login uses the app's fonts and brand layer. In "One accent, three themes", add that the brand layer never redefines `--accent` or a nutrient colour.
- Verify: widget hash identical; `bun run preview:app --shots` reviewed in light and dark for every page; login checked in both themes. Ask the owner to look at the screenshots before merge.

### U4. Motion (app and login only)

- **`public/app/motion.css`**, included from `app.css` after `brand.css`: the `fx-blur-in` keyframes, the registered `--fx-beam-a` angle with `fx-beam`, and a global `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important } }`.
- **The `html.fx` gate.** In the shell script, add `html.fx` inside a `requestAnimationFrame` callback, only when `window.matchMedia` exists and reduced motion is not requested. Guard `window.matchMedia`: `src/app/shell.test.ts:127` runs the shell script against a fake `window` without it.
- **Effects:**
    - **Page entrance (blur-fade):** `html.fx .app-main > *` animates `fx-blur-in`, staggered 40 ms per child, capped at 0.2 s.
    - **Panel spotlight (magic-card):** behind `@media (hover: hover) and (pointer: fine)`, a `.panel::before` radial gradient at `var(--mx) var(--my)`. One delegated, passive `pointermove` listener sets `--mx` and `--my` on the panel under the pointer.
    - **Login, under `prefers-reduced-motion: no-preference`:** an aurora sweep on `.auth-title`, once, in accent shades only; a border-beam on `.auth-card::after`, using a conic gradient on `--fx-beam-a` and a 6 s loop; and a shimmer on `.auth-form .btn-primary::after`.
- **Do not animate the embedded widgets.** A widget animation frozen mid-flight in a screenshot showed blurred cards. If an entrance on embedded cards is wanted later, it needs its own gated PR.
- **Tooling.** `scripts/app-preview.ts:355` passes `--force-prefers-reduced-motion` to Chromium. Without it, `--virtual-time-budget` freezes entrances half-done (measured: blurred cards, a counter stuck mid-count).
- **Test:** `motion.css` and the brand section animate no layout property (scan the `@keyframes` bodies for `width|height|margin|padding|top|left|inset`); `motion.css` contains the reduced-motion guard.
- Verify: open the pages with motion on (`bun run preview:app`, real browser) and with reduced motion emulated. Screenshots via `--shots` show no half-finished states.

### U5. Type and radius scale

- Add a type scale and a radius scale to `src/tokens.ts`, emitted into `tokens.css` as `--fs-*` and `--r-*`. Derive the steps from the 91 `font-size` literals and 28 `border-radius` literals (`grep -rnoE 'font-size: *[0-9.]+px|border-radius: *[0-9]+px' public/widgets/src/shared public/app/app.css`). Keep every existing value representable, so this is a pure substitution.
- Replace the literals in the shared partials and in `app.css` with the variables. `brand.css` may then override the scale for the app (for example, a larger `h1`).
- Verify: **rendering is pixel-identical.** Screenshot every widget in `bun run harness` (or by its standalone sample) and every app page, on `main` and on the branch, in both themes, and compare with `magick compare -metric AE` (must be 0). The widget hash changes; that is what D4 allows.

### U6. Page chrome primitives

- **`src/web/components/ui.ts`.** Add `pageHeader({ title, sub?, actions? })`, `panel({ title?, body, className? })`, `disclosure({ summary, body })`, `errorBanner(error?)`, `emptyState(text)` and `row({ title, meta?, actions? })`. Each returns the exact markup the pages write today, so the first commit is markup-identical.
- **Migrate every page** to the primitives:
    - All 10 `<h1>` page headers. Put the error banner in one place: directly under the header on every page, Nutrition included.
    - All 16 disclosures.
    - The 5 `renderEmpty*` functions become `emptyState`. Keep the `empty-*` classes the tests pin, via a `className` argument.
    - The inline banner in `src/web/pages/settings.ts` becomes `errorBanner`.
- **`renderBarePage`** in the shell replaces `renderBare` in `src/web/loaders.ts`. It gives create-household and forbidden the top bar (wordmark plus a styled log-out link).
- **Tests:** each primitive's markup; every page's `<h1>` comes from `pageHeader` (check that the rendered page contains the header markup once, and that no page module contains a raw `<h1`).
- **Tooling:** `scripts/app-preview.ts` renders bare pages in both themes. They follow the OS theme, so set the emulated colour scheme per shot, since headless Chromium defaults to dark.

### U7. One client bundle, `/app.js`

- Move the four inline scripts into `src/web/client/*.js`: `shell.js` (fx gate, spotlight, widget-frame sizing), `food-picker.js`, `nutrition-log.js` and `grocery.js`. They are plain browser JS, no imports. If you want TypeScript, transpile with `new Bun.Transpiler({ loader: "ts" })` the way `@inlinets` does (`src/widgets.ts:34`).
- **`getAppJs()`** in `src/widgets.ts` concatenates them into one IIFE per file. It is cached and warmed, and served at `GET /app.js` with `Content-Type: text/javascript`. `appHead` adds `<script src="/app.js" defer></script>`.
- **The food picker:** each instance carries its configuration in `data-*` attributes, including the result-row variant that today is baked into the script string (`src/web/components/food-picker.ts:40-49`). The script binds every `[data-food-picker]` on the page. One copy ships, and its `esc` is the only client escaper in the app.
- **Keep `script-src 'unsafe-inline'`** in the app CSP. The embedded widget frames are `srcdoc`, inherit the page's policy, and run inline scripts.
- **Tests:** the shell test (around line 100) extracts the inline script and runs it with `new Function`. Point it at `src/web/client/shell.js`. Add "no app page HTML contains `<script>` with a body except the widget frames" and "the Fridge page ships the picker logic once".

### U8. Widget helper partial

- Add `public/widgets/src/shared/util.js` with `esc` (the superset: `null` becomes `""`, and it also escapes `'`, as the `import-meals` version does), `fmt`, `tpl` and `setLocaleFrom`.
- Each template `@include`s it at the top level of its script, beside `bridge.js`, and deletes its local copies. `src/widgets.test.ts` requires each included partial verbatim, so include it directly from each template, never from another partial.
- Verify: pixel-identical rendering of every widget in both themes (see U5); `bun run harness` flows (import, grocery check) still work.

### U9. One trend chart

- The two `trendChart` copies (`nutrition-summary.html`, `trends.html`) differ in padding (5 vs 8), dot radius (2.6 vs 2.2), the dot cut-off (≤10 vs ≤7 days) and the signature (`trends` takes `range` and `logged`). Per D5, move the `trends.html` version to `public/widgets/src/shared/trend-chart.js`, change its dot cut-off to `n <= 10`, and keep nutrition-summary's comment explaining the cut-off (at 10 points the dots are ~52 units apart). Both templates `@include` it directly and call it; nutrition-summary passes no `range`/`logged`, so make those optional with the current trends behaviour as the default.
- Verify: the trends widget is pixel-identical (AE = 0) on all three ranges in both themes. nutrition-summary differs only in its chart (padding and dot size); put before and after screenshots of it in the PR.

### U10. Layout and design polish (owner input)

Not specified yet. Candidates from the site: stat tiles with large numbers (Nutrition overview), icons in section headers (the lucide set already in `bottom-nav.ts`), and better empty states. Each needs the owner to choose; build them on the U6 primitives.

## Magic UI component map

Every component the site uses, judged for this repo. "CSS" means rebuilt in `motion.css` / `app.css` per D3.

| Component                                                                       | Use in Foodable                                                                       | Phase |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----- |
| blur-fade                                                                       | Page entrance, staggered panels                                                       | U4    |
| magic-card                                                                      | Pointer spotlight on app panels (fine pointers only)                                  | U4    |
| border-beam                                                                     | Login card. Later, possibly "import running".                                         | U4    |
| shimmer-button                                                                  | Login primary button only                                                             | U4    |
| aurora-text                                                                     | Login title, once, accent shades only                                                 | U4    |
| dot-pattern                                                                     | Static login background (CSS radial-gradient, not an SVG per dot)                     | U3    |
| animated-shiny-text                                                             | Loading labels, if an app loading state is added                                      | later |
| number-ticker                                                                   | Headline figures, only in app-native components (not inside embedded widgets: see U4) | U10   |
| animated-list                                                                   | New grocery items in the app. Never in widgets: measured one host resize per item.    | U10   |
| bento-grid                                                                      | Possible Nutrition overview layout; it is a layout, not an effect                     | U10   |
| marquee, word-rotate, animated-beam, orbiting-circles, terminal, safari, iphone | Not used: motion forever with no data, screen-reader churn, or marketing-only devices | none  |

## Reference implementation

Branch [`spike/magic-ui-fx`](https://github.com/MrF1ow/foodable/tree/spike/magic-ui-fx) (5 commits on `e0eebaf`, not for merging). Its tip implements U2, U3 and most of U4 in one go. It did not follow this phase order, and its first commits are detours (widget-side motion, later removed). **Port from it phase by phase. Do not merge or cherry-pick it whole.** Files worth copying at the tip:

| File                                                                                           | For                                         |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `src/tokens.ts`, `scripts/gen-tokens.ts`, `src/tokens.test.ts`                                 | U2, U3 (split NEUTRAL into U2, APP into U3) |
| `src/html.ts`, `scripts/gen-login.ts`                                                          | U2                                          |
| `public/app/brand.css` (generated), `public/app/embed.css`, `src/app-brand.test.ts`            | U3                                          |
| `src/widgets.ts` (`getEmbedCss`, `withWidgetData` skin), `src/app/nutrition.ts` (`widgetCard`) | U3                                          |
| `src/index.ts` (`/fonts/:file`), `src/public-site.test.ts` (font tests, `gen:all` pin)         | U2, U3                                      |
| `public/app/app.css` (brand section at the end)                                                | U3, U4                                      |
| `public/app/motion.css`, `src/app/shell.ts` (script: fx gate, spotlight)                       | U4                                          |
| `scripts/app-preview.ts` (`--force-prefers-reduced-motion`)                                    | U4                                          |
| `CLAUDE.md` ("Household app styling" rewrite)                                                  | U3                                          |

At the tip: 1151 tests pass, typecheck and `format:check` are clean, and all 9 assembled widgets hash identically to `main`.

## Verification toolkit

- Gates: `bun run gen:all && bun run format:check && bun run typecheck && bun test`.
- **Widget byte check.** Run in both trees and diff the output:

    ```ts
    // bun hash.ts <repo root>
    const root = process.argv[2]!;
    process.chdir(root);
    const m = await import(`${root}/src/widgets.ts`);
    for (const k of Object.keys(m.WIDGET_TEMPLATES)) {
        const h: string = await m.getWidgetHtml(k);
        console.log(k, h.length, Bun.hash(h).toString(16));
    }
    ```

- **App pages:** `bun run preview:app --shots` writes `tmp/app-preview/<page>-<theme>.png` and `.html`. Compare HTML with `diff -r`, and images with `magick compare -metric AE a.png b.png null:`.
- **Widgets in a strict host:** `bun run harness` (starts the iframe at 130 px, logs every `size-changed`). For headless checks, drive Chromium over CDP in **real time**. `--virtual-time-budget` does not advance `requestAnimationFrame`-driven animation.
- Chromium must be on `PATH` for `--shots`. `rsvg-convert` and ImageMagick are only needed for `gen:icons`.

## Evidence

Measured during the 2026-10-15 to 2026-10-17 investigation. Repeat a measurement if a decision depends on it.

- **Bundle cost per widget if a runtime were inlined** (minified, gzipped): `motion/mini` 3.5 KB, `motion` 25 KB, Preact 11.0.1 5.8 KB, Preact + `motion` 30 KB, `preact/compat` + `motion/react` 56 KB, React 19.3.1 + `motion/react` 119 KB. The CSS approach adds about 1.7 KB, and the brand layer adds 0 KB to widgets.
- **CSP.** None of those bundles uses `eval` or `new Function`, and all ran under the harness CSP, so the CSP is not what rules them out. A `data:` font is blocked by the default policy and loads only with `font-src data:`. The MCP Apps spec maps `_meta.ui.csp.resourceDomains` to `font-src`, but host support is unverified.
- **Height.** Opacity, transform and filter animations caused 0 ResizeObserver callbacks over 3 s; a list growing every 400 ms caused 7. Entrance animations left the `size-changed` sequence and final heights of all 8 widgets unchanged.
- **Rendering.** With the motion spike, final frames were pixel-identical to `main` (AE = 0) in both themes. Under 6× CPU throttling (headless, no GPU) frame pacing did not change measurably. Real low-end phones are unverified.
- **Page weight.** The Nutrition page is 452 KB raw / 130 KB gzipped because it inlines four widget documents as `srcdoc`; Groceries is 18 KB. Not addressed by this plan (D1 keeps embedded widgets); a candidate for U10.
- **Grok.** Grok CLI 1.0.62 advertises the MCP Apps extension and forwards `resourceUri` over ACP, but a terminal does not render widgets. Whether any Grok surface displays them is unverified.

## Status

| Phase | Status      | PR  |
| ----- | ----------- | --- |
| U1    | Done        | #71 |
| U2    | Done        | #72 |
| U3    | Done        | #75 |
| U4    | Done        | #76 |
| U5    | Done        | #73 |
| U6    | Not started |     |
| U7    | Done        | #77 |
| U8    | Ready       | #70 |
| U9    | Done        | #74 |
| U10   | Needs owner |     |
