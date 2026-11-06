# Restock: usual stores and expiring food on the grocery list

Status: proposed 2026-11-06. Builds on usual products ([usual-products-plan.md](./usual-products-plan.md)) and notices ([notices-plan.md](./notices-plan.md)).

## Goal

When milk is about to expire, the household usually wants more milk, from the store they buy it at. Today someone has to notice the date, open the grocery list, add milk and pick the store.

After this:

- **A usual product can have a usual store:** Kirkland Large Eggs from Costco, Fairlife milk from Safeway. A grocery line for the food goes to that store, in the aisle where the food already sits.
- **Opt-in restock:** a household can turn on "Add expiring food to the grocery list" and choose a day of the week. On that day, everything in the fridge that expires in the coming week is added to the grocery list at its usual store, unless it is already on the list.
- **Nothing is added without the switch.** It is off by default. Every line restock adds says why, and can be removed like any other.

## Part 1: usual stores

### Model

- `foods.usual_store_id uuid references public.grocery_stores (id) on delete set null`. It is one additive migration with no backfill, plus an index on `(household_id, usual_store_id) where usual_store_id is not null`.
- It is set on a **product** (Kirkland → Costco) or on a **standalone food** that has no products. A plain food with products reads its store through its usual product, the same way it reads nutrition.
- `effectiveFood` gains `usualStoreId`: the usual product's store, else the food's own, else null. It falls back field by field, like the unit factors.
- Rules, in the domain:
    - The store must belong to the same household.
    - Stores can't be removed today. If removing one is added later, `on delete set null` clears it on every food.

### Where a grocery line goes

`placeGroceryLine` and `suggestGrocerySection` today choose a section within a store the caller picked. A line added **without** a store now picks the store first:

1. the store the person or agent chose (unchanged; an explicit choice always wins);
2. the food's effective usual store;
3. the store this food (or its family) is already on the list at;
4. today's default store.

The aisle inside that store follows the existing rules (#158 family matching).

### Surfaces

- **Web:**
    - The usual-product picker gains a "Usually bought at" store select under the products.
    - The Items edit modal gains it for products and standalone foods.
    - Grocery lines show the store they were placed at, as today.
- **MCP:**
    - `set_usual_product` gains an optional `store_id`.
    - `upsert_food` gains `usual_store_id`.
    - `get_food` returns `usual_store_id` and its effective value.
    - `add_grocery_line` without a store uses the chain above, and says which store it picked.

## Part 2: opt-in restock

### Setting

Stored in the existing `households.household_preferences` JSON, beside `shoppingCadence`, so there's no migration for the setting itself:

```ts
restock: {
    enabled: boolean; // default false
    weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday; default 6 (Saturday)
    lastRunOn: string | null; // local date of the last run, written by the job
}
```

- **Web:** a new **Settings › Household** section, for owners and admins only (members see it read-only).
    - A switch, "Add expiring food to the grocery list".
    - A day select, "Check on".
    - One line explaining it: "Each week on this day, food in the fridge that expires within 7 days goes on the grocery list at its usual store."
- **MCP:** the existing `update_household_config` gains `restock_enabled` and `restock_weekday`. `get_household_config` returns them. The tool count doesn't change.

### The run

**Pure planner** (`src/domain/restock.ts`): `restockPlan({ items, foodsById, lines, dismissed, today })` returns the lines to add.

- **What is due:**
    - every fridge item whose `expiresOn` falls between `today` and `today + 6`, the same 7-day window `expiryLevel` calls `low`;
    - plus items that already expired and have no line yet;
    - minus items whose `fridge.expiring` notice the household dismissed. Dismissing means "I know; don't restock this one".
- **One line per food family:** items are grouped by `familyOf`, so two cartons of eggs, Kirkland and Great Value, make one Eggs line.
    - The line names the **plain food**, so the usual product's nutrition and store apply.
    - A standalone food names itself.
- **Already on the list:** a family that has an unchecked line anywhere on the list is skipped, so the run never doubles a line.
- **Amount:** the expiring amount, summed across the family in the first item's unit when the units convert (`convertStockAmount`), and otherwise the first item's amount. The open questions ask whether it should instead be one usual pack.
- **Placement:** the store chain above, then the aisle rules.

**Runner:** `startRestockRuns()` at boot, modelled on `startExportCleanup`. Once an hour, for each household with restock on:

- It works out the household's local date and weekday. A household has no timezone of its own, so it uses the owner's profile timezone, falling back to UTC.
- It runs when the weekday matches and `lastRunOn` is before today.
- It inserts the planned lines and writes `lastRunOn = today` **in one transaction**, so a restart, a second instance or a late hour never adds the same week twice.
- A failed run leaves `lastRunOn` alone and is retried next hour.

### Saying why

- Each restock line records its origin: `grocery_lines.source text not null default 'manual'` (`manual`, `recipe` or `restock`) and `source_fridge_item_id uuid references public.fridge_items (id) on delete set null`. It is additive, with no backfill: existing lines stay `manual`.
- A new notice, `grocery.restocked` (info, dismissible), is shown on the line: "Added because _Milk_ expires Thursday". It comes from the notices registry, so its badge and sentence are defined once.
- The agent sees `source` and the notice in `list_grocery_lines`. `SERVER_INSTRUCTIONS` gains one sentence: restock lines were added by the household's own setting, and can be removed if the item was used up or isn't wanted.

## Tests

Pure, with memory stores:

- **Effective usual store:**
    - the usual product's store wins;
    - a standalone food's own store is used;
    - the field falls back;
    - another household's store is rejected;
- **Placement:** an explicit store wins, then the usual store, then the family's existing store, then the default. The aisle follows inside the chosen store.
- **`restockPlan`:**
    - an item expiring in 3 days is added, and one in 8 days is not;
    - an already-expired item is added once;
    - a dismissed item is skipped;
    - two products of Eggs make one line naming Eggs;
    - an unchecked Eggs line already on the list skips the family;
    - amounts sum when units convert;
    - the line goes to Costco when Kirkland is usual at Costco.
- **The runner's decision:**
    - it runs only on the chosen weekday in the owner's timezone;
    - it never runs twice on the same local date;
    - `lastRunOn` and the lines are written together, and neither is written on failure.

Plus:

- route tests for the Settings › Household section (owner and admin can change it; a member can't);
- `mcp.test.ts` for `update_household_config` restock fields, `set_usual_product` `store_id`, and `add_grocery_line` placement;
- `db:dryrun` for `foods.usual_store_id` and the `grocery_lines` source columns.

## Pull requests

1. **Usual stores:**
    - the `foods.usual_store_id` migration and index;
    - effective store;
    - placement;
    - the picker and Items fields;
    - the MCP fields.
2. **Grocery line source:**
    - the `grocery_lines.source` / `source_fridge_item_id` migration;
    - recipe add-to-grocery records `recipe`;
    - `list_grocery_lines` returns `source`.
3. **Restock setting:** `household_preferences.restock`, Settings › Household, and `update_household_config`.
4. **Restock run:**
    - `restockPlan`;
    - the hourly runner;
    - the `grocery.restocked` notice, after the notices foundation ships.

## Open questions

- **How much to add:** the amount that is expiring (two cartons expiring means two), or one usual pack of the usual product? The second needs a "pack size" on the product.
- **Expired items:** should restock add food that has already expired, or only food still within its week? Adding it once seems right, because someone probably threw it out or is about to.
- **A household timezone:** the run uses the owner's profile timezone because households have none. Should the household get its own setting, used by restock, notices' "expires Thursday" and future notifications?
- **Time of day:** the run happens in the first hour after midnight on the chosen day. Should it be a chosen time instead, so the list is ready before a usual shopping trip?
