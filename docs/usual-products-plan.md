# Usual products: implementation plan

Status: proposed 2026-11-04. Comes before recipe import from links ([recipe-import-plan.md](./recipe-import-plan.md)), which leans on it for macros.

## Goal

A household buys the same product for most staples: Kirkland Large Eggs, Fairlife 2% milk. Today a recipe that says "eggs" points at a plain "Eggs" food with no nutrition, so its macros stay incomplete, and a scanned carton is a separate food that "already have" does not recognise as eggs.

After this:

- A plain food ("Eggs") can have products (Kirkland, Great Value, farmers' market eggs) and one **usual product**.
- Recipes, grocery lines and logged items keep pointing at the plain food. Their nutrition and unit factors read through to the usual product, so switching brands updates every recipe at once.
- Logged meals never change. A meal item is a snapshot taken when it was logged (`buildMealFromItems`), so it keeps the numbers of whatever was usual then.
- Any product of a food counts as that food for "already have", cooking and grocery aisles.
- A product does not need a barcode. A product with hand-entered nutrition is as good as one from Open Food Facts.

## The model

Everything stays in `foods`. A row is one of two things:

|           | Plain food                             | Product                                                     |
| --------- | -------------------------------------- | ----------------------------------------------------------- |
| Example   | Eggs                                   | Kirkland Large Eggs, Great Value Eggs, Farmers' market eggs |
| Means     | the ingredient                         | one thing you buy                                           |
| Points to | its usual product (`usual_product_id`) | the plain food it belongs to (`generic_food_id`)            |
| Barcode   | none                                   | optional                                                    |

A food with neither link is a standalone food and behaves exactly as today. Every existing row starts that way, so nothing needs a backfill.

### Rules

Enforced in the domain (`src/domain/foods.ts`), because a check constraint cannot see another row:

1. **One level deep.** A product cannot have products, and a plain food with products cannot itself belong to another food.
2. **Same household, same kind, neither archived.** Supplies work the same way ("Foil" with "Reynolds Wrap" as its usual).
3. **The usual is one of the food's own products.** Setting a usual links the product first if it is not linked yet.
4. **A product is usual for at most one food.** It follows from rule 3, since a product belongs to one food.
5. **Archiving a product clears it as a usual.** Unlinking a product that is the usual clears the usual too.

### Reading a food

Two pure functions:

- **`familyOf(food)`** returns `food.genericFoodId ?? food.id`. Two foods are "the same food" when their families match.
- **`effectiveFood(food, catalog)`** returns the food as readers should see it. For a plain food with a usual product:
    - **Nutrition** (the per-100 g block and `nutrition_source`) comes from the usual product when it has any nutrition, and otherwise from the plain food's own values. The block is taken whole, never mixed field by field, so one food's calories are never paired with another's protein.
    - **Unit factors** (`grams_per_each`, `grams_per_ml`) come from the usual product, falling back field by field to the plain food's. An egg weighs about the same whatever the brand.
    - **Allergens** are the union of both. A plain food is never reported as safer than what is actually bought.
    - **Name, brand, default unit and id** stay the plain food's. The result also carries `product: { id, name, brand } | null` so readers can show "Eggs · Kirkland Large Eggs".

    For a product or a standalone food, `effectiveFood` returns the row unchanged.

Null still means unknown. When neither the usual product nor the plain food has nutrition, the recipe is incomplete exactly as it is today, with the gap named.

## Schema

One additive migration (`db/migrations/<timestamp>_food_products.sql`, written with the `foodable-migration` skill):

```sql
alter table public.foods
    add column generic_food_id uuid references public.foods (id) on delete set null,
    add column usual_product_id uuid references public.foods (id) on delete set null;

alter table public.foods
    add constraint foods_generic_not_self check (generic_food_id is null or generic_food_id <> id),
    add constraint foods_usual_not_self check (usual_product_id is null or usual_product_id <> id);

create index foods_generic_idx
    on public.foods (household_id, generic_food_id)
    where generic_food_id is not null;
```

No backfill, no destructive statement, no new table (so no new RLS or grants). `db:dryrun` covers it, and `check.sql` gains an assertion that no row has both links set to rows that break rule 1. Foods are archived rather than deleted, so `on delete set null` only matters on a household delete.

## Code changes

### Domain (`src/domain/foods.ts`)

- `Food` gains `genericFoodId` and `usualProductId`; `foodFromRow` / `foodToRow` and the memory store map them. `src/db/foods.ts` selects and writes them; `src/db/contract/foods.contract.ts` covers the round trip.
- New: `familyOf`, `effectiveFood`, and `effectiveFoodsByIds(store, householdId, ids)`, which loads the requested foods plus their usual products and returns the effective view.
- New writes, each validating the rules above:
    - `linkProduct(store, householdId, productId, foodId | null)`
    - `setUsualProduct(store, householdId, foodId, productId | null)`
    - `createProduct(store, householdId, foodId, input)`, a product with hand-entered nutrition and no barcode.
- `mergeFoods`:
    - repoints `generic_food_id` and `usual_product_id` from the dropped food to the kept one;
    - rejects merging two members of the same family ("use Set usual instead");
    - re-checks rule 1 afterwards.
- `upsertFood` keeps editing the raw row. The Foods page, `get_food` and `upsert_food` show what is stored, not the read-through view.

### Readers switch to the effective view

Every place that reads nutrition or unit factors to compute something moves from `foodsByIds` to `effectiveFoodsByIds`:

- `src/domain/meals.ts`: meal item snapshots, recipe portions, caffeine.
- `src/domain/recipes.ts`: `macrosForPerson`, `ingredientGaps`, `importRecipeFromText`'s gap list.
- `src/mcp/shared.ts`, `src/mcp/tools/recipes.ts`, `src/mcp/tools/grocery.ts`.
- `src/web/loaders.ts`, `src/web/routes/recipes.ts`.

Each call site is checked by hand. A reader that shows or edits the food itself keeps the raw row.

### "Same food" becomes "same family"

- `src/domain/linking.ts` `sameFood`, which drives "already have" on grocery lines and recipes.
- `src/domain/grocery.ts` aisle lookup, so a Great Value carton files under the same aisle as Eggs.
- `src/domain/recipes.ts` "can make now" match (around line 1069).
- `src/domain/stock.ts`:
    - **Cook:** a decrement for a recipe's "Eggs" draws from every fridge item in the Eggs family, oldest expiry first as today.
    - **Converting units:** the amount is converted into each item's unit using that item's own food factors, falling back to the plain food's effective factors.
    - **Item-specific actions:** a decrement aimed at one `fridgeItemId` still touches only that item, and `ledgerMatchesStock` is unaffected because movements stay per item.

These maps need `genericFoodId` on the foods they hold, so `FoodQuantityFactors` gains it.

### Put-away records the product

Putting away a grocery line for "Eggs" asks which product was bought:

- **Default:** the usual product, otherwise the line's own food.
- **Where it's recorded:** the fridge item and its `stock_movements` row record the product, so the fridge says what is actually on the shelf.
- **Surfaces:** the web put-away form shows a product select when the food has products. `put_away_grocery_lines` takes an optional `product_food_id` per line.

### Name resolution

`resolveFoodForWrite` and `findOrCreateManualFood` stay as they are. A plain name ("eggs") resolves to the plain food, and a barcode resolves to the product, and both work because readers use the family and the effective view. So `log_meal` items, recipes, grocery lines and fridge items all pick up usual products without per-tool changes.

Looser name matching ("large eggs (beaten)" → Eggs) belongs to recipe import and is planned there.

## Surfaces

### Web

Lands after the layout change below.

- **Household › Items** (today's Foods page):
    - plain foods list their products nested underneath, with a "Usual" badge;
    - standalone products show a "Belongs to…" action;
    - the edit modal gains "Belongs to" for a product, and "Products" and "Usual product" for a plain food.
- **Household › Usual products.** One row per plain food that has products or is used by a recipe or grocery line: "Eggs → Kirkland Large Eggs · Change". It opens with **Needs a usual product**, the plain foods that recipes use but that have no nutrition and no usual. That list is the shortest path to complete macros. "Change" offers:
    - the food's existing products;
    - a name search through Open Food Facts (the existing `search_food` path);
    - a barcode lookup;
    - "Add product by hand".
- **After a barcode adds a new product** (food picker, fridge add, put-away):
    - a prompt asks "Is this one of your foods?", suggesting a plain food whose name appears in the product's (pure `suggestFoodFor(productName, foods)`, token match);
    - a "Make it our usual" checkbox sits under it;
    - Skip leaves it standalone.
- **Recipe page:** ingredients show "Eggs · Kirkland Large Eggs". An ingredient with no nutrition gets a "Pick usual product" link.
- **Grocery list:** a line shows its usual product under the name. A "Usual product" row action opens the same picker.
- **Settings › Help:** a "Usual products" glossary entry.

### MCP

The total goes from 67 to 69 tools. `src/mcp/tools-list.snapshot.json` and `TOOLS` are updated in the same PR.

- **New `link_product`:** `product_food_id`, plus `food_id` (null unlinks).
- **New `set_usual_product`:** `food_id`, plus `product_food_id` (null clears). It links the product if needed.
- **`get_food`:** returns `generic_food_id`, `usual_product_id`, the family's products, and the effective nutrition beside the stored values.
- **`search_food`:** marks catalog hits that are products and which food they belong to.
- **`upsert_food`:** takes an optional `generic_food_id` when creating, which is how an agent adds a product with no barcode.
- **`get_recipe` and `list_grocery_lines`:** ingredient and line rows carry `product: { food_id, name } | null`.
- **`put_away_grocery_lines`:** takes an optional `product_food_id` per line.
- **Wording changes:**
    - `log_meal`'s description says to pass items by plain name ("eggs") so they resolve through usual products;
    - `SERVER_INSTRUCTIONS` adds that the agent never picks a brand for the household: it asks, then calls `set_usual_product`.

## Layout change (ships first, its own PR)

Settings moves behind a gear in the top bar and the bottom tab becomes **Household** (Members, Items; Usual products is added in PR 5). The full plan, including routes, redirects, the back button, copy and tests, is [layout-plan.md](./layout-plan.md).

## Tests

Pure tests with the memory stores:

- `effectiveFood`:
    - the whole nutrition block is taken from the usual product;
    - unit factors fall back field by field;
    - allergens are a union;
    - a product or standalone food passes through unchanged.
- Link rules: one level deep, kind, archived, usual is own product, archive clears usual.
- `mergeFoods` with links on either side, and rejecting a merge within one family.
- **Switching the usual:**
    - recipe macros change;
    - an already-logged meal's snapshot does not.
- **Already have:** a Great Value carton covers a recipe's "Eggs" while Kirkland is the usual.
- **Cook:** decrements across the family, oldest expiry first, with each item's own unit factors. `ledgerMatchesStock` holds afterwards.
- **Put-away:** records the usual product by default and the chosen one when given.
- `suggestFoodFor` token matching.

Plus `foods.contract.ts` for the adapter, `mcp.test.ts` for the new tools and snapshot, and `db:dryrun` for the migration.

## Pull requests

1. **Layout:** Settings page behind the gear, Household tab and its sections, redirects.
2. **Schema and domain:**
    - the migration;
    - `Food` fields and row mappers;
    - `familyOf` / `effectiveFood` / `effectiveFoodsByIds`;
    - `linkProduct` / `setUsualProduct` / `createProduct`;
    - `mergeFoods`.
    - No reader changes yet, so no behaviour change.
3. **Readers:** the effective view at every call site, plus family matching in linking, grocery, recipes and stock. Behaviour only changes once a food has products, and none do until 4 or 5 ship.
4. **MCP:** the two new tools, the field additions, the description changes, the snapshot.
5. **Web:**
    - Items grouping;
    - the Usual products page and picker;
    - the post-scan prompt;
    - the recipe, grocery and put-away entry points;
    - the Help entry.

Then recipe import resumes from its own plan.

## Open questions

- **Grocery stores:** stay under Household › Members, or move to the Groceries tab.
- **Which product a meal used:** should `meal_items` record it (a nullable `product_food_id`), so history shows "2 eggs (Kirkland)"? The snapshot numbers are already right without it.
- **Per-member usual:** one person drinks oat milk, another 2%. This plan keeps one usual per household. A per-member override would be a later, separate table.
