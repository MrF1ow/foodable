// The id rule for every MCP tool, against real Postgres through the real /mcp
// handler. A host that shows a widget hands the model only a tool's text
// `content`, never its `structuredContent`, so an id that is only in the
// structured half is one an agent can see but cannot act on. This test seeds a
// household through the tools themselves, calls every read tool and every
// write tool that returns a new id, and asserts that every uuid in the
// structured result also appears in the text, except the household's id, ids
// the call itself passed in (the caller already holds them) and the few nested
// references listed in NESTED. A second household member is seeded so member
// ids are checked too. Every row must check at least one id, or say why not
// with `noIds`. A row key may carry a `#why` suffix to exercise a second path
// of the same tool. A tool in `tools-list.snapshot.json` with no row in CALLS and
// no entry in EXCLUDED fails the coverage test by name, so a new tool is
// covered the day it is added. A tag's label must be the name of an input
// property of some tool in tools/list (all flags on), so a made-up label fails;
// whether a label names the input that really takes that id is checked against
// real input names only, and whether it points at the right path is reviewed by
// hand.
import {
    Client,
    StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { liveSettingsStore } from "../../db/settings.js";
import { setSqlForTests } from "../../db/sql.js";
import { asUser, seedHousehold } from "../../db/testing/fixtures.js";
import { describeDb } from "../../db/testing/pg.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import {
    allFlagsOn,
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import { putCachedFood, type FoodResult } from "../../foods.js";
import { handleMcp } from "../server.js";
import { stripIdTags } from "../shared.js";

const pgAvailable = await findPgBin();
if (!pgAvailable) {
    if (process.env.CI) {
        throw new Error(
            "database tests skipped: no initdb (install postgresql and set PG_BIN)",
        );
    }
    console.warn("database tests skipped: no initdb (set PG_BIN)");
}

type Era = "legacy" | { pin: "2026-07-28" };
const ERAS: { label: string; era: Era }[] = [
    { label: "2025-11-25 (legacy)", era: "legacy" },
    { label: "2026-07-28", era: { pin: "2026-07-28" } },
];

type Result = {
    isError?: boolean;
    structuredContent?: Record<string, any>;
    content: { type: string; text: string }[];
};

const UUID_RE =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** What the seeding made: the ids the call table builds its arguments from. */
type Seed = {
    owner: string;
    /** A second household member, so member ids are not just the caller's. */
    member: string;
    householdId: string;
    storeId: string;
    sectionName: string;
    locationId: string;
    eggs: string;
    kirkland: string;
    milk: string;
    flour: string;
    fridgeItem: string;
    spareItem: string;
    lineA: string;
    lineB: string;
    recipe: string;
    ingredient: string;
    planId: string;
    meal: string;
    water: string;
    weight: string;
    /** A food saved with a barcode, for the paused-lookup path. */
    barcoded: string;
    barcode: string;
    /** An allergenic food (peanut) the second member cannot eat. */
    peanutOil: string;
};

/** Runs one seeding tool call as the caller; a row may use it to make what it acts on. */
type Make = (
    name: string,
    args?: Record<string, unknown>,
) => Promise<Record<string, any>>;
type CallRow = (
    s: Seed,
    make: Make,
) => Record<string, unknown> | Promise<Record<string, unknown>>;
/** A table whose new rows a text-only tool returns ids for. */
type RowTable = "meals" | "water_log" | "weight_log";
/**
 * One row of the call table: the arguments, plus what the row checks beyond the
 * ids in structuredContent. `textIds` are seeded ids the text must carry (for
 * tools with no structuredContent); `newRow` is a table whose new row's id the
 * text must carry; `noIds` says why a row checks no id at all.
 */
type CallSpec = {
    args: CallRow;
    /** Flag values for this call only, over the defaults; reset after it. */
    flags?: Record<string, boolean>;
    textIds?: (s: Seed) => string[];
    newRow?: RowTable;
    noIds?: string;
};
const noIds = (reason: string, args: CallRow): CallSpec => ({
    args,
    noIds: reason,
});
const withText = (args: CallRow, textIds: (s: Seed) => string[]): CallSpec => ({
    args,
    textIds,
});
const withNewRow = (args: CallRow, newRow: RowTable): CallSpec => ({
    args,
    newRow,
});

/** A servable Open Food Facts cache row, so a lookup needs no network. */
function cachedOff(barcode: string): FoodResult {
    const per100 = {
        calories: 50,
        protein_g: 1,
        carbs_g: 10,
        fat_g: 1,
        fiber_g: null,
        sugar_g: 5,
        saturated_fat_g: null,
        alcohol_g: null,
    };
    return {
        name: "Cached Soda",
        brand: "Fizz",
        serving: "100 g",
        ...per100,
        per_100: per100,
        nutrition_basis: "100g",
        nutrient_levels: null,
        nutriscore_grade: null,
        nova_group: null,
        quality: {
            nutriscore_grade: null,
            nova_group: null,
            ecoscore_grade: null,
            additives_tags: null,
            allergens_tags: null,
            traces_tags: null,
            ingredients_analysis_tags: null,
            labels_tags: null,
            fetched_at: new Date().toISOString(),
        },
        source: `off:${barcode}`,
        source_name: "openfoodfacts",
        barcode,
    };
}

/** Saves a household food under the barcode and caches an OFF row for it. */
const cachedFoods: Record<string, string> = {};
async function cachedBarcodeFood(make: Make, barcode: string) {
    const food = await make("upsert_food", {
        name: `Cached ${barcode}`,
        barcode,
        on_similar: "create",
    });
    cachedFoods[barcode] = food.id as string;
    await putCachedFood("openfoodfacts", barcode, cachedOff(barcode));
    return { barcode };
}

/** Eggs in stock, milk only in the steps. */
const scrambleArgs = (s: Seed) => ({
    text: "Scramble",
    name: "Scramble",
    yield_portions: 2,
    ingredients: [{ name: "Eggs", amount: 2, unit: "each", food_id: s.eggs }],
    instructions: "1. Whisk the eggs with milk.\n2. Fry until set.",
});

const URL_IMPORT_TEXT =
    "Pancakes\n\nIngredients\n2 cups flour\n1 egg\nbutter\nsome mystery batter\n\nMethod\nMix and fry.";

// Every tool that is read-only, plus every write that returns a new id, in the
// order they run: reads first, then the writes that add rows without removing
// the ones the reads need.
const CALLS: Record<string, CallRow | CallSpec> = {
    // ---- reads ----
    get_fridge: () => ({}),
    list_expiring: () => ({ days: 30 }),
    list_grocery_lines: () => ({}),
    list_usuals: () => ({}),
    list_stores: () => ({}),
    list_recipes: () => ({}),
    get_recipe: (s) => ({ id: s.recipe }),
    // A verified recipe whose eggs the fridge covers (cook_preview names the
    // fridge item a cook would take from) and whose steps name milk, which the
    // ingredients lack (mention_warnings).
    "get_recipe#cook-preview": async (s, make) => {
        const made = await make("import_recipe_from_text", scrambleArgs(s));
        return { id: (made.recipe as { id: string }).id };
    },
    // The caller's own version drops the seeded ingredient: the removed
    // ingredient's id is in `variant`, so the text must carry it.
    "get_recipe#own-version": async (s, make) => {
        await make("set_recipe_variant", {
            recipe_id: s.recipe,
            member_id: s.owner,
            action: "remove",
            ingredient_id: s.ingredient,
        });
        return { id: s.recipe };
    },
    get_week_plan: () => ({}),
    get_household_rules: () => ({}),
    search_food: () => ({ query: "eggs" }),
    // Only the product matches, so the plain food is in the text only as the
    // product's generic_food_id.
    "search_food#product": () => ({ query: "Kirkland" }),
    get_food: (s) => ({ food_id: s.eggs }),
    list_notices: () => ({}),
    list_members: () => ({}),
    get_household_config: noIds(
        "returns the household's own settings, no row ids",
        () => ({}),
    ),
    get_household_digest: () => ({}),
    get_meals: withText(
        () => ({}),
        (s) => [s.meal],
    ),
    search_meals: withText(
        () => ({ queries: ["lunch"] }),
        (s) => [s.meal],
    ),
    get_nutrition_summary: noIds("returns figures, no row ids", () => {
        const today = new Date().toISOString().slice(0, 10);
        return { start_date: today, end_date: today };
    }),
    get_goal_progress: noIds("returns figures, no row ids", () => ({})),
    get_water: withText(
        () => ({}),
        (s) => [s.water],
    ),
    get_weight: withText(
        () => ({}),
        (s) => [s.weight],
    ),
    get_weight_trends: noIds("returns figures, no row ids", () => ({})),
    get_trends: noIds("returns figures, no row ids", () => ({})),
    get_meal_patterns: noIds("returns figures, no row ids", () => ({})),
    get_profile: noIds(
        "returns the caller's own settings, no row ids",
        () => ({}),
    ),
    get_current_time: noIds("returns the time, no row ids", () => ({})),
    lookup_barcode: noIds(
        "the seeded barcode is not in the catalog, so nothing carries an id",
        () => ({ barcode: "5000000000000" }),
    ),
    rate_product: (s) => ({ food_id: s.eggs }),
    // Looked up by barcode, the product's own food_id is not in the arguments.
    "rate_product#barcode": async (_s, make) => {
        await make("upsert_food", {
            name: "Stabilo Oats",
            barcode: "4006381333931",
            on_similar: "create",
        });
        return { barcode: "4006381333931" };
    },
    // Online lookups paused, so the saved household food answers: the text is
    // all there is, and it must carry the food's id.
    "lookup_barcode#household": {
        args: (s) => ({ barcode: s.barcode }),
        flags: { "off-lookups": false },
        textIds: (s) => [s.barcoded],
    },
    // The product is in the lookup cache, so something other than the household
    // catalog answers the nutrition: the household food's id is still owed.
    "lookup_barcode#cached-paused": {
        args: (_s, make) => cachedBarcodeFood(make, "5449000000101"),
        flags: { "off-lookups": false },
        textIds: () => [cachedFoods["5449000000101"]!],
    },
    "lookup_barcode#cached-online": {
        args: (_s, make) => cachedBarcodeFood(make, "5449000000202"),
        flags: { "off-lookups": true },
        textIds: () => [cachedFoods["5449000000202"]!],
    },
    start_meal_import: noIds(
        "returns only the caller's own id and timezone",
        () => ({}),
    ),
    // ---- writes that return a new id ----
    snooze_notice: noIds(
        "returns the time it snoozed to, no row ids",
        async (_s, make) => {
            const listed = await make("list_notices");
            const row = (listed.notifications as any[]).find(
                (n) => n.kind !== "allergens",
            );
            return { notification_id: row.id, until: "week" };
        },
    ),
    // A notification's id and its subject's are both in the list's text, each
    // under the input that takes it.
    dismiss_notice: noIds(
        "echoes only ids the caller passed in",
        async (_s, make) => {
            // The snooze row's notification is hidden, not gone.
            const listed = await make("list_notices", {
                include_snoozed: true,
            });
            // An Allergens row cannot be dismissed: take another.
            const row = (listed.notifications as any[]).find(
                (n) => n.kind !== "allergens",
            );
            return { notification_id: row.id };
        },
    ),
    // The data-quality form dismisses with the fields the item lists.
    "dismiss_notice#data-quality": noIds(
        "echoes only ids the caller passed in",
        async (_s, make) => {
            await make("upsert_food", { name: "rolled oat" });
            const oats = (await make("upsert_food", {
                name: "rolled oats",
                on_similar: "create",
            })) as { id: string };
            const food = await make("get_food", { food_id: oats.id });
            const dupe = (food.notices as any[]).find((n) => n.dismiss);
            return {
                code: dupe.dismiss.code,
                subject_kind: dupe.dismiss.subject_kind,
                subject_id: dupe.dismiss.subject_id,
                ...(dupe.dismiss.related_id
                    ? { related_id: dupe.dismiss.related_id }
                    : {}),
            };
        },
    ),
    mark_notices_read: noIds("returns a count, no row ids", async () => ({
        notification_ids: "all",
    })),
    get_notification_settings: noIds("returns kinds, no row ids", () => ({})),
    set_notification_settings: noIds(
        "returns the one setting, no row ids",
        () => ({ kind: "week_plan_changes", enabled: true }),
    ),
    add_fridge_location: () => ({ name: "Pantry" }),
    add_fridge_item: (s) => ({
        location_id: s.locationId,
        kind: "food",
        food_id: s.flour,
        amount: 500,
        unit: "g",
    }),
    add_grocery_line: (s) => ({
        store_id: s.storeId,
        kind: "food",
        food_id: s.milk,
        amount: 1,
        unit: "each",
    }),
    // A peanut food: the allergen notice names Bee, whose id is owed.
    "add_grocery_line#allergen": (s) => ({
        store_id: s.storeId,
        kind: "food",
        food_id: s.peanutOil,
        amount: 1,
        unit: "each",
    }),
    create_store: () => ({ name: "Aldi", sections: ["Dairy", "Bakery"] }),
    create_recipe: () => ({ name: "Pancakes", yield_portions: 2 }),
    add_recipe_ingredient: (s) => ({
        recipe_id: s.recipe,
        food_id: s.flour,
        amount: 200,
        unit: "g",
    }),
    import_recipe_from_text: () => ({
        text: "Toast",
        name: "Toast",
        yield_portions: 1,
        ingredients: [{ name: "Bread", amount: 2, unit: "each" }],
        on_similar: "create",
    }),
    // The steps name milk, which the ingredients lack: the warning says to call
    // add_recipe_ingredient, so its food_id must be in the text.
    "import_recipe_from_text#mentions": (s) => scrambleArgs(s),
    // Pasted text and a URL that cannot resolve, so it runs offline. The
    // bare "butter" has no amount, so the import carries a problem on an ingredient.
    import_recipe_from_url: () => ({
        url: "https://recipes.invalid/pancakes",
        text: URL_IMPORT_TEXT,
    }),
    "import_recipe_from_url#duplicate": async (_s, make) => {
        const args = {
            url: "https://recipes.invalid/pancakes-twice",
            text: URL_IMPORT_TEXT,
        };
        await make("import_recipe_from_url", args);
        return args;
    },
    plan_recipe: (s) => ({
        recipe_id: s.recipe,
        date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
        slot: "dinner",
        servings: 2,
    }),
    // A plan for named people echoes their ids in its entry, so the text names them.
    "plan_recipe#members": (s) => ({
        recipe_id: s.recipe,
        date: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
        slot: "snack",
        servings: 2,
        member_ids: [s.owner, s.member],
    }),
    add_plan_missing_to_groceries: () => ({}),
    add_recipe_to_grocery: noIds("returns counts, no row ids", (s) => ({
        recipe_id: s.recipe,
        store_id: s.storeId,
        total_portions: 2,
    })),
    upsert_food: () => ({ name: "Butter", on_similar: "create" }),
    log_meal: withNewRow(
        () => ({
            description: "Toast",
            meal_type: "breakfast",
            calories: 200,
        }),
        "meals",
    ),
    log_water: withNewRow(() => ({ amount_ml: 250 }), "water_log"),
    log_weight: withNewRow(() => ({ weight: 70, unit: "kg" }), "weight_log"),
    log_recipe_portion: withNewRow(
        (s) => ({
            recipe_id: s.recipe,
            portions: 1,
            meal_type: "dinner",
        }),
        "meals",
    ),
    eat_fridge_item: (s) => ({
        id: s.fridgeItem,
        amount: 50,
        meal_type: "snack",
    }),
    put_away_grocery_lines: (s) => ({
        line_ids: [s.lineB],
        location_id: s.locationId,
    }),
    cook_recipe: withNewRow(
        (s) => ({
            recipe_id: s.recipe,
            // A meal is logged only for the person the caller acts for.
            portions_by_member: [{ user_id: s.owner, portions: 1 }],
            deduct_stock: false,
            log_meals: true,
            meal_type: "dinner",
        }),
        "meals",
    ),
    bulk_import_meals: () => ({
        meals: [
            {
                source_line: 1,
                logged_at: "2026-01-02",
                meal_type: "lunch",
                calories: 300,
            },
        ],
        expected_row_count: 1,
    }),
    // ---- writes that change a row and return it, or the rows they touched ----
    update_store: noIds("echoes only ids the caller passed in", (s) => ({
        id: s.storeId,
        name: "Costco Wholesale",
    })),
    set_store_sections: (s) => ({ store_id: s.storeId, add: ["Frozen"] }),
    move_grocery_lines: noIds("echoes only ids the caller passed in", (s) => ({
        line_ids: [s.lineA],
        store_id: s.storeId,
        section: "Dairy",
    })),
    update_grocery_line: (s) => ({ id: s.lineA, amount: 3 }),
    check_grocery_line: noIds("echoes only ids the caller passed in", (s) => ({
        id: s.lineA,
    })),
    update_recipe: noIds("echoes only ids the caller passed in", (s) => ({
        id: s.recipe,
        notes: "Whisk well",
    })),
    update_recipe_ingredient: noIds(
        "echoes only ids the caller passed in",
        (s) => ({
            recipe_id: s.recipe,
            ingredient_id: s.ingredient,
            amount: 150,
        }),
    ),
    set_recipe_portion: noIds("echoes only ids the caller passed in", (s) => ({
        recipe_id: s.recipe,
        member_id: s.owner,
        portion_count: 1,
    })),
    set_recipe_variant: noIds(
        "no structured result: the id of the change is in its text",
        (s) => ({
            recipe_id: s.recipe,
            member_id: s.owner,
            action: "remove",
            ingredient_id: s.ingredient,
        }),
    ),
    clear_recipe_variant: noIds(
        "no structured result: it echoes only ids the caller passed in",
        async (s, make) => {
            await make("set_recipe_variant", {
                recipe_id: s.recipe,
                member_id: s.owner,
                action: "remove",
                ingredient_id: s.ingredient,
            });
            return { recipe_id: s.recipe, member_id: s.owner };
        },
    ),
    reorder_recipe_ingredients: noIds(
        "echoes only ids the caller passed in",
        async (s, make) => {
            const recipe = await make("get_recipe", { id: s.recipe });
            const ids = (recipe.ingredients as { id: string }[]).map(
                (i) => i.id,
            );
            return { recipe_id: s.recipe, ingredient_ids: ids.reverse() };
        },
    ),
    verify_recipe: noIds("echoes only ids the caller passed in", (s) => ({
        recipe_id: s.recipe,
    })),
    save_recipe: noIds("echoes only ids the caller passed in", (s) => ({
        recipe_id: s.recipe,
    })),
    update_meal: noIds("echoes only ids the caller passed in", (s) => ({
        id: s.meal,
        notes: "With tea",
    })),
    update_weight: noIds("echoes only ids the caller passed in", (s) => ({
        id: s.weight,
        weight: 70,
        unit: "kg",
    })),
    update_fridge_item: noIds("echoes only ids the caller passed in", (s) => ({
        id: s.spareItem,
        amount: 10,
    })),
    move_fridge_items: noIds("echoes only ids the caller passed in", (s) => ({
        ids: [s.spareItem],
        location_id: s.locationId,
    })),
    set_usual_product: noIds("echoes only ids the caller passed in", (s) => ({
        food_id: s.eggs,
        product_food_id: s.kirkland,
    })),
    // Reads the density off the usual product, an id the caller never passed.
    convert_quantity: async (_s, make) => {
        const oil = await make("upsert_food", {
            name: "Olive Oil",
            on_similar: "create",
        });
        const bottle = await make("upsert_food", {
            name: "Filippo Berio Olive Oil",
            generic_food_id: oil.id,
            grams_per_ml: 0.91,
            on_similar: "create",
        });
        await make("set_usual_product", {
            food_id: oil.id,
            product_food_id: bottle.id,
        });
        return { amount: 1, unit: "cup", to_unit: "g", food_id: oil.id };
    },
    // Edit paths: the row's own references (its plain food, its usual store and
    // usual product) were never in the arguments.
    "upsert_food#edit-product": (s) => ({
        food_id: s.kirkland,
        calories: 70,
    }),
    "upsert_food#edit-plain": (s) => ({ food_id: s.eggs, calories: 140 }),
    "link_product#link": async (s, make) => {
        const product = await make("upsert_food", {
            name: "Pasture Eggs",
            usual_store_id: s.storeId,
            on_similar: "create",
        });
        return { product_food_id: product.id, food_id: s.eggs };
    },
    "link_product#unlink": async (s, make) => {
        const product = await make("upsert_food", {
            name: "Farm Eggs",
            generic_food_id: s.eggs,
            usual_store_id: s.storeId,
            on_similar: "create",
        });
        return { product_food_id: product.id, food_id: null };
    },
    link_product: noIds(
        "echoes only ids the caller passed in",
        async (s, make) => {
            const organic = await make("upsert_food", {
                name: "Organic Eggs",
                on_similar: "create",
            });
            return { product_food_id: organic.id, food_id: s.eggs };
        },
    ),
    unplan_recipe: noIds("echoes only ids the caller passed in", (s) => ({
        plan_id: s.planId,
    })),
    remove_recipe_ingredient: noIds(
        "echoes only ids the caller passed in",
        (s) => ({
            recipe_id: s.recipe,
            ingredient_id: s.ingredient,
        }),
    ),
    discard_fridge_item: noIds("echoes only ids the caller passed in", (s) => ({
        id: s.spareItem,
        amount: 1,
    })),
    delete_fridge_item: noIds(
        "echoes only ids the caller passed in",
        async (s, make) => {
            const made = await make("add_fridge_item", {
                location_id: s.locationId,
                kind: "food",
                food_id: s.flour,
                amount: 1,
                unit: "g",
            });
            return { id: made.id };
        },
    ),
    delete_grocery_line: noIds("echoes only ids the caller passed in", (s) => ({
        id: s.lineA,
    })),
    reorder_stores: noIds(
        "echoes only ids the caller passed in",
        async (_s, make) => {
            const listed = await make("list_stores");
            const ids = (listed.stores as { id: string }[]).map(
                (row) => row.id,
            );
            return { ordered_ids: ids.reverse() };
        },
    ),
    delete_fridge_items: noIds(
        "echoes only ids the caller passed in",
        async (s, make) => {
            const made = await make("add_fridge_item", {
                location_id: s.locationId,
                kind: "food",
                food_id: s.flour,
                amount: 1,
                unit: "g",
            });
            return { ids: [made.id] };
        },
    ),
    delete_fridge_location: noIds(
        "echoes only ids the caller passed in",
        async (_s, make) => {
            const made = await make("add_fridge_location", { name: "Scratch" });
            return { id: made.id };
        },
    ),
    delete_store: noIds(
        "echoes only ids the caller passed in",
        async (_s, make) => {
            const made = await make("create_store", { name: "Scratch" });
            return { id: made.id };
        },
    ),
    merge_foods: noIds(
        "echoes only ids the caller passed in",
        async (_s, make) => {
            const keep = await make("upsert_food", {
                name: "Rice",
                on_similar: "create",
            });
            const drop = await make("upsert_food", {
                name: "Rice (loose)",
                on_similar: "create",
            });
            return { keep_id: keep.id, drop_id: drop.id };
        },
    ),
    delete_grocery_lines: noIds(
        "echoes only ids the caller passed in",
        async (s, make) => {
            const rice = await make("upsert_food", {
                name: "Oats",
                on_similar: "create",
            });
            const line = await make("add_grocery_line", {
                store_id: s.storeId,
                kind: "food",
                food_id: rice.id,
                amount: 1,
                unit: "each",
            });
            return { ids: [line.id] };
        },
    ),
    clear_checked_grocery_lines: noIds(
        "returns a count, no row ids",
        () => ({}),
    ),
    remove_usual: (s) => ({ food_id: s.eggs }),
    clear_grocery_list: noIds("echoes only ids the caller passed in", (s) => ({
        store_id: s.storeId,
    })),
    delete_meal: noIds("echoes only ids the caller passed in", (s) => ({
        id: s.meal,
    })),
    delete_water: noIds("echoes only ids the caller passed in", (s) => ({
        id: s.water,
    })),
    delete_weight: noIds("echoes only ids the caller passed in", (s) => ({
        id: s.weight,
    })),
    delete_recipe: noIds(
        "echoes only ids the caller passed in",
        async (_s, make) => {
            const made = await make("create_recipe", {
                name: "Scratch",
                yield_portions: 1,
            });
            return { id: made.id };
        },
    ),
    discard_recipe_draft: noIds(
        "echoes only ids the caller passed in",
        async (_s, make) => {
            const made = await make("import_recipe_from_text", {
                text: "Scratch draft",
                name: "Scratch draft",
                on_similar: "create",
            });
            return { recipe_id: (made.recipe as { id: string }).id };
        },
    ),
    // Last, since it empties the list the rows above read: the stores are
    // still in the text, an agent adding to one needs their ids.
    "list_grocery_lines#empty": async (_s, make) => {
        await make("clear_grocery_list");
        return {};
    },
};

// A tool in the snapshot with no row above must be here, with the reason it
// returns no id that is not already one the caller passed in, or cannot be
// seeded.
const EXCLUDED: Record<string, string> = {
    // Writes that only echo back ids the caller passed in or return none.
    set_nutrition_goals: "returns goal figures, no row ids",
    set_weight_unit: "returns a setting, no row ids",
    set_widget_display: "returns a setting, no row ids",
    set_alcohol_tracking: "returns a setting, no row ids",
    set_timezone: "returns a setting, no row ids",
    export_all_data: "returns a download link, no row ids",
    set_household_rules: "returns counts of what it added, no row ids",
    update_household_config: "returns the household's own config",
    delete_account: "destroys the account the test runs as",
    // Behind the mcp-share-links flag, which stays off, so tools/list only
    // carries them when the test turns it on.
    create_share_link: "gated by mcp-share-links, which stays off",
    list_share_links: "gated by mcp-share-links, which stays off",
    revoke_share_link: "gated by mcp-share-links, which stays off",
    import_shared_recipe: "gated by mcp-share-links, which stays off",
};

// Ids that sit in structuredContent but are not the row's own actionable id:
// they stay out of the text so a long list does not carry two or three tags per
// row. Keyed by JSON path with array indexes written as `[]`. Keep this short.
// An entry matches a path by its end (and by tool when one is named).
const NESTED: { tool?: string; path: string; reason: string }[] = [
    {
        path: ".creator_id",
        reason: "nested reference to the author, no tool takes it",
    },
    {
        path: ".rules[].id",
        reason: "nested reference, no tool takes a rule id",
    },
    {
        path: "store_rules[].id",
        reason: "nested reference, no tool takes a rule id",
    },
    ...["list_grocery_lines", "add_grocery_line", "update_grocery_line"].map(
        (tool) => ({
            tool,
            path: ".product.food_id",
            reason: "nested reference to the line's usual product, not the line's own id",
        }),
    ),
    {
        tool: "get_household_digest",
        path: ".movement_id",
        reason: "no tool takes a stock movement id",
    },
    {
        path: ".source_fridge_item_id",
        reason: "nested reference, not the row's own actionable id",
    },
    {
        tool: "start_meal_import",
        path: "structuredContent.user_id",
        reason: "just the caller's own id",
    },
];

/** The tool a CALLS key names: `rate_product#barcode` is rate_product. */
const toolOf = (key: string) => key.split("#")[0]!;

const normalizePath = (path: string) => path.replace(/\[\d+\]/g, "[]");
const isNested = (tool: string, path: string) =>
    NESTED.some(
        (n) =>
            (n.tool == null || n.tool === tool) &&
            normalizePath(path).endsWith(n.path),
    );

/**
 * Whether the text carries the id as a tag, `[label: <uuid>]`, the label being
 * the name of an input property some tool takes. A bare occurrence does not
 * count (a note that repeats the id in prose would hide a tag that was
 * removed), and neither does a label no tool has.
 */
const tagged = (
    lowerText: string,
    id: string,
    inputNames: ReadonlySet<string>,
) =>
    [...lowerText.matchAll(new RegExp(`\\[([a-z_]+): ${id}\\]`, "g"))].some(
        (match) => inputNames.has(match[1]!),
    );

/** Every uuid anywhere in a value, lower-cased. */
const uuidsIn = (value: unknown): string[] =>
    uuidPaths(value, "args").map(({ id }) => id);

/**
 * What one call checks: the ids in structuredContent that the text must carry
 * (everything but the household id, ids in the call's own arguments and the
 * NESTED paths), and the ones it misses.
 */
export function checkIdsInText(input: {
    /** Every input property name of every tool in tools/list. */
    inputNames: ReadonlySet<string>;
    tool: string;
    structured: unknown;
    text: string;
    args: unknown;
    householdId: string;
}): { checked: string[]; missing: string[] } {
    const text = input.text.toLowerCase();
    const ignored = new Set([
        input.householdId.toLowerCase(),
        ...uuidsIn(input.args),
    ]);
    const owed = uuidPaths(input.structured ?? {}).filter(
        ({ id, path }) => !ignored.has(id) && !isNested(input.tool, path),
    );
    return {
        checked: owed.map(({ id }) => id),
        missing: owed
            .filter(({ id }) => !tagged(text, id, input.inputNames))
            .map(({ id, path }) => `${path} = ${id}`),
    };
}

/** The guard: a row that checks no id at all must say why with `noIds`. */
export function rowChecksNothing(
    spec: CallSpec,
    checkedCount: number,
): boolean {
    return checkedCount === 0 && !spec.noIds;
}

async function withClient<T>(
    userId: string,
    era: Era,
    fn: (client: Client) => Promise<T>,
): Promise<T> {
    const app = new Hono();
    app.all("/mcp", (c) => {
        c.set("authContext", { kind: "user", userId });
        c.set("tokenClient", "Claude");
        return handleMcp(c);
    });
    const client = new Client(
        { name: "t", version: "0" },
        { versionNegotiation: { mode: era } },
    );
    await client.connect(
        new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
            fetch: async (url, init) =>
                app.request(new Request(String(url), init)),
        }),
    );
    try {
        return await fn(client);
    } finally {
        await client.close();
    }
}

async function callTool(
    userId: string,
    era: Era,
    name: string,
    args: Record<string, unknown> = {},
): Promise<Result> {
    return withClient(
        userId,
        era,
        async (client) =>
            (await client.callTool({ name, arguments: args })) as Result,
    );
}

/** Every input property name of every tool, with every flag on. */
async function listInputNames(userId: string): Promise<Set<string>> {
    setFlagsForTests(createMemoryFlags(allFlagsOn()));
    try {
        const { tools } = await withClient(userId, "legacy", (client) =>
            client.listTools(),
        );
        return new Set(
            tools.flatMap((tool) =>
                Object.keys(
                    (tool.inputSchema as { properties?: object }).properties ??
                        {},
                ),
            ),
        );
    } finally {
        setFlagsForTests(createMemoryFlags({}));
    }
}

/** Every uuid in a value with the JSON path it sits at, for the failure message. */
function uuidPaths(
    value: unknown,
    path = "structuredContent",
    out: { id: string; path: string }[] = [],
): { id: string; path: string }[] {
    if (typeof value === "string") {
        for (const id of value.match(UUID_RE) ?? []) {
            out.push({ id: id.toLowerCase(), path });
        }
    } else if (Array.isArray(value)) {
        value.forEach((item, i) => uuidPaths(item, `${path}[${i}]`, out));
    } else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) {
            uuidPaths(v, `${path}.${k}`, out);
        }
    }
    return out;
}

const textOf = (result: Result) => result.content.map((c) => c.text).join("\n");

describe("the id check itself", () => {
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    const household = "33333333-3333-4333-8333-333333333333";
    const inputNames = new Set(["id", "food_id"]);

    test("an owed id the text omits is reported, one it carries is not", () => {
        const structured = { rows: [{ id: a }, { id: b }] };
        const got = checkIdsInText({
            inputNames,
            tool: "t",
            structured,
            text: `row [id: ${a}]`,
            args: {},
            householdId: household,
        });
        expect(got.checked).toEqual([a, b]);
        expect(got.missing).toEqual([`structuredContent.rows[1].id = ${b}`]);
    });

    test("a bare occurrence of the id is not a tag", () => {
        const got = checkIdsInText({
            inputNames,
            tool: "t",
            structured: { id: a },
            text: `see ${a} for details`,
            args: {},
            householdId: household,
        });
        expect(got.missing).toEqual([`structuredContent.id = ${a}`]);
    });

    test("a tag whose label no tool takes does not count", () => {
        const got = checkIdsInText({
            inputNames,
            tool: "t",
            structured: { id: a },
            text: `row [nonsense_id: ${a}]`,
            args: {},
            householdId: household,
        });
        expect(got.missing).toEqual([`structuredContent.id = ${a}`]);
        const real = checkIdsInText({
            inputNames,
            tool: "t",
            structured: { id: a },
            text: `row [food_id: ${a}]`,
            args: {},
            householdId: household,
        });
        expect(real.missing).toEqual([]);
    });

    test("the household id and ids the caller passed in are not owed", () => {
        const got = checkIdsInText({
            inputNames,
            tool: "t",
            structured: { household_id: household, id: a, other: b },
            text: "",
            args: { id: a.toUpperCase() },
            householdId: household,
        });
        expect(got.checked).toEqual([b]);
    });

    test("a row that checks no id fails unless it carries noIds", () => {
        const plain: CallSpec = { args: () => ({}) };
        expect(rowChecksNothing(plain, 0)).toBe(true);
        expect(rowChecksNothing(plain, 1)).toBe(false);
        expect(
            rowChecksNothing(
                noIds("no row ids", () => ({})),
                0,
            ),
        ).toBe(false);
    });
});

describeDb(pgAvailable !== null, "ids in every tool's text (db)", (getCtx) => {
    let householdId: string;
    let ownerId: string;
    let inputNames: Set<string>;

    async function setUp(): Promise<Seed> {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        setFlagsForTests(createMemoryFlags({}));
        ({ householdId, userId: ownerId } = await seedHousehold(sql));
        await asUser(
            ownerId,
            () =>
                liveSettingsStore().setAgentDestructiveAllowed(
                    householdId,
                    true,
                ),
            householdId,
        );
        const seeded = await seed();
        inputNames = await listInputNames(ownerId);
        return seeded;
    }

    /** One seeded call: any error here is the fixture's, not the rule's. */
    async function ok(
        name: string,
        args: Record<string, unknown>,
    ): Promise<Record<string, any>> {
        const result = await callTool(ownerId, "legacy", name, args);
        if (result.isError) {
            throw new Error(`seeding ${name} failed: ${textOf(result)}`);
        }
        return result.structuredContent ?? {};
    }

    async function seed(): Promise<Seed> {
        const { sql } = getCtx();
        const member = crypto.randomUUID();
        await sql`insert into public.users (id, email) values (${member}, ${`m-${member}@foodable.test`})`;
        await sql`
            insert into public.household_members (household_id, user_id, role, display_name)
            values (${householdId}, ${member}, 'member', 'Bee')
        `;
        const store = await ok("create_store", {
            name: "Costco",
            sections: ["Produce", "Dairy"],
        });
        const eggs = (await ok("upsert_food", {
            name: "Eggs",
            on_similar: "create",
        })) as { id: string };
        const kirkland = (await ok("upsert_food", {
            name: "Kirkland Large Eggs",
            on_similar: "create",
        })) as { id: string };
        await ok("link_product", {
            product_food_id: kirkland.id,
            food_id: eggs.id,
        });
        await ok("set_usual_product", {
            food_id: eggs.id,
            product_food_id: kirkland.id,
            store_id: store.id,
        });
        const milk = (await ok("upsert_food", {
            name: "Milk",
            on_similar: "create",
        })) as { id: string };
        const flour = (await ok("upsert_food", {
            name: "Flour",
            on_similar: "create",
        })) as { id: string };
        const location = await ok("add_fridge_location", { name: "Fridge" });
        await ok("add_fridge_item", {
            location_id: location.id,
            kind: "food",
            food_id: eggs.id,
            amount: 12,
            unit: "each",
        });
        const [item] = (await sql`
            select id from public.fridge_items where food_id = ${eggs.id}
        `) as { id: string }[];
        // Dated soon, so the fridge carries an expiry notice.
        await sql`
            update public.fridge_items
            set expires_on = current_date + 1
            where id = ${item!.id}
        `;
        const lineA = await ok("add_grocery_line", {
            store_id: store.id,
            kind: "food",
            food_id: milk.id,
            amount: 2,
            unit: "each",
        });
        const lineB = await ok("add_grocery_line", {
            store_id: store.id,
            kind: "food",
            food_id: flour.id,
            amount: 1,
            unit: "each",
        });
        await ok("set_household_rules", {
            store_rules: [{ store_id: store.id, body: "Buy eggs here" }],
            person: [
                { user_id: ownerId, rules: ["No dairy at night"] },
                { user_id: member, rules: ["No nuts"] },
            ],
        });
        const recipe = await ok("create_recipe", {
            name: "Omelette",
            yield_portions: 2,
        });
        const ingredient = await ok("add_recipe_ingredient", {
            recipe_id: recipe.id,
            food_id: eggs.id,
            amount: 100,
            unit: "g",
        });
        const planned = await ok("plan_recipe", {
            recipe_id: recipe.id,
            date: new Date().toISOString().slice(0, 10),
            slot: "lunch",
            servings: 2,
        });
        await ok("log_meal", {
            description: "Lunch",
            meal_type: "lunch",
            calories: 500,
        });
        await ok("log_water", { amount_ml: 300 });
        await ok("log_weight", { weight: 71, unit: "kg" });
        // These three tools return no row id of their own; the id is read back.
        const only = async (table: string) =>
            (
                (await sql.unsafe(
                    `select id from public.${table} limit 1`,
                )) as {
                    id: string;
                }[]
            )[0]!.id;
        // A second fridge item, so the tools that change or remove one have
        // an item the earlier calls (eat, put-away) did not use up.
        await ok("add_fridge_item", {
            location_id: location.id,
            kind: "food",
            food_id: milk.id,
            amount: 1000,
            unit: "ml",
        });
        // Used up and thrown out, so the digest has something that ran out.
        const sugar = (await ok("upsert_food", {
            name: "Sugar",
            on_similar: "create",
        })) as { id: string };
        const sugarItem = await ok("add_fridge_item", {
            location_id: location.id,
            kind: "food",
            food_id: sugar.id,
            amount: 1,
            unit: "g",
        });
        await ok("discard_fridge_item", { id: sugarItem.id, amount: 1 });
        // Bee is allergic to peanuts, so a peanut food on the list carries an
        // allergen notice that names Bee.
        await sql`
            insert into public.member_allergens (household_id, user_id, allergen)
            values (${householdId}, ${member}, 'peanut')
        `;
        const peanutButter = (await ok("upsert_food", {
            name: "Peanut Butter",
            allergens: ["peanut"],
            on_similar: "create",
        })) as { id: string };
        await ok("add_grocery_line", {
            store_id: store.id,
            kind: "food",
            food_id: peanutButter.id,
            amount: 1,
            unit: "each",
        });
        const peanutOil = (await ok("upsert_food", {
            name: "Peanut Oil",
            allergens: ["peanut"],
            on_similar: "create",
        })) as { id: string };
        const barcode = "5449000000996";
        const barcoded = (await ok("upsert_food", {
            name: "Seltzer Bottle",
            barcode,
            on_similar: "create",
        })) as { id: string };
        const [spare] = (await sql`
            select id from public.fridge_items where food_id = ${milk.id}
        `) as { id: string }[];
        return {
            owner: ownerId,
            member,
            householdId,
            storeId: store.id,
            sectionName: "Produce",
            locationId: location.id,
            eggs: eggs.id,
            kirkland: kirkland.id,
            milk: milk.id,
            flour: flour.id,
            fridgeItem: item!.id,
            lineA: lineA.id,
            lineB: lineB.id,
            recipe: recipe.id,
            ingredient: ingredient.ingredient.id,
            planId: planned.plan.plan_id,
            meal: await only("meals"),
            water: await only("water_log"),
            weight: await only("weight_log"),
            spareItem: spare!.id,
            barcoded: barcoded.id,
            barcode,
            peanutOil: peanutOil.id,
        };
    }

    test("every tool in the snapshot has a call row or a stated reason", async () => {
        const snapshot = JSON.parse(
            await Bun.file(
                new URL("../tools-list.snapshot.json", import.meta.url),
            ).text(),
        ) as string[];
        const names = snapshot.map((t: any) =>
            typeof t === "string" ? t : t.name,
        );
        const called = Object.keys(CALLS).map(toolOf);
        const missing = names.filter(
            (name) => !called.includes(name) && !(name in EXCLUDED),
        );
        expect(missing).toEqual([]);
        const stale = [...called, ...Object.keys(EXCLUDED)].filter(
            (name) => !names.includes(name),
        );
        expect(stale).toEqual([]);
        const both = called.filter((name) => name in EXCLUDED);
        expect(both).toEqual([]);
    });

    for (const { label, era } of ERAS) {
        describe(`protocol ${label}`, () => {
            let seeded: Seed;
            beforeAll(async () => {
                seeded = await setUp();
            }, 120_000);
            afterAll(() => {
                resetFlagsForTests();
                setSqlForTests(null);
            });

            for (const [key, row] of Object.entries(CALLS)) {
                const tool = toolOf(key);
                const spec: CallSpec =
                    typeof row === "function" ? { args: row } : row;
                test(`${key}: every id in structuredContent is in the text`, async () => {
                    const { sql } = getCtx();
                    const make: Make = async (name, input = {}) => {
                        const made = await callTool(
                            seeded.owner,
                            "legacy",
                            name,
                            input,
                        );
                        if (made.isError) {
                            throw new Error(
                                `${tool}: setting up with ${name} failed: ${textOf(made)}`,
                            );
                        }
                        return made.structuredContent ?? {};
                    };
                    const idsOf = async (table: RowTable) =>
                        new Set(
                            (
                                (await sql.unsafe(
                                    `select id from public.${table}`,
                                )) as { id: string }[]
                            ).map((r) => r.id),
                        );
                    const before = spec.newRow
                        ? await idsOf(spec.newRow)
                        : new Set<string>();
                    const callArgs = await spec.args(seeded, make);
                    if (spec.flags) {
                        setFlagsForTests(createMemoryFlags(spec.flags));
                    }
                    let result: Result;
                    try {
                        result = await callTool(
                            seeded.owner,
                            era,
                            tool,
                            callArgs,
                        );
                    } finally {
                        if (spec.flags) {
                            setFlagsForTests(createMemoryFlags({}));
                        }
                    }
                    if (result.isError) {
                        throw new Error(`${tool} failed: ${textOf(result)}`);
                    }
                    const { checked, missing } = checkIdsInText({
                        inputNames,
                        tool,
                        structured: result.structuredContent,
                        text: textOf(result),
                        args: callArgs,
                        householdId: seeded.householdId,
                    });
                    // Text-only tools: the seeded ids they return, and the id
                    // of the row a write just added, must be in the text.
                    const text = textOf(result).toLowerCase();
                    const owedInText = [...(spec.textIds?.(seeded) ?? [])];
                    if (spec.newRow) {
                        const added = [...(await idsOf(spec.newRow))].filter(
                            (id) => !before.has(id),
                        );
                        expect(
                            added.length,
                            `${tool} should have added a ${spec.newRow} row`,
                        ).toBeGreaterThan(0);
                        owedInText.push(...added);
                    }
                    const absent = owedInText
                        .filter(
                            (id) => !tagged(text, id.toLowerCase(), inputNames),
                        )
                        .map((id) => `text omits ${id}`);
                    expect(
                        [...missing, ...absent],
                        `${tool} carries ids in structuredContent that its text omits`,
                    ).toEqual([]);
                    expect(
                        rowChecksNothing(
                            spec,
                            checked.length + owedInText.length,
                        ),
                        `${tool} checks no id: give it a row that does, or noIds with a reason`,
                    ).toBe(false);
                    if (spec.noIds) {
                        expect(
                            checked.length + owedInText.length,
                            `${tool} says noIds (${spec.noIds}) but carries ids`,
                        ).toBe(0);
                    }
                });
            }
        });
    }
});
