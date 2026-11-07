# Restock: usual stores, usual amounts, and expiring food on the grocery list

Status: proposed 2026-11-06. Builds on usual products ([usual-products-plan.md](./usual-products-plan.md)) and notices ([notices-plan.md](./notices-plan.md)).

## Goal

When milk is about to expire, the household usually wants more milk: the amount they normally buy, from the store they buy it at. Today someone has to notice the date, open the grocery list, add milk, type the amount and pick the store.

After this:

- **A usual product knows where and how much:** Kirkland Large Eggs, 24 each, from Costco. A grocery line for the food goes to that store, in the aisle where the food already sits, for that amount.
- **Opt-in restock:** a household can turn on "Add expiring food to the grocery list" and choose a day and a time. Then, each week, everything in the fridge that will expire within the coming week is added to the grocery list at its usual amount and usual store, unless it is already on the list.
- **Expired food asks, it doesn't add:** an item that has already expired is never added automatically. If it isn't on the list, its notice offers **Add to grocery list**; if it is, the notice says so.
- **Nothing is added without the switch.** Restock is off by default. Every line it adds says why, and can be removed like any other.

## Part 1: usual store and usual amount

### Model

One additive migration on `foods`, with no backfill:

- `usual_store_id uuid references public.grocery_stores (id) on delete set null`, plus an index on `(household_id, usual_store_id) where usual_store_id is not null`.
- `usual_amount numeric` and `usual_unit text`, with checks that both are null or both set, and that `usual_amount > 0`. The unit must be a known quantity unit (`isQuantityUnit`), checked in the domain.

Rules:

- Both are set on a **product** (Kirkland → 24 each at Costco) or on a **standalone food** that has no products. A plain food with products reads them through its usual product, the same way it reads nutrition.
- `effectiveFood` gains `usualStoreId` and `usualAmount: { amount, unit } | null`.
    - The store falls back field by field: the usual product's store, else the food's own.
    - The amount is read **as a pair**, never one field from each row: the usual product's amount and unit, else the food's own pair. That way 24 is never paired with the wrong unit.
- The store must belong to the same household. Stores can't be removed today; if removing one is added later, `on delete set null` clears it on every food.

### Where a grocery line goes, and how much

`placeGroceryLine` and `suggestGrocerySection` today choose a section within a store the caller picked. A line added **without** a store now picks the store first:

1. the store the person or agent chose (unchanged; an explicit choice always wins);
2. the food's effective usual store;
3. the store this food (or its family) is already on the list at;
4. today's default store.

The aisle inside that store follows the existing rules (#158 family matching).

A line added **without** an amount, by restock, by the "Add to grocery list" action, or by an agent that names only the food, uses the effective usual amount. If there is none, it falls back to the item's own amount, then to 1 of the food's default unit. An explicit amount always wins.

### Surfaces

- **Web:**
    - The usual-product picker gains "Usually buy", an amount and unit, and "at", a store select, under the products.
    - The Items edit modal gains both, for products and standalone foods.
    - Grocery lines show the store they were placed at, as today.
- **MCP:**
    - `set_usual_product` gains optional `store_id`, `amount` and `unit`.
    - `upsert_food` gains `usual_store_id`, `usual_amount` and `usual_unit`.
    - `get_food` returns them, stored and effective.
    - `add_grocery_line` without a store or amount uses the rules above, and says which store and amount it picked.

## Part 2: opt-in restock

### Setting

Stored in the existing `households.household_preferences` JSON, beside `shoppingCadence`, so there's no migration for the setting itself:

```ts
restock: {
    enabled: boolean; // default false
    weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday; default 6 (Saturday)
    time: string; // "HH:MM", local; default "07:00"
    lastRunOn: string | null; // local date of the last run, written by the job
}
```

- **Web:** a new **Settings › Household** section, for owners and admins only (members see it read-only).
    - A switch, "Add expiring food to the grocery list".
    - "Check on", a day select, and "at", a time.
    - One line explaining it: "Each week at this time, food in the fridge that expires within 7 days goes on the grocery list at its usual amount and store."
- **MCP:** the existing `update_household_config` gains `restock_enabled`, `restock_weekday` and `restock_time`, and `get_household_config` returns them. The tool count doesn't change.

### The run

**Pure planner** (`src/domain/restock.ts`): `restockPlan({ items, foodsById, lines, dismissed, today })` returns the lines to add.

- **What is due:**
    - every fridge item whose `expiresOn` falls between `today` and `today + 6`, the same 7-day window `expiryLevel` calls `low`;
    - **not** items that have already expired. Those go through their notice instead (below);
    - minus items whose `fridge.expiring` notice the household dismissed. Dismissing means "I know; don't restock this one".
- **One line per food family:** items are grouped by `familyOf`, so two cartons of eggs, Kirkland and Great Value, make one Eggs line.
    - The line names the **plain food**, so the usual product's nutrition, store and amount apply.
    - A standalone food names itself.
- **Already on the list:** a family that has an unchecked line anywhere on the list is skipped, so the run never doubles a line.
- **Fresh stock:** if the family still has any fridge item that is not expiring within the 7-day window (its `expiresOn` is after `today + 6`, or it has no `expiresOn`), the family is skipped. Already-expired stock in the family does not count as fresh. The person can still tap **Add to grocery list** on the expiring item's notice.
- **Amount:** the family's effective usual amount, once per family. If there is no usual amount, the expiring amount summed across the family when the units convert (`convertStockAmount`), otherwise the first item's.
- **Placement:** the store chain above, then the aisle rules.

**Runner:** `startRestockRuns()` at boot, modelled on `startExportCleanup`. Every 15 minutes, for each household with restock on:

- It works out the household's local date, weekday and time via `householdTimezone` (the household's own setting, else the owner's, else UTC; #189).
- It runs when the weekday matches, the local time has reached the chosen time, and `lastRunOn` is before today. A server that was down at 07:00 catches up on its first check after.
- It inserts the planned lines and writes `lastRunOn = today` **in one transaction**, so a restart, a second instance or a slow check never adds the same week twice.
- A failed run leaves `lastRunOn` alone and is retried on the next check.

### Expired food: a notice with an action

Already-expired items are never added by the run. They go through the notices model instead, and so do expiring items in households that haven't switched restock on:

- `fridge.expired` (warn) and `fridge.expiring` (info) gain an action when the item's family has **no** unchecked grocery line: **Add to grocery list**. One tap adds a line at the usual amount and store, through the same placement as restock.
- When the family **is** already on the list, the notice says so ("Milk expired · on the grocery list") and has no action, so nobody adds it twice.
- The action works whether restock is on or not. It is the manual path, and the same thing the run does.
- The agent sees the same notices and adds lines with `add_grocery_line`, with no amount, so the usual amount applies.

### Saying why

- Each line records its origin:
    - `grocery_lines.source text not null default 'manual'`, one of `manual`, `recipe`, `restock` or `notice` (the Add to grocery list action);
    - `source_fridge_item_id uuid references public.fridge_items (id) on delete set null`.
    - It is additive, with no backfill: existing lines stay `manual`.
- A new notice, `grocery.restocked` (info, dismissible), is shown on a restock line: "Added because _Milk_ expires Thursday". It comes from the notices registry, so its badge and sentence are defined once.
- The agent sees `source` and the notice in `list_grocery_lines`. `SERVER_INSTRUCTIONS` gains one sentence: restock lines were added by the household's own setting, and can be removed if the item was used up or isn't wanted.

## Tests

Pure, with memory stores:

- **Effective usual store and amount:**
    - the usual product's store and amount win, and a standalone food's own are used;
    - the store falls back field by field, and the amount only as a pair;
    - an amount without a unit, or a non-positive amount, is rejected;
    - another household's store is rejected.
- **Placement:**
    - an explicit store wins, then the usual store, then the family's existing store, then the default, with the aisle following inside the chosen store;
    - an explicit amount wins, then the usual amount, then the item's amount, then 1.
- **`restockPlan`:**
    - an item expiring in 3 days is added, and one in 8 days is not;
    - an already-expired item is **not** added;
    - a dismissed item is skipped;
    - two products of Eggs make one line naming Eggs, at the usual amount;
    - an unchecked Eggs line already on the list skips the family;
    - with no usual amount, amounts sum when units convert;
    - the line goes to Costco when Kirkland is usual at Costco.
- **Notices:**
    - `fridge.expired` offers Add to grocery list when the family isn't on the list, and says "on the grocery list" with no action when it is;
    - the action adds one line at the usual amount and store, and a second tap doesn't add another.
- **The runner's decision:**
    - it runs only on the chosen weekday, at or after the chosen time, in the owner's timezone;
    - it catches up after downtime the same day;
    - it never runs twice on one local date;
    - `lastRunOn` and the lines are written together, and neither is written on failure.

Plus:

- route tests for the Settings › Household section (owner and admin can change it; a member can't) and for the Add to grocery list action;
- `mcp.test.ts` for the restock fields on `update_household_config`, `store_id` / `amount` / `unit` on `set_usual_product`, and `add_grocery_line` placement and amount;
- `db:dryrun` for the `foods` columns and checks, and the `grocery_lines` source columns.

## Pull requests

1. **Usual store and amount:**
    - the `foods` migration (`usual_store_id`, `usual_amount`, `usual_unit`, checks, index);
    - the effective store and amount;
    - placement and the default amount;
    - the picker and Items fields;
    - the MCP fields.
2. **Grocery line source:**
    - the `grocery_lines.source` / `source_fridge_item_id` migration;
    - recipe add-to-grocery records `recipe`;
    - `list_grocery_lines` returns `source`.
3. **Expired and expiring notices get "Add to grocery list"** (after the notices foundation ships).
4. **Restock setting:** `household_preferences.restock` (day and time), Settings › Household, and `update_household_config`.
5. **Restock run:**
    - `restockPlan`;
    - the 15-minute runner;
    - the `grocery.restocked` notice.

## Settled

- **Household timezone:** restock and notice wording use `household_preferences.timezone`, falling back to the owner's profile timezone, then UTC (#189).
- **Fresh stock:** if the food family has any fresh stock (a fridge item not expiring within the 7-day window, or undated), restock skips the family. Adding more is left to the person via **Add to grocery list** on the expiring item's notice.
