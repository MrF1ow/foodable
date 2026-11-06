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

Every page that shows a notice uses these two functions, so a notice looks the same wherever it appears. The Household tab dot counts `info` and `warn` notices of the codes that ask for a household decision (today, `food.possible_duplicate`).

### MCP

One shared `NOTICE_SCHEMA` in `src/mcp/shared.ts`: `code`, `severity`, `subject`, `related`, `message` (the registry sentence) and `action` (its label).

- Tools that return a thing also return its `notices`: `get_recipe`, `list_grocery_lines`, `get_fridge`, `get_food`, and `list_possible_duplicates` (food-duplicates plan).
- The old fields (`macros_per_portion.gaps`, `warning`) stay beside it for one release, filled from the same notices, then go.
- The agent reads the same sentences as the app.

## Tests

- A registry test: every `NoticeCode` has an entry with a badge, a sentence and a help id, and no entry exists without a code.
- The #162 messages, the Expired pill and the allergen warnings render exactly as before through the new path.
- Each producer, given the cases its current tests use, returns the expected codes, subjects and params.
- `noticesFor` merges producers, and orders notices block, then warn, then info.
- Web: `noticeBadge` and `noticeList` markup per severity, and that pages use them rather than hand-built markup. A test fails on a hand-written `recipe-macros-reasons` list or `allergen-warning` paragraph outside `notices.ts`, the way `field.test.ts` guards labels.
- MCP: `NOTICE_SCHEMA` validates the notices on each tool that returns them.

## Pull requests

1. **Model, registry, renderers,** with the recipe gaps moved onto them. That's the first producer, and it proves the shape against the newest code.
2. **Expiry and allergens** move onto notices, and the old pill and paragraph markup is deleted.
3. **MCP `notices`** on the tools above, with the old fields kept for one release.
4. Then the food-duplicates plan's Possible duplicates step adds `food.possible_duplicate` as a producer, with nothing new to render.

## Open questions

- **Dismissing a notice:** Possible duplicates needs "Keep separate". Should every `info` notice be dismissible through one shared table, rather than one per code?
- **Counts:** should the Household tab dot become a general "needs attention" count across every `warn` notice, or stay limited to decisions only the household can make?
