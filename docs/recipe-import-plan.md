# Recipe import from links: implementation plan

Status: proposed 2026-11-04. Starts after [usual products](./usual-products-plan.md), which supplies the macros an imported recipe needs. Replaces the sketch that was in [roadmap.md](./roadmap.md#recipe-import-from-links).

## Goal

Paste a link and get a recipe. The user does not pick the source; the link decides what happens. Every import:

- **is honest about the platforms' terms.** Anything that goes against a platform's terms is opt-in, off by default, and explained before it can be switched on (see "What Foodable does");
- **keeps the original link** and shows where the recipe came from as an icon;
- **is parsed deterministically.** A model is only involved through the household's own chat agent, never on the server;
- **saves as unverified** when the deterministic check does not pass. It is kept, not thrown away, until someone or something fixes it;
- **explains itself:** every outcome, including every failure, has a reason code that becomes a toast in the web app and a `status` field over MCP.

## What the platforms allow

### What the terms say

From the terms-of-service research of 2026-11-04 ([research/recipe-import-terms-2026-11.md](./research/recipe-import-terms-2026-11.md), with every clause quoted and linked; not legal advice):

| Source                       | Do the terms allow a server read?                                                                                                                                                                                                                             | The terms-compliant route                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Recipe website               | Yes: one request for the URL the user gave, with an honest user agent, honouring `robots.txt`                                                                                                                                                                 | The page's schema.org `Recipe` JSON-LD. No JSON-LD means the user pastes the recipe.                                           |
| Instagram, Facebook, Threads | No. Meta's terms ban automated collection "regardless of whether" logged in, and the Automated Data Collection Terms limit any use to search results and link previews. Instagram's oEmbed docs call extracting or storing its content "strictly prohibited". | The user pastes the caption.                                                                                                   |
| TikTok                       | No. Terms §3.4 bans extracting "any data or content in any form, for any purpose" by automated means. oEmbed returns no caption.                                                                                                                              | The user pastes the caption.                                                                                                   |
| Pinterest                    | No. Terms §2(a) bans automated access without express permission.                                                                                                                                                                                             | The user pastes the recipe, or the link to the recipe website the pin leads to. That link then goes through the website route. |
| YouTube                      | No page reads; the terms ban automated access. The Data API caps storage at 30 days and forbids derived data, which rules out a permanent recipe.                                                                                                             | The user pastes the description.                                                                                               |

### What Foodable does (household decision, 2026-11-04)

The household chose a middle path. Reading social posts automatically **goes against those platforms' terms** and is therefore **opt-in, off by default, with the risks spelled out**. Within that opt-in, three lines are never crossed: Foodable always says who it is, it always honours `robots.txt`, and a failed read always falls back to pasting the caption.

Tested on 2026-11-04 with the honest user agent (below) on real recipe posts:

| Source                      | Where the caption is                                                                 | `robots.txt` lets Foodable read it?         | What Foodable does                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Recipe website              | the page's `Recipe` JSON-LD                                                          | yes (natashaskitchen.com)                   | reads it, always on                                                                                                                      |
| TikTok                      | the video page: full caption (`desc`) and TikTok's own speech-to-text subtitles      | yes                                         | reads it **only when the TikTok reader is switched on**; otherwise paste                                                                 |
| Facebook                    | the official tokenless oEmbed endpoint (`graph.facebook.com`), inside the embed HTML | not a web page; `robots.txt` does not apply | reads it **only when the Facebook reader is switched on**; never fetches the Facebook page itself, whose `robots.txt` says `Disallow: /` |
| Instagram                   | the post page's preview tags (served to the honest user agent too)                   | **no:** `User-agent: *` → `Disallow: /`     | paste                                                                                                                                    |
| Threads, Pinterest, YouTube | not tested                                                                           | not checked                                 | paste; a Pinterest pin's recipe-site link goes through the website route                                                                 |

Fixed rules, for every request Foodable makes:

- **An honest user agent, always:** `Mozilla/5.0 (compatible; Foodable/<version>; +https://github.com/MrF1ow/foodable/blob/main/docs/fetcher.md)`.
    - The `compatible;` form is how well-behaved bots label themselves.
    - `Foodable` is the token a site can block in its `robots.txt`.
    - The link explains what the requests are, so the household's own domain is not sent to every site.
    - Foodable never sends a browser's or another bot's user agent (`facebookexternalhit`, `Googlebot`, …), even where that would get more content.
- **`robots.txt` is honoured on every host,** including the hops of a redirect.
- **No short-link expansion** (`vm.tiktok.com`, `fb.watch`, `pin.it`) unless that platform's reader is on, because expanding one is a request to the platform.
- **The raw page is never kept,** and neither are images or video.
- **Copyright.** A list of ingredients is not copyrightable (Copyright Office Compendium §313.4(F)). Headnotes, photos and creative wording can be. So an import keeps the structured ingredients and steps, the caption text it read or was given, and a link back, and never a site's images, its headnote, or the page.

**The opt-in (Household › Recipe settings › Read social posts automatically).**

- **Switches:** one per platform reader (TikTok, Facebook), all off by default, on every deploy.
- **Before a switch can be turned on, the page states plainly:**
    - this goes against that platform's terms of service;
    - the platform can block the server at any time, and on a shared host that block can affect anything else the server asks of that platform;
    - when that happens, imports fall back to pasting the caption, and nothing breaks;
    - a link to [the research](./research/recipe-import-terms-2026-11.md).
- **Who can turn it on:** only the household owner.
- **What happens on failure:** a reader that fails (blocked, empty, timed out, page format changed) falls through to the paste step and records why. The settings page shows each reader's last success and last failure, so a block is visible. Turning the switch off removes the step; no deploy needed.

**Instagram is paste-only for now.** The official `instagram_oembed` returns only a placeholder ("View this post on Instagram") whose caption is loaded later by Instagram's script. The post page and its `/embed/captioned/` variant are both disallowed for Foodable by `robots.txt`. No Meta endpoint returns an Instagram caption without an app.

**The Facebook reader relies on undocumented markup.** The caption arrives as fallback text inside the embed HTML, not as a field. Meta can drop it without notice, which is what the fall-through and the last-failure status are for.

- **Official embeds for display** (showing the post itself on the recipe page) are a separate, later decision: they load the platform's script into the app, which the CSP does not allow today.
- **Pasted text is always available,** on every platform, whether or not a reader is on.

## Libraries

- **[`parse-ingredient`](https://github.com/jakeboone02/parse-ingredient)** (MIT, one dependency) turns "1 ½ cups flour, sifted" into quantity, unit, description and note, and handles ranges and section headers like "Chicken Coating:". This is the genuinely hard part. Pin 3.1.0: 3.2.0 was published on 2026-11-04, so give it time.
- **[`robots-parser`](https://github.com/samclarke/robots-parser)** (MIT, no dependencies, about 7.7 million downloads a week) answers "may this user agent fetch this path" from a site's `robots.txt`.
- **Our own schema.org `Recipe` reader, not a scraper package.** Reading the page's JSON-LD is a small, pure function. It finds every `<script type="application/ld+json">` and parses each one, skipping any that fail to parse. It handles:
    - a top-level object, an array, or an `@graph`, and `@type` given as a string or an array;
    - the first `Recipe` node, preferring one with ingredients;
    - `recipeYield` as a number, a string or an array (`["4", "4 people"]`);
    - ISO 8601 `prepTime`, `cookTime` and `totalTime`;
    - `recipeInstructions` as a string, a list of strings, `HowToStep`, or `HowToSection` with nested steps;
    - HTML entities and stray tags in text.

    [`recipe-scrapers-js`](https://github.com/nerdstep/recipe-scrapers-js) was considered and left out:
    - it is young (one release, about 30 downloads a week);
    - it adds `cheerio`;
    - it throws for any site not on its list;
    - on sites that publish JSON-LD it reads the same data.

    If a page has no JSON-LD, the user pastes the recipe. There is no fallback that scrapes arbitrary HTML.

- **[`simple-icons`](https://simpleicons.org)** (CC0) supplies the Instagram, TikTok, Facebook, Threads, Pinterest and YouTube glyphs. Copy the few SVG paths into a module rather than taking the whole package.

## Data model

### Unknown amounts

`recipe_ingredients.amount` and `unit` become nullable. Null means "not measured" ("salt to taste", "sesame seeds"), never zero.

- **Type:** `RecipeIngredient.quantity` becomes `Quantity | null`, with the note carrying "to taste" where the source says so.
- **Macros:** an ingredient with no amount makes the recipe incomplete, and `ingredientGaps` gains an `"amount"` reason.
- **Grocery list:** the food still goes on the list, shown as "Salt · to taste". Internally the line keeps a placeholder amount of 1 in the food's default unit, so put-away, "already have" and the stock ledger stay unchanged. The text comes from a new nullable `grocery_lines.note` column (an additive migration in R1), and put-away asks for the real amount, prefilled with 1. If the food is already on the list, no second line is added. If the food is already in the fridge, "already have" covers it and nothing is added.
- **Cooking:** nothing is decremented for it, and the result says so, the same way a shortfall is reported.
- **Scaling:** unknown stays unknown at any portion count.

### Verification

- **`recipes.verification`** is `text not null default 'verified'`, checked against `('verified', 'unverified')`. Existing recipes and recipes a person creates by hand are `verified`: the person is the source. Imports start `unverified` and only the check below can verify them. A person cannot override it, because grocery lists and cooking rely on it.
- **A new `recipe_imports` table** has one row per imported recipe, holding what the import had to work with:
    - `recipe_id` (primary key, cascade delete) and `household_id`;
    - `source_kind`: `website | instagram | facebook | threads | tiktok | pinterest | youtube | text`;
    - `source_url`, the cleaned link;
    - `source_text`: the caption the user pasted or a reader returned, null for a website import;
    - `source_text_origin`: `pasted | shared | read`, so it is clear which texts came from an opt-in reader;
    - `transcript`: TikTok's speech-to-text, when the TikTok reader got it;
    - `credit`: an optional creator name the user typed;
    - `unresolved_lines`: a JSON list of ingredient lines the parser could not read;
    - `problems`: the check's last result;
    - `imported_at`.

    Row level security and `service_role` grants go in the same migration. It is a separate table so `recipes` stays lean and hand-made recipes carry nothing extra. A website import stores no page content here, only the link.

- **`recipes.source_url`** keeps holding the original link, now cleaned, so a re-import of the same link is spotted. A non-unique index on `(household_id, source_url)` backs the lookup.
- **Expiry** is a household preference, `unverifiedRecipeExpiryDays: number | null`, in the existing `households.household_preferences` JSON, so it needs no migration. It is null (never) by default. When it is set, a daily sweep (scheduled like `sweepStaleExports`) deletes unverified recipes not changed in that many days. Any edit to a recipe or its ingredients bumps `recipes.updated_at`, so a recipe someone is working on is not swept.

### The check

`verifyRecipe(recipe, ingredients, importRow)` in `src/domain/recipe-import.ts` is pure and returns `{ verified, problems[] }`. It passes only when all of these hold:

1. The recipe has a name and at least one ingredient.
2. Every ingredient resolved to a food, and has an amount or an explicit "not measured".
3. `unresolved_lines` is empty.
4. The recipe has instructions.

It runs at the end of every import, after every edit to an unverified recipe (so a fixed recipe verifies itself), and on request. "Verified" means the recipe is complete and readable. It is separate from "incomplete", which means its nutrition cannot be computed yet, and that is what usual products fix.

### What unverified blocks

Unverified recipes can be viewed, edited and listed. `add_recipe_to_grocery`, `cook_recipe`, "can make now" and logging a portion refuse them with the reason. The Recipes tab shows a badge and lists the problems on the recipe page.

## The pipeline

```
paste link
  → validate: https only, a hostname, no private or loopback address
  → clean the link without contacting anyone: strip tracking params
    (utm_*, fbclid, igsh, obrf, si, and similar); keep the canonical path
  → duplicate? (household_id, source_url) already imported → "duplicate"
  → recipeSource(url): by hostname
      social (instagram, facebook, threads, tiktok, pinterest, youtube):
        text pasted with the link? use it
        else that platform's reader switched on?
          tiktok: robots.txt check, one GET of the video page, read desc + subtitles
          facebook: one call to the tokenless oEmbed endpoint picked by link shape
            (/videos/, /reel/, fb.watch → oembed_video; /posts/, /permalink, /photo → oembed_post),
            read the caption from the fallback blockquote (fb-xfbml-parse-ignore)
          success → use that text; failure → record why, fall through
        else "paste_needed" (with the reader's failure reason, if any)
      anything else, a website:
        robots.txt allows Foodable for this path? otherwise "robots_disallowed"
        one GET through the safe fetcher
        schema.org Recipe JSON-LD found? otherwise "no_recipe_on_page"
  → deterministic parse: parse-ingredient over the ingredient lines,
    resolution through the household catalog (and usual products)
  → save the recipe and its recipe_imports row, then run verifyRecipe
  → one status code back
```

**Parsing pasted text.** Splitting a free-text caption into ingredients and steps is a best effort:

- the parser looks for a block of lines that `parse-ingredient` reads as quantities, section headers like "Ingredients:" and "Directions:", and numbered or emoji-numbered steps;
- a caption with a clean ingredient block can verify on import;
- run-together sections ("Chicken Coating: 1.5 lb Chicken Breast 50g Egg Whites…") and prose recipes land as unverified, with the lines that did parse already in place and the rest in `unresolved_lines`. That is the cue for the agent.

Each piece is a pure function in `src/domain/recipe-import.ts`, tested against **hand-written fixtures**: JSON-LD shaped like real publishers' markup, and captions in the styles seen in testing. Copies of other people's pages are not committed. The fetch is the only network code, and the tests never touch the network.

### Safe fetcher

`src/fetch-safe.ts` is shared later with the shared-recipe importer under "Sharing":

- `https` only;
- the hostname resolved first, and loopback, private, link-local, CGNAT and unique-local addresses refused;
- `redirect: "manual"`, with every hop re-checked, both against those address rules and against `robots.txt` on the new host;
- a 10-second timeout and a 3 MB body cap, read as a stream.

**Client behaviour** (the fixed rules above, plus):

- one request per import (two for a TikTok read: the page and its subtitle file), with no crawl, no pagination and no images;
- `robots.txt` is cached per host for a day;
- a 401, 403 or 429 stops the import with no retry, and marks a reader as failing;
- the raw HTML is discarded once the recipe data or caption has been read;
- `docs/fetcher.md` is the page the user agent links to: what Foodable is, why it made the request, and how a site owner can block it (`User-agent: Foodable`) or reach the project.

One known gap: the address is checked before the connection, and `fetch` does not let us pin it. For a one-household app behind sign-in that risk is accepted and noted in the code.

## Outcomes and messages

Every result carries one code. The web app shows it as a toast (`src/copy/toasts.ts`, `recipes.import.*`). MCP returns it as `status` and never sets `isError`, for the same reason as `bulk_import_meals`: hosts that see `isError` often drop the structured result.

| Code                      | Toast                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `imported`                | "Imported Chicken Parmesan from natashaskitchen.com."                                                                                      |
| `unverified_needs_review` | "Imported as unverified: 4 ingredients need checking."                                                                                     |
| `paste_needed`            | "Paste the Instagram caption below." When a reader was tried, the reason is added, for example "TikTok didn't send the caption this time." |
| `no_recipe_in_text`       | "This caption doesn't contain a recipe. If it's in the photos, type it in or send a screenshot to your agent."                             |
| `no_recipe_on_page`       | "This page doesn't publish its recipe in a form we can read. Paste the recipe instead."                                                    |
| `robots_disallowed`       | "This site asks apps not to read this page. Paste the recipe instead."                                                                     |
| `site_refused`            | "The site refused the request. Paste the recipe instead."                                                                                  |
| `not_found`               | "That page doesn't exist anymore."                                                                                                         |
| `timeout`                 | "The page took too long to respond."                                                                                                       |
| `duplicate`               | "You already imported this." with a link to it                                                                                             |
| `invalid_link`            | "That doesn't look like a web link."                                                                                                       |

## Surfaces

### Web

- **Recipes tab, Import from link:**
    - a modal with one URL field;
    - for a website it imports straight away, with a busy state on the button;
    - for a social link it moves to a second step with the platform's icon, an "Open the post" link, a "Paste the caption" box and an optional "Creator" field;
    - success redirects (303) to the new recipe with the toast, and a failure re-renders the modal with the message.
- **Recipe list:** a source icon on each row, and an **All / Verified / Unverified** filter beside the existing ones (`recipeMatchesFilter`).
- **Recipe page:**
    - the source icon links to the original post, with the credit when there is one;
    - an unverified recipe shows its problems, the pasted text in a read-only disclosure, and a **Check again** button.
- **Household › Recipe settings:**
    - "Delete unverified recipes after N days", empty meaning never;
    - "Read social posts automatically": the per-platform switches with their risk text and last success / failure.
- **Settings › Help:** "How do I get unverified recipes verified?", with the agent prompt below and a Copy button.

### MCP

The total goes from 69 (after usual products) to 71 tools. The snapshot and `TOOLS` are updated in the same PR.

- **New `import_recipe_from_url`:**
    - takes `url`, plus optional `text` (the caption or recipe the user pasted) and `credit`;
    - for a website it reads the page as above;
    - for a social link without `text` it uses that platform's reader if the household switched it on. Otherwise, or when the reader fails, it returns `paste_needed`, and its description tells the agent to ask the user for the caption, not to open the post itself;
    - returns `status`, `recipe_id`, `verification`, `problems`, `source` (`kind`, `url`) and `unresolved_lines`, so the agent can finish in the same conversation.
- **New `verify_recipe`:** takes `recipe_id`, runs the check and returns the result.
- **`import_recipe_from_text`** (for recipes the agent has already structured):
    - takes an optional amount;
    - runs in one transaction;
    - keeps instructions separate from the raw text;
    - runs the same check, so a complete recipe verifies on import.
- **`list_recipes`:** takes a `verification` filter.
- **`get_recipe`:** returns `verification`, the problems and the import row.

### The agent prompt (Settings › Help)

> Check my Foodable recipes for unverified imports. Call `list_recipes` with `verification: "unverified"`. For each one, call `get_recipe` and read its import data: the source link, the pasted text, unresolved lines and problems. Work only from that text. Do not open or fetch the original post or page. If something needed is missing, list it for me instead of guessing.
>
> Fix only what the text supports:
>
> - split run-together ingredient lines;
> - turn each into an ingredient with an amount and unit, leaving the amount empty for "to taste" or anything never measured;
> - fill in the steps.
>
> Do not invent quantities or ingredients, and do not pick a brand: ingredients name plain foods.
>
> Then call `verify_recipe`. If it still fails, leave it and add a note saying what is missing. Finish with a short summary: verified, still unverified, and why.

A test checks that every tool named in the prompt is registered, so the help text cannot drift.

## Phases

Each phase is one PR unless noted, after the usual-products PRs.

1. **R1: unknown amounts and import fixes.**
    - Migration dropping `not null` on `recipe_ingredients.amount` and `unit`, and adding a nullable `grocery_lines.note`. Both are additive, with no contract line needed.
    - `add_recipe_to_grocery` adds "to taste" lines for unmeasured ingredients.
    - `Quantity | null` through recipes, linking, stock, meals and the web pages.
    - `import_recipe_from_text`: an optional amount, one transaction, and instructions kept separate.
2. **R2: verification.**
    - The `recipes.verification` column and the `recipe_imports` table, in one migration with RLS and grants.
    - `verifyRecipe` and `verify_recipe`.
    - Blocking grocery, cook and portion logging for unverified recipes.
    - The list filter and badge, the recipe page problems.
    - The expiry preference and sweep.
    - The Help entry and its prompt test.
3. **R3: reading recipe websites.**
    - Link validation and cleaning, and `recipeSource`.
    - The safe fetcher with the honest user agent and `robots.txt`.
    - The JSON-LD reader and the `parse-ingredient` step.
    - All pure and fixture-tested, with no user-facing change yet.
4. **R4: the entry points.**
    - `import_recipe_from_url`, websites first.
    - The Import modal, the toasts, the source icons, the duplicate check.
5. **R5: social links.**
    - The paste step for social links in the modal.
    - The `text` and `credit` parameters.
    - The caption parser with its fixtures.
    - The opt-in readers (TikTok page with subtitles, Facebook oEmbed) behind their switches, with the risk text, the fall-through and the last success / failure status.
    - `docs/fetcher.md`.
    - It can split into a paste PR and a readers PR.
6. **R6: phone share target.**
    - The household app becomes an installable PWA with a `share_target` that opens the Import modal.
    - What each app puts in a share (only the URL, or the caption too) is not documented anywhere. So this phase starts with a probe page that shows what arrived, tried from each app on a real phone.
    - Whatever text arrives is offered as the pasted text. A bare URL goes through the same pipeline as a pasted link: the platform's reader if it is switched on, otherwise the paste step.
7. **Later:**
    - official embeds for display on the recipe page, which need a CSP and third-party-script decision first;
    - **Instagram through the Graph API's Business Discovery,** the one terms-compliant automatic Instagram route. The costs:
        - a Meta app, a Facebook Page and a household member's Instagram professional account;
        - a Facebook user token with `instagram_basic`, `instagram_manage_insights` and `pages_read_engagement`, probably through App Review;
        - lookup is by creator username, not by link, so the user supplies it;
        - it only covers Business and Creator accounts;
        - whether `caption` comes back is unconfirmed.

        Worth it only if pasting Instagram captions turns out to be a real burden;

    - microdata (`itemprop`) for a site the household actually uses that has no JSON-LD;
    - looser name matching ("large eggs (beaten)" → Eggs, plurals, size words), as lookup variants that leave the stored normalized name alone.

**Ruled out:**

- any user-agent impersonation, on any platform;
- ignoring `robots.txt` (which keeps Instagram and the Facebook page itself on paste);
- following a post to a "guessed" creator website;
- the YouTube Data API as a recipe source;
- downloading video or transcribing audio on the server.

## Open questions

- **Pinterest and YouTube in the modal.** Pinterest usually leads to a recipe website. Should its paste step ask for that website link first, then fall back to recipe text?
- **Per-site terms.** The research did not read individual publishers' terms. If a site the household uses forbids all automated access, it should go on a small blocklist that sends it straight to "paste the recipe". Keep that blocklist in code, or make it a household setting?
