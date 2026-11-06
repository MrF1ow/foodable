# Duplicate foods: implementation plan

Status: proposed 2026-11-06. Follows usual products ([usual-products-plan.md](./usual-products-plan.md)) and the word search in #164. Possible duplicates are shown through the shared notices model ([notices-plan.md](./notices-plan.md)), which is built first.

## Goal

Every fridge item, grocery line, recipe ingredient and meal item points at one household `foods` row. When the same thing arrives under two names, the household ends up with two rows. Production has "All purpose flour" next to "all-purpose flour", a "Chicken egg" row among its other eggs, and scanned cartons such as "Cage Free Grade A Large Eggs" sitting beside the plain food they belong to. Each duplicate splits stock, "already have", aisles and nutrition between two rows.

Today the only fix is Household › Items › Merge foods. That asks a person to find duplicates in a catalog they never chose to keep, and Items is a page most households should never need.

After this:

- **Certain duplicates are merged by the backend.** Two rows that differ only by punctuation or case are one food, and a reviewed one-off job merges the ones that already exist. #164 already stops new ones.
- **Likely duplicates are caught when they are created.** A new name that is probably an existing food ("chicken egg" for Eggs, "scallion" for Scallions) gets a "Did you mean Eggs?" question at that moment, in the app and through the agent.
- **Anything that slips through waits in one place.** When no one is there to answer, such as an agent importing recipes on a schedule, the food is created and the pair shows up under **Possible duplicates**, with a count badge, for the household to Merge or Keep separate.
- **Nothing uncertain is merged without a person.** Synonyms are suggested, never applied. Plurals are treated as one food only in households that switch it on.
- **The catalog page is decided last.** Whether Items stays, moves or goes is evaluated once the foods and merging are in good shape (see "Later").

## Why duplicates happen

| Cause                     | Example                                                             | Handled by                                                                                  |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Punctuation or case       | "All purpose flour" / "all-purpose flour"                           | #164 stops new ones; the merge job below fixes old ones                                     |
| Plural                    | "Egg" / "Eggs"                                                      | "Did you mean" at entry, or automatic in households that opt in                             |
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

### Plurals are opt-in

"Egg" and "Eggs" are usually one food, but the difference people hear is often about amount ("an egg" is one, "eggs" is several), and amounts belong to the quantity, not the name. Elsewhere a plural is a different food ("Green" / "Greens", "Date" / "Dates"). So plurals are a household choice:

- **Off (the default):** singular and plural stay distinct names. A new plural of an existing food is only suggested, by "Did you mean" and Possible duplicates.
- **On:** a household setting, "Treat singular and plural as the same food", on Household › Members beside the household name (owners and admins). Name resolution then compares names with each word singularised (`looseFoodKey` plus `singularizeNameToken`, a sibling `pluralFreeFoodKey`), so "egg" finds Eggs without asking. The merge job also includes plural pairs, under the same agree-or-skip rules.
- Stored as one boolean column on `households` (`plurals_same_food boolean not null default false`), so an additive migration with no backfill.

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
- **When no one can answer:** each of those tools also takes `on_similar: "ask" | "create"` (default `"ask"`). A scheduled or unattended agent passes `"create"`. The foods are created, and the pairs appear under Possible duplicates rather than blocking the run. The scheduled-import prompt planned in [recipe-import-plan.md](./recipe-import-plan.md) passes it.

### 4. Possible duplicates

One place for every likely duplicate the household has not decided on, whatever created it. Each pair is a `food.possible_duplicate` notice ([notices-plan.md](./notices-plan.md)), so its badge, sentence, action and MCP shape come from the shared registry and renderers rather than markup of its own.

- **What is listed:** `possibleDuplicates(foods, aliases, dismissed)` (pure) pairs every two live, same-kind plain foods that `similarFoods` rules 1 and 2 would suggest for each other: same words up to plurals, or one name containing every word of the other. Rule 3, the broad word match, is left out because it is too noisy for a list. Pairs the merge job would merge on its own never wait here; they are merged. Products and scanned cartons are not listed: they are filed with Belongs to…, as in usual products.
- **Computed, not stored:** the list is worked out from the catalog each time, so it can't go stale. Only the household's "Keep separate" answers are stored, as dismissals of the `food.possible_duplicate` notice in the shared `notice_dismissals` table ([notices-plan.md](./notices-plan.md)), with the other food as the related half of the pair. A pair is never listed again once dismissed, and comes back only if one of the foods is merged into something else.
- **Where:**
    - **Household › Possible duplicates,** a sub-nav entry that appears only when the list is not empty, with the count as a badge.
    - **The household's Needs attention count and a dot on the Household tab** while there are any (both from [notices-plan.md](./notices-plan.md)).
    - **Where the food appears:** a recipe ingredient or grocery line for one of the foods shows a small "Possible duplicate of _Eggs_" link to the pair.
- **Each row:** "chicken egg · Eggs", with **Merge…** and **Keep separate**.
    - Merge opens a confirm dialog showing which name is kept (the merge job's keep rule decides the default) and any field the two disagree on, such as calories. The person picks the value to keep, and the dialog runs `mergeFoods`.
    - Keep separate stores the dismissal.
- **MCP:** no tools of its own. The shared `list_notices { code: "food.possible_duplicate" }` lists the pairs, `dismiss_notice` keeps a pair separate, and `merge_foods` merges one. `SERVER_INSTRUCTIONS`: after an unattended run, mention any new possible duplicates, and never merge or dismiss one without asking.

## Later: the catalog page

Evaluated last, once the steps above are in production. The candidates, kept here so the work is not lost:

- **A food page,** `/foods/:id`, reached from a recipe ingredient, a grocery line, a fridge row and the usual-product picker. It would hold what the Items edit modal holds today, plus "Merge into another food…".
- **Items leaves the main navigation,** perhaps for Settings › Foods. That move would reverse the layout move's `/settings/foods` → `/household/items` redirect (`legacyHouseholdPath`), which needs removing in the same PR, with a test that neither path loops.
- **Or Items goes entirely,** if the food page, Possible duplicates and the agent cover everything.

Until then, Household › Items stays as it is.

## Surfaces

### Web

- "Did you mean" on the three add forms.
- Household › Possible duplicates (shown only when there are any), counted in Needs attention and the Household tab dot, and the "Possible duplicate of…" links on recipe ingredients and grocery lines.
- Household › Members: "Treat singular and plural as the same food" (off by default, owners and admins).
- Settings › Help: the "Food vs household item" entry gains one line on "Did you mean", and a new "Possible duplicates" entry explains Merge and Keep separate.

### MCP

The tool count does not change in this plan: Possible duplicates uses the shared `list_notices` and `dismiss_notice` from [notices-plan.md](./notices-plan.md). `status: "similar_foods"` is an added outcome on six tools, and `new_food` and `on_similar` are added optional inputs. `merge_foods` gains the field fill and allergen union.

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
- `possibleDuplicates`:
    - lists "chicken egg" / Eggs and "egg" / "eggs";
    - leaves out dismissed pairs, products, different kinds, and pairs the merge job would merge itself;
    - lists a pair again after one food is merged into a third.
- Plurals setting: off, "egg" does not resolve to Eggs; on, it does, and `duplicatePairs` includes plural pairs under the same rules.

Plus:

- route tests for each "Did you mean" form;
- the alias checkbox;
- `mcp.test.ts` for `status: "similar_foods"` and `new_food`;
- a contract test for the repoint of `stock_movements` and `meal_items`;
- route tests for Merge (including a field conflict) and Keep separate;
- `mcp.test.ts` for `list_notices` filtered to `food.possible_duplicate` and `dismiss_notice` on a pair;
- `db:dryrun` for the `households.plurals_same_food` column.

## Pull requests

1. **Complete `mergeFoods`:** repoint `stock_movements` and `meal_items`, fill unknown fields, take the allergen union. This fixes merges that already happen from Items.
2. **The merge job:**
    - `duplicatePairs`;
    - `scripts/merge-duplicate-foods.ts`.
      The production dry run is reviewed before anyone runs `--apply`.
3. **Notices foundation:** PRs 1–4 of [notices-plan.md](./notices-plan.md).
4. **Possible duplicates:**
    - `possibleDuplicates`;
    - the Household section, tab dot and "Possible duplicate of…" links;
    - Merge… and Keep separate;
    - the `food.possible_duplicate` registry entry (badge, sentence, "Keep separate").
5. **"Did you mean" in the domain and MCP:**
    - `similarFoods`;
    - `SimilarFoodsError`;
    - `on_similar` and `new_food` on the six tools;
    - `SERVER_INSTRUCTIONS`.
6. **"Did you mean" in the web app:** the three add forms and the alias checkbox.
7. **Plurals opt-in:** the `households.plurals_same_food` migration, the setting, name resolution, and plural pairs in the merge job.

Possible duplicates comes before "Did you mean" on purpose: it catches every duplicate, whatever created it, so it is useful the day it ships, and "Did you mean" then shrinks what reaches it.

Then the catalog page is evaluated (see "Later").

## Open questions

- **Keep separate, forever?** A dismissed pair never comes back unless a food is merged. Should a dismissal expire, or be undoable from the food? Undo lives in "Show dismissed" ([notices-plan.md](./notices-plan.md)).
