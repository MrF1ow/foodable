# Duplicate foods: implementation plan

Status: proposed 2026-11-06. Follows usual products ([usual-products-plan.md](./usual-products-plan.md)) and the word search in #164.

## Goal

Every fridge item, grocery line, recipe ingredient and meal item points at one household `foods` row. When the same thing arrives under two names, the household ends up with two rows. Production has "All purpose flour" next to "all-purpose flour", a "Chicken egg" row among its other eggs, and scanned cartons such as "Cage Free Grade A Large Eggs" sitting beside the plain food they belong to. Each duplicate splits stock, "already have", aisles and nutrition between two rows.

Today the only fix is Household › Items › Merge foods. That asks a person to find duplicates in a catalog they never chose to keep, and Items is a page most households should never need.

After this:

- **Certain duplicates are merged by the backend.** Two rows that differ only by punctuation or case are one food, and a reviewed one-off job merges the ones that already exist. #164 already stops new ones.
- **Likely duplicates are caught when they are created.** A new name that is probably an existing food ("chicken egg" for Eggs, "scallion" for Scallions) gets a "Did you mean Eggs?" question at that moment, in the app and through the agent.
- **Nothing uncertain is merged without a person.** Synonyms and plurals are suggested, never applied.
- **Items leaves the main navigation.** A food is edited where you meet it: a recipe ingredient, a grocery line, a fridge row, the usual-product picker.

## Why duplicates happen

| Cause                     | Example                                                             | Handled by                                                                                  |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Punctuation or case       | "All purpose flour" / "all-purpose flour"                           | #164 stops new ones; the merge job below fixes old ones                                     |
| Plural                    | "Egg" / "Eggs"                                                      | "Did you mean" at entry                                                                     |
| Word order or extra words | "Chicken egg" / "Eggs", "Flour, all-purpose" / "All-purpose flour"  | "Did you mean" at entry                                                                     |
| Synonym                   | "Cilantro" / "Coriander", "Scallions" / "Green onions"              | Aliases, once a person merges them (merge keeps the dropped name as an alias)               |
| A scanned product         | "Cage Free Grade A Large Eggs" beside "Eggs"                        | Not a duplicate: the post-scan prompt and Belongs to… file it as a product (usual products) |
| Different sources         | a recipe import, the agent and a scan name the same food three ways | All of the above                                                                            |

## Rules

### What the backend may merge on its own

Exactly one rule: same household, same kind, both live, equal `looseFoodKey` (from #164: lowercase, punctuation and `&` folded, no singularising), and equal brand (both null, or the same brand). Nothing else is ever merged without a person.

Even under that rule, a pair is merged only when the two rows do not disagree:

- **Nutrition, unit factors, default unit:** a field known on both rows must be equal. A field known on one row only is copied to the kept row. If any field disagrees, the pair is skipped and reported.
- **Allergens:** the kept row takes the union, so a merge can never make a food look safer.
- **Products:** two plain foods that both have products, or both have a usual product, are skipped and reported. `mergeFoods` already refuses the nesting cases.

Which row is kept: the one with more references (fridge items, grocery lines, recipe ingredients, meal items, stock movements), then the older one. The dropped name becomes an alias of the kept row, as `mergeFoods` already does.

### What is only ever suggested

`similarFoods(name, foods, aliases)` (pure, `src/domain/foods.ts`) returns at most three live, same-kind plain foods that are probably the same as a new name, in this order:

1. **Same words up to plurals:** the `foodNameTokens` sets are equal ("egg" / "eggs", "green onion" / "green onions").
2. **Contains every word of an existing plain food, with no brand or barcode on the new one:** "chicken egg" ⊇ "egg". (With a brand or barcode, the new row is a product, and the usual-products prompt asks "Is this one of your foods?" instead.)
3. **Word match from `matchFoodsByWords`,** capped and ranked as in #164.

Exact and alias matches never reach this point; they already resolve to the existing food.

## Code changes

### 1. Make `mergeFoods` complete (prerequisite)

`mergeFoods` repoints `fridge_items`, `grocery_lines`, `recipe_ingredients`, `member_dislikes`, barcodes and aliases. It does **not** repoint `stock_movements` or `meal_items`, which both reference `foods`:

- After a merge, the moved fridge items belong to the kept food while their movements still name the archived one, so `ledgerMatchesStock` fails for both foods.
- Meal items keep pointing at the archived row, so the food's history splits.

Fix: add both tables to the repoint (`REF_TABLES` in `src/db/foods.ts`, and the memory store), with a test that merges two foods with stock and logged meals and then checks `ledgerMatchesStock` for the kept food. Meal item snapshots keep their numbers: only `food_id` moves.

Also, `mergeFoods` fills the kept row's unknown fields from the dropped row and takes the allergen union, per the rules above. A merge from Items gets the same treatment.

### 2. The one-off merge job

`scripts/merge-duplicate-foods.ts` (`bun run foods:merge-duplicates`):

- `--dry-run` (the default) prints every pair the rule finds: the kept row and why, the dropped row, the fields copied, and the pairs skipped with their reason. It writes nothing.
- `--apply` merges the pairs it would print, each through `mergeFoods` in its own transaction, and prints the same report.
- It reads `DATABASE_URL`, like `db:migrate`. Production runs it once by hand after a review of the dry run (`railway run bun run foods:merge-duplicates`). It is not a migration and does not run on deploy: a merge is a data decision, not a schema change.

The pure part, `duplicatePairs(foods, refCounts)`, lives in `src/domain/foods.ts` with memory-store tests. The script only adapts.

### 3. "Did you mean" at entry

Every path that creates a food by name goes through one of four domain functions:

- `findOrCreateManualFood`, called from fridge, grocery, recipe and meal adds and from recipe import;
- `findUpsertFoodByName` (`upsert_food`);
- `findOrCreateFoodByBarcode` / `findOrCreateFoodByBarcodeResult`;
- `createProduct`.

Barcodes and products are covered by usual products. The name paths gain one step before they insert: if `similarFoods` returns candidates, the caller is asked instead of a row being created.

- **Domain:** `findOrCreateManualFood` takes an option `onSimilar: "ask" | "create"`. With `"ask"` and candidates, it throws a `SimilarFoodsError` carrying the name and the candidates, and writes nothing. Existing callers default to `"create"` until their surface handles the question, so this ships one surface at a time.
- **Web** (grocery add, fridge add, recipe ingredient add):
    - The form re-renders (4xx, modal open) with "Did you mean _Eggs_?". It lists up to three candidates as buttons that resubmit with that `food_id`, plus "Add _chicken egg_ as a new food", which resubmits with `new_food=1`.
    - Choosing a candidate also offers "Remember _chicken egg_ as another name for Eggs", which sets an alias, so the question is asked once.
- **MCP** (`add_grocery_line`, `add_fridge_item`, `add_recipe_ingredient`, `log_meal` items, `upsert_food` without `food_id`, `import_recipe_from_text` ingredients):
    - On candidates, the tool writes nothing and returns `status: "similar_foods"` with the candidates (`food_id`, name, brand, why). It does not set `isError`, for the same reason the importer doesn't.
    - The agent asks the person, then calls again with the chosen `food_id`, or with `new_food: true`.
    - `SERVER_INSTRUCTIONS` gains one sentence: never pick between similar foods on the household's behalf.
- **Recipe import** asks once for the whole recipe, not once per ingredient: the import returns every ingredient that has candidates in one list.

### 4. Edit a food where you meet it

A single food edit page, `/foods/:id`, reached from wherever a food appears:

- a recipe ingredient (next to its "no nutrition" reason and "Pick usual product");
- a grocery line;
- a fridge row;
- the usual-product picker.

It holds what the Items edit modal holds today (name, aliases, unit, grams factors, nutrition, allergens, archive, Belongs to / Usual product) and "Merge into another food…", which uses `matchFoodsByWords` to find the other food. It renders with the bare page shell and a Back link (`from`), like Settings.

### 5. Items leaves the main navigation

- The Household sub-nav becomes **Members · Usual products**.
- The full catalog moves to **Settings › Foods** (`/settings/foods`, a link from Help as well). It stays for the rare full cleanup, renamed so it is not confused with fridge items.
- `/household/items` redirects there. This reverses the layout move, which made `/settings/foods` a redirect to `/household/items` (`legacyHouseholdPath`): that legacy rule is removed in the same PR, and a test pins both directions so neither path loops.
- The scanned-products hint on Usual products and the link prompt point at the food page instead of Items.

## Surfaces

### Web

- "Did you mean" on the three add forms.
- The food page and its entry points.
- Household sub-nav without Items; Settings › Foods.
- Settings › Help: the "Food vs household item" entry gains one line on "Did you mean", and a new "Foods" entry explains that a food is edited from where it appears.

### MCP

The tool count stays at 69. `status: "similar_foods"` is an added outcome on six tools, and `new_food` an added optional input. `merge_foods` gains the field fill and allergen union. `src/mcp/tools-list.snapshot.json` does not change.

## Tests

Pure, with memory stores:

- `duplicatePairs`:
    - the flour pair is merged;
    - "egg" / "eggs" is not;
    - different kinds are not;
    - different brands are not;
    - conflicting calories are skipped with the reason;
    - one-sided fields are copied;
    - the allergen union;
    - the keep choice by reference count, then age.
- `mergeFoods` after the fix:
    - `ledgerMatchesStock` holds for the kept food when both had stock;
    - meal items move and keep their snapshot numbers;
    - the dropped name becomes an alias.
- `similarFoods`:
    - plurals;
    - "chicken egg" → Eggs;
    - a branded or barcoded name gets no duplicate suggestion;
    - a different kind is never suggested;
    - at most three;
    - an exact or alias match never reaches it.
- `findOrCreateManualFood` with `onSimilar: "ask"` throws with the candidates and writes nothing; with `"create"` it behaves as today.

Plus:

- route tests for each "Did you mean" form;
- the alias checkbox;
- `mcp.test.ts` for `status: "similar_foods"` and `new_food`;
- a contract test for the repoint of `stock_movements` and `meal_items`;
- `check:nav` for the moved catalog page.

## Pull requests

1. **Complete `mergeFoods`:** repoint `stock_movements` and `meal_items`, fill unknown fields, take the allergen union. This fixes merges that already happen from Items.
2. **The merge job:**
    - `duplicatePairs`;
    - `scripts/merge-duplicate-foods.ts`.
      The production dry run is reviewed before anyone runs `--apply`.
3. **"Did you mean" in the domain and MCP:**
    - `similarFoods`;
    - `SimilarFoodsError`;
    - the six tools;
    - `SERVER_INSTRUCTIONS`.
4. **"Did you mean" in the web app:** the three add forms and the alias checkbox.
5. **Food page and navigation:**
    - `/foods/:id` and its entry points;
    - Items moves to Settings › Foods;
    - the redirect;
    - the Help entries.

## Open questions

- **Recipe import while unattended:** an agent importing recipes on a schedule cannot ask. It should probably create the new foods and leave a "possible duplicates" note on the import, rather than block.
- **Plurals for foods counted by the piece:** "Egg" / "Eggs" is almost always one food, and "Green" / "Greens" is not. Should plurals of foods whose default unit is `each` merge automatically?
- **The full catalog page:** is Settings › Foods worth keeping at all once every food has its own page, or is the agent enough for a full cleanup?
