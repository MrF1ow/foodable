# Household app styling

Read this before touching `public/app/`, `src/tokens.ts`, `src/brand.ts`, `src/web/components/`, `src/web/shell*.ts`, or before writing page markup. Routes and Turbo are in `docs/agents/web-app.md`; chat widget styling is in `docs/agents/widgets.md`.

## Two stylesheets

`/app.css` is the base: the generated shared `tokens.css`, `public/app/{base,form,table,seg}.css` (the app's own, first copied from the retired v1 widget partials), then the app-only brand layer, `public/app/brand.css` (APP palette, self-hosted Geist / Bricolage Grotesque) and `public/app/motion.css` (keyframes, reduced-motion guard). The share probe's bare page uses only that.

`/app-v2.css` is the shell's own stylesheet, loaded after it (the login page, the gate pages and the public share page load both). `public/app/v2/app-v2.css` is the one include list (`tokens.css` first, then one partial per area), partials resolve against `public/app/v2/`, and every class starts with `fd-`. `components-css.test.ts` fails on a colour literal or a non-`fd-` class in `components.css`.

## Tokens

Colours, type sizes (`--fs-*`) and radii (`--r-*`) live in `src/tokens.ts`. `bun run gen:tokens` writes:

- `public/widgets/src/shared/tokens.css` (the NEUTRAL base);
- `public/widgets/src/shared/v2/tokens.css` (Theme palette for v2 widgets);
- `public/app/brand.css`;
- `public/app/v2/tokens.css` (the shell palette, mirroring `design/figcraft-variables.json`).

`src/tokens.test.ts` and `src/tokens-v2.test.ts` fail when a committed file drifts. A token change reaches the widgets and the app together; check both (`bun run harness`, `bun run preview:app --shots`).

## Assembly and client scripts

Entrance animations are gated on `html.fx`, set by an inline head script (`ENTRANCE_FX_SCRIPT` in `src/web/shell.ts`) before the first paint and never under `prefers-reduced-motion`; the entrance fade of `.app-main` also needs `html.fx-enter`, which `src/web/client/shell.js` ends after a second and before any Turbo visit renders, so only a full load fades. App pages emit data attributes, not `<script>` blocks; client behaviour ships as `/app.js` (`getAppJs()`: Turbo, toast, modal, food picker) and `/app-v2.js` (`getAppV2Js()`: one IIFE per file in `src/web/client/v2/`). `getAppCss()`, `getAppV2Css()` and the two script getters in `src/widgets.ts` assemble with the widget resolver (`app.css` reaches app-only partials as `../../app/…`), cache, and warm at boot.

## Brand layer stays out of widgets

Chat widgets never include the brand layer or web fonts; they use the Theme palette and a system font. `src/app-brand.test.ts` fails if Geist, Bricolage or `/fonts/` reach a widget partial, or if widget v2 tokens leak into `getAppCss()` / `brand.css`. Brand changes go in `brand.css`, `app.css` or the shell partials, never in a widget partial.

## Brand icons

`src/brand.ts` holds the logo as hand-built SVG geometry: the bare mark, a light tile (green on `#f1f1f1`), a dark tile (white on `#383838`) and an adaptive favicon that switches on `prefers-color-scheme`. `scripts/gen-icons.ts` (`bun run gen:icons`, needs `rsvg-convert` and ImageMagick) writes `public/brand/*.svg`, `public/favicon.ico` and `public/apple-touch-icon.png` from it; `src/brand.test.ts` fails when the committed SVGs drift from the module. `/brand/:file` serves the SVGs straight from the module. Do not hand-edit the generated files.

## Markup rules

- **Plain markup inside `.native`.** App pages render inside `<main class="app-main native">`. `form.css` styles native `input` / `select` / `textarea` / `button` there through `:where(.native …)`, which has zero specificity, so a component class on the same element always wins. Never add a bare `.native button` rule: it outranks `.btn-primary`. App-layer rules in `app.css` follow the same convention.
- **The vocabulary.** Page primitives come from `src/web/components/ui.ts` (`pageHeader` with optional inline `titleActions` beside the `<h1>` and a `.page-actions` row below, `panel`, `field`, `disclosure`, `errorBanner`, `pageLevelErrorBanner`, `emptyState`, `row`). A page never hand-writes those. Sections are `.panel` (sub-blocks `.psec`). Lists are `ul.list` of rows: `.row` holding `.row-title` and a right-aligned `.row-meta`, then `.row-actions` (each action is its own POST form, `display: contents`). Secondary forms (add, edit) open in a `sheet` (`src/web/components/v2/sheet.ts`, `openOnLoad` to reopen it on a refused post), and a destructive action confirms in place in its ⋯ menu (`menu` with a `destructive` item); there is no `modal` or `confirmModal` any more. `<details class="more">` is only for read-only collapsibles and inline filter / log forms. Buttons: plain = neutral, `.btn-primary` = the one main action, `.btn-danger` = destructive, `.btn-sm` = in-row. A label above its control is `field({ id, label, control })` (the shared `.field` from `form.css`), never a bare `<label for>` beside its control: that pair leaned on a −8px margin against the parent's gap and overlapped wherever the parent was not a gapped grid. `src/web/components/field.test.ts` fails on a visible hand-written `<label for>` (visually hidden in-row labels are exempt) and on that negative margin coming back. Two-column fields: `.field-grid` with `<label>Text<input></label>`. Label + control + button on one line: `.fd-settings-form--inline` (Settings); a form that must not add a box to its row is `.fd-inline-form` (`display: contents`). Picker tabs are `.seg` / `.seg-btn` with `aria-selected`. Use `pageLevelErrorBanner` when errors may belong inside a sheet (`openModalId`); otherwise the banner sits under the page header. The shell's own pieces (rows, chips, stepper, stat tiles, score badge, sheets) are the `fd-` components in `src/web/components/v2/`, which take typed `Html` and escape every string through `esc`. Settings pages render inside the shell with a back link (`pages/v2/settings-shared.ts`), and Settings › Help (`/settings/help`) is a short glossary in `pages/v2/settings-help.ts`; the gate pages (create household, no household, not allowed, not found) are the Brand hero and a column from `pages/v2/gate.ts`, wrapped by `renderGatePage` with no bar.
- **One accent, three themes.** The accent is `--accent` from `tokens.css` and nothing overrides it: no swatch picker and no inline accent. `profiles.theme` is `light`, `dark` or null (System). Explicit themes stamp `data-theme` on `<html>` (`htmlOpen` in `src/web/shell.ts`); System leaves it off so the media query decides. The brand layer changes surfaces and type only; it never redefines `--accent` or a nutrient colour.
- **`[hidden]` is `display: none !important`** in `app.css`. Component `display` rules used to override the attribute.
- **Test-pinned class names.** Some classes are asserted exactly by tests (see `src/web/components/shared-import.test.ts`, `src/domain/*.test.ts`). Style those by name in `app.css` rather than appending classes in markup.

`src/docs-drift.test.ts` reads "The vocabulary." bullet above and fails when it names a class the shipped CSS no longer styles. Keep it one line starting `- **The vocabulary.**`.
