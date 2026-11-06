# Notices: one model for badges and reasons

Status: proposed 2026-11-06. A foundation for [food-duplicates-plan.md](./food-duplicates-plan.md), built before its Possible duplicates step.

## Goal

The app tells people when something needs attention: a recipe whose macros are incomplete, an expired fridge item, an allergen on a grocery line, a food that may be a duplicate. Today each of those is built by hand in the one place it appears, with its own wording, markup and MCP shape:

| Signal                            | Built in                                                                                  | Shown on                    | MCP shape                 |
| --------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------- | ------------------------- |
| Recipe macros incomplete          | `recipeIngredientGaps` (`src/domain/recipes.ts`)                                          | recipe page reasons list    | `macros_per_portion.gaps` |
| No nutrition · Pick usual product | inline checks in `src/web/loaders.ts`                                                     | recipe ingredient rows      | none                      |
| Expired                           | `expiryPill` (`src/web/components/page-markup.ts`), `expiryLevel` (`src/domain/stock.ts`) | fridge rows                 | `list_expiring` items     |
| Allergen                          | `groceryAllergenWarning` (`src/domain/grocery.ts`)                                        | grocery add, recipe page    | `warning: string`         |
| Possible duplicate (planned)      | would be one more                                                                         | Household, recipes, grocery | would be one more         |

So the same idea reads differently in different places, and changing the wording or look of one means finding every copy.

After this:

- **One model.** Everything that needs attention is a **notice**: a code, a severity, the thing it is about, and the related things.
- **One registry.** Each code's label, sentence, action and help text live in one file. Editing it changes the app, the agent and the help page together.
- **One renderer per surface.** The web app shows notices through one component. MCP returns them through one schema.
- **One place per thing.** Every food, recipe, fridge item and grocery line can show all its notices together, the same way everywhere.

## What is a notice, and what is not

A notice is something a person may want to **act on**, with a reason and, usually, an action.

These stay plain labels, not notices: they describe a thing rather than ask for attention.

- "Usual" and "Archived" pills on Items;
- recipe tags;
- a member's allergen and dislike pills;
- "already have" on grocery lines.

## The model (`src/domain/notices.ts`, pure)

```ts
type NoticeSubject =
    | { kind: "food"; id: string }
    | { kind: "recipe"; id: string }
    | { kind: "recipe_ingredient"; id: string; recipeId: string }
    | { kind: "fridge_item"; id: string }
    | { kind: "grocery_line"; id: string };

type Notice = {
    code: NoticeCode; // e.g. "recipe.no_nutrition"
    severity: "block" | "warn" | "info";
    subject: NoticeSubject;
    /** Other things the notice names: the usual product, the possible twin, the allergic member. */
    related: {
        kind: NoticeSubject["kind"] | "member";
        id: string;
        name: string;
    }[];
    /** Values the sentence needs, such as nutrient names or an expiry date. */
    params: Record<string, string | number | string[]>;
};
```

- No prose in the domain. A notice carries data only, so its wording lives in one place.
- Severity has a fixed meaning everywhere:
    - **`block`** stops an action until it is confirmed (an allergen);
    - **`warn`** is something wrong (incomplete macros, expired);
    - **`info`** is a suggestion (a possible duplicate).
- `NoticeCode` is a closed union, so a new kind of notice is one more code, and the compiler finds every place that must handle it.

### Codes at the start

| Code                                                                                                                                                       | Severity | Replaces                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------- |
| `recipe.no_food`, `recipe.no_nutrition`, `recipe.partial_nutrition`, `recipe.unknown_unit`, `recipe.missing_grams_per_each`, `recipe.missing_grams_per_ml` | warn     | `RecipeGap` reasons (#162), one code per reason     |
| `fridge.expired`                                                                                                                                           | warn     | the Expired pill                                    |
| `fridge.expiring`                                                                                                                                          | info     | the "expiring soon" level, which today has no badge |
| `grocery.allergen`, `recipe.allergen`                                                                                                                      | block    | `groceryAllergenWarning` strings                    |
| `food.possible_duplicate`                                                                                                                                  | info     | new (food-duplicates plan)                          |

## The registry (`src/copy/notices.ts`)

One entry per code. Everything a person or agent reads about a notice comes from here:

```ts
"recipe.no_nutrition": {
    badge: "No nutrition",
    sentence: ({ subjectName, usual }) =>
        usual
            ? `${subjectName}: no nutrition — its usual product, ${usual}, has none either`
            : `${subjectName}: no nutrition — add it, or pick a usual product`,
    action: { label: "Pick usual product", to: "usualProductPicker" },
    help: "usual-products", // the Settings › Help glossary entry it links to
},
```

- `badge` is the short label for a pill; `sentence` is the full line for lists, toasts and the agent.
- `action.to` names a route builder, not a URL, so links are built by one function per target.
- The sentences reproduce today's wording exactly. A test pins the #162 messages so moving them changes nothing a person sees.
- The Help glossary links to the registry for each code's explanation, rather than restating it.

## Producers

Each source of notices becomes a pure function that returns `Notice[]`. The domain logic doesn't change; only the output does.

- `recipeNotices(ingredients, foodsById)` wraps `recipeIngredientGaps`. `RecipeMacros.gaps` and `incompleteReasons` stay as derived fields for one release, then go.
- `fridgeNotices(items, today)` wraps `expiryLevel`.
- `allergenNotices(...)` wraps the allergen checks.
- `possibleDuplicateNotices(...)` comes from the food-duplicates plan.

`noticesFor(subject)` gathers every producer's notices for one thing, so any page can ask "what needs attention here?" with one call.

## Surfaces

### Web

`src/web/components/notices.ts` holds the only notice markup:

- `noticeBadge(notice)`: a pill coloured by severity with the existing shared pill classes: `pill-bad` for block, `pill-warn` for warn, `pill-dim` for info. No new colours;
- `noticeList(notices)`: the sentence and action for each notice, replacing `ul.recipe-macros-reasons` and the allergen paragraphs.

Every page that shows a notice uses these two functions, so a notice looks the same wherever it appears. The household-wide count and the tab dots are described under "Needs attention" below.

### MCP

One shared `NOTICE_SCHEMA` in `src/mcp/shared.ts`: `code`, `severity`, `subject`, `related`, `message` (the registry sentence) and `action` (its label).

- Tools that return a thing also return its `notices`: `get_recipe`, `list_grocery_lines`, `get_fridge` and `get_food`. `list_notices` returns them for the whole household (see "Needs attention").
- The old fields (`macros_per_portion.gaps`, `warning`) stay beside it for one release, filled from the same notices, then go.
- The agent reads the same sentences as the app.

## Dismissing a notice

Some notices are suggestions a person may disagree with ("chicken egg might be Eggs": no, keep them separate). The answer must be remembered, or the same suggestion comes back forever. Rather than one table per kind of suggestion, there is one:

- **`notice_dismissals`** (`household_id`, `code`, `subject_kind`, `subject_id`, `related_key`, `dismissed_by`, `created_at`). `related_key` holds the other half of a pair (for a duplicate, the other food's id, the pair ordered so either side finds it). It is `text not null default ''` rather than nullable, so the unique key below also holds for single-subject notices: a nullable column would let two identical dismissals in, because Postgres treats nulls as distinct. It is a new table, with RLS and grants like every new table. Its indexes are under "Indexes and speed" below.
- **Only `info` notices can be dismissed.** A `warn` or `block` notice, such as an allergen or incomplete macros, goes away only when its cause is fixed.
- **The registry says which codes allow it** (`dismissible: true`) and what the button says ("Keep separate" for a duplicate, "Dismiss" otherwise).
- **A dismissal lasts** until its subject or related thing goes away, for instance when a food is merged into another. Each thing's notice list has "Show dismissed", where a dismissal can be undone.
- Producers stay pure: `noticesFor` filters out dismissed notices after the producers run, so no producer has to know about dismissals.

## Indexes and speed

Notices are computed, not stored, so they are as fast as the reads behind them. Dismissals are the one stored part. The table only grows, and three reads hit it, so each gets an index. Each index is written in the migration with a comment naming the read it serves, the way `20261102120000_hot_query_indexes.sql` does.

| Read                                                                              | Index                                                                                                      |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Is this notice dismissed? (every `noticesFor` call)                               | `unique (household_id, code, subject_kind, subject_id, related_key)` (the key is also the uniqueness rule) |
| "Show dismissed" for one thing, and cleaning up when a thing is merged or deleted | `(household_id, subject_kind, subject_id)`                                                                 |
| Cleaning up the other half of a pair when that food is merged                     | `(household_id, related_key) where related_key <> ''` (partial, so single-subject rows cost nothing)       |
| Needs attention's newest-first history of dismissals                              | `(household_id, created_at desc)`                                                                          |

- **One read per request.** `noticesFor` loads a household's dismissals once per request, with one query on the unique index, and filters in memory. It never runs one query per notice.
- **No foreign keys on subjects.** A subject can be a food, recipe, fridge item or grocery line, so there is no foreign key to clean up after it. The writers that remove a thing remove its dismissals in the same transaction: `mergeFoods`, the delete paths, and archiving. A test covers each.
- **The producers' own reads** reuse what pages already load. A recipe's notices come from the effective food map the recipe page builds anyway, and the fridge's come from the items it lists. The only new household-wide read is the Needs attention count.
- **Measure the count before caching it.** PR 4 times the count on a bench copy, like the hot-query indexes were measured, and records the number in the migration comment. A stored per-household count, updated by writers, is added only if it is slow, and it is not part of the first version.

## Needs attention

One count, across the whole household, of open `warn` and `info` notices. It is the same number everywhere it appears.

- **A count in the top bar** next to the Settings gear, shown only when it is above zero. It opens **Needs attention**, one page listing every open notice grouped by the thing it is about, newest first, with each notice's action and, for `info`, its dismiss button.
- **Tabs get a dot** when they hold open notices of their own: Fridge for expiry, Recipes for incomplete macros, Household for possible duplicates.
- `block` notices are not counted. They appear at the moment of the action they block, such as adding an allergen to the grocery list, not as backlog.
- **MCP:** `list_notices { code?, severity?, subject_kind? }` returns the same list. `dismiss_notice { code, subject, related_id? }` dismisses an `info` notice; the agent asks first. Together they take the tool count from 69 to 71, and they serve every notice, so features like Possible duplicates need no tools of their own.

## Tests

- A registry test: every `NoticeCode` has an entry with a badge, a sentence and a help id, and no entry exists without a code.
- The #162 messages, the Expired pill and the allergen warnings render exactly as before through the new path.
- Each producer, given the cases its current tests use, returns the expected codes, subjects and params.
- `noticesFor` merges producers, and orders notices block, then warn, then info.
- Web: `noticeBadge` and `noticeList` markup per severity, and that pages use them rather than hand-built markup. A test fails on a hand-written `recipe-macros-reasons` list or `allergen-warning` paragraph outside `notices.ts`, the way `field.test.ts` guards labels.
- MCP: `NOTICE_SCHEMA` validates the notices on each tool that returns them.
- Dismissals: an `info` notice dismissed for one subject is gone for it and still shown for others; a `warn` notice can't be dismissed; a pair dismissal is found from either side; undoing brings it back; a dismissal whose subject was merged away no longer applies.
- Speed and cleanup:
    - `noticesFor` makes one dismissals query per request, however many notices there are;
    - merging, deleting or archiving a thing removes its dismissals, and the other half of a pair's, in the same transaction;
    - `db:dryrun` checks that all four indexes exist and that a duplicate single-subject dismissal is rejected.
- Needs attention: the count equals the page's list, excludes `block` and dismissed notices, and matches `list_notices`; each tab's dot follows its own codes.

## Pull requests

1. **Model, registry, renderers,** with the recipe gaps moved onto them. That's the first producer, and it proves the shape against the newest code.
2. **Expiry and allergens** move onto notices, and the old pill and paragraph markup is deleted.
3. **MCP `notices`** on the tools above, with the old fields kept for one release.
4. **Dismissals and Needs attention:**
    - the `notice_dismissals` migration;
    - "Show dismissed";
    - the top-bar count, the page and the tab dots;
    - `list_notices` and `dismiss_notice` (69 → 71 tools).
5. Then the food-duplicates plan's Possible duplicates step adds `food.possible_duplicate` as a producer, with nothing new to render, store or expose.

## Later: notifications and setup prompts

Notices are the source for anything that tells the household something, so these can be added without a second system:

- **Setup prompts:** `setup.*` codes such as `setup.no_fridge_location`, `setup.no_grocery_store`, `setup.no_goals` and `setup.no_timezone`, produced from what a household has not set up yet. They appear in Needs attention like any other notice, and disappear when the thing is set up, so onboarding is just notices.
- **Notifications:** a notification is a notice delivered somewhere else, such as a push, an email digest, or the agent mentioning it ("two things in the fridge expire tomorrow"). The registry would gain a delivery default per code, and each member a preference per code or severity. Dismissal and the count work as they do in the app.
- **Freshness:** delivering a notice needs to know which notices are new since the last delivery. That is the point where notices might be stored, or snapshotted per delivery, rather than only computed.

None of this is in the pull requests above. They are built so it fits later.

## Open questions

- **Expiring dismissals:** should a dismissal ever lapse on its own, for example "Expiring soon" coming back if the item is still there a week later?
- **The first day:** a household's first Needs attention count may be large (every incomplete recipe at once). Should the top-bar count start at warn notices from the last 30 days, with the full list on the page?
