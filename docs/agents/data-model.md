# The household data model in detail

Read this before touching foods, fridge stock, meals with items, usuals, recipe step mentions or week plan repeats (`src/domain/foods.ts`, `stock.ts`, `meals.ts`, `food-quantity.ts`, `unit-conversion.ts`, `usual-add.ts`, `linking.ts`, and their db adapters). The invariants in brief are in `CLAUDE.md` ("Household data model"); week plan repeats are described only here.

## Foods

Every pillar points at one household `foods` row (`src/domain/foods.ts`). Fridge items, grocery lines and recipe ingredients carry `food_id`. Dislikes are free text: `member_dislikes.food_id` exists but nothing sets it. Barcodes and aliases hang off a food (`food_barcodes`, `food_aliases`). Manual names resolve through `normalizeFoodName`, so "Eggs", "eggs " and "EGGS" are one food, and `mergeFoods` repoints every reference when duplicates slip in. Supplies are foods with `kind = 'supply'`.

### Nutrition basis

`foods` holds nutrition **per 100 g** (per 100 ml when `nutrition_basis = '100ml'`), and null means unknown, never zero. `catalogNutritionFromOff` writes OFF's `per_100`. A per-100 ml food scales by ml (`nutritionScaleAmount`): g or each need its `grams_per_ml`, never a guessed density, and no unit means ml. `serving_*` is the pack serving; `perServingFromFood` needs matching units.

### Product quality

The same row also stores OFF product-quality columns: Nutri-Score, NOVA, Green-Score A+–F (`ecoscore_grade` as `a-plus`…`f`), additive/allergen/trace/analysis/label tags, and `off_quality_fetched_at`.

- Null means unknown; `[]` means OFF listed none.
- `offQuality` null means never looked up; an all-null quality with a `fetchedAt` means OFF had nothing for that barcode.
- Additive risk tiers are derived on read from generated `src/domain/additive-risk.ts` (`bun scripts/gen-additive-risk.ts`).
- Quality writes go through `setFoodQuality`, which updates only those columns.

## `food_id` is the identity

`food_id` is `not null` on fridge items, grocery lines and recipe ingredients since the Phase 8 contract (`20261031180000`). There is no identity JSON and no per-ingredient nutrition: "already have" matching (`sameFood` in `src/domain/linking.ts`) compares `food_id` alone, and recipe macros read the food row.

## Units

Quantities keep their own unit. `toGrams` (`src/domain/food-quantity.ts`) is the one conversion path: volume needs `grams_per_ml`, `each` needs `grams_per_each`, both from `resolveFactors` (`unit-conversion.ts`). A missing factor is null, never a guess: the recipe is "incomplete", with the factor named.

## Food-backed meals

`meal_items` rows are write-time snapshots (`buildMealFromItems` in `src/domain/meals.ts`). When a meal has items, the write path sets the `meals` totals to the null-aware sum of the snapshots, so every reader of `meals` is unchanged. Editing a food later never rewrites a logged meal, and Again, copy yesterday and an amount edit rescale a stored item when the food cannot scale its unit. Free-text meals with no items still work exactly as before.

## Stock ledger

`fridge_items` is current state. `stock_movements` is the audit trail, written by `applyMovement` in `src/domain/stock.ts` for put-away, cook, eat and discard. Manual `add_fridge_item` / `update_fridge_item` / `delete_fridge_item` and the web forms behind them write an `adjust` movement through the same function (`addFridgeItemAdjust`, `updateFridgeItemQuantityAdjust`, `deleteFridgeItemAdjust`), so `ledgerMatchesStock` holds for every item.

- Decrements go oldest expiry first and never below zero: a shortfall is reported, not clamped.
- A decrement aimed at one `fridgeItemId` only touches that item.
- A movement never records the id of an item it just deleted: `fridge_item_id` is a foreign key, so it would be rejected.

## Usuals

A plain food is a usual when it has live products or `usual_added_at` is set; `usualProductRows` is the one rule.

- The stamp marks a usual with no product to make it one. Type it sets it, and so does adding a scanned or searched row that is itself the plain food.
- Filing a product under a food does not stamp it: the product is what makes it a usual, so removing the last product takes it off the list.
- Filing a stamped food under another (`linkProduct`, or a merge that leaves it a product) clears its stamp.
- Otherwise only `removeUsual` (and the bulk remove) clears it.

Add a usual (`src/domain/usual-add.ts`) has three ways in:

- **Scan** files the product under a plain food as its usual product through the Settings › Items "Belongs to" link path. A branded product never merges into a plain food by name; an unbranded hit named like a plain food is that food.
- **Search** adds a food as it is.
- **Type it** needs calories, protein, carbs and fat per 100 g, per 100 ml or per a g-or-ml serving, and keeps a barcode that found nothing.

## Step mentions

Imported recipes only. `findMissingMentions` is pure: reviewed bundled words plus catalog names and aliases, with synonyms, kinds and parts covered, water and ice never flagged, and a miss preferred to a false alarm.

- Warnings are computed on read, never a `RecipeProblem`, so they never block verification, cooking, planning or groceries.
- Dismissals live in `recipe_imports.dismissed_mentions`, appended in place (`addDismissedMention`), so re-checks and import-row rewrites keep them.
- Add uses the step's amount, else one pack serving, else 1 each, with the step's descriptive words as the note.
- MCP returns `mention_warnings` (there is no dismiss tool).

## Week plan repeats

A repeating plan is one `plan_rules` row (`src/domain/plan.ts`, `src/db/plans.ts`): a recipe, meal and servings from `starts_on`, as once, every week, every day, weekdays or picked days (`days`, 0 = Sunday). One-off plans stay `recipe_plans` rows.

- `PlansStore.listPlans` expands the repeats into dated entries with ids `rule:<rule id>:<yyyy-mm-dd>`, so every plan reader (the week view, Today, groceries' missing-for-plan, the plan notices) sees them. Nothing else reads the two tables.
- Days are whole calendar days, so a daylight saving change cannot drop or double one.
- One entry per recipe, day and meal, never merged. Planning a recipe on a day and meal it already holds (a one-off or a day of a repeat) is already planned: nothing is written, whatever the servings, and the person changes the servings on the entry that is there. A different recipe, or the same recipe at another meal, is a plan of its own. A move onto a slot that already holds the same recipe and meal is the same answer (`PlanMove.alreadyPlanned`) and changes nothing.
- A repeat that would show on a day another repeat of the same recipe and meal shows on is refused (`PlanRepeatOverlapError`, which names the weekdays and how the other repeat repeats); asking again for a repeat that already runs is already planned. A repeat created over one-offs skips those days and leaves the one-offs and their servings alone. Nothing sums servings, on write or on read: `planEntries` is the one-offs and the expanded days in day, meal and planning order, so a plan entry names at most one repeat (stored data that somehow held a day twice would list both).
- Removing one day adds it to `skipped_on`, in that repeat only. Removing the whole series sets `ends_on` to the day before. Moving a day onto a free slot, or changing its servings, skips it and writes a one-off, in one transaction; saving a day with nothing changed writes nothing.
- Every write runs under the household plan lock. `plan_rules` is in `AGENT_TABLES`, so an agent's series removal is undoable.
